import crypto from 'crypto';
import db from '../config/db.js';
import { sendWhatsAppMessage } from './whatsappService.js';

// One-time passwords for the patient portal, report retrieval and the clinician portal
// (tender #41, #48). Delivery is by SMS through any HTTP SMS gateway (configured with environment
// values, see below) and falls back to the WhatsApp channel the system already uses.
//
//   OTP_CHANNEL            auto (default: SMS if a gateway is configured, else WhatsApp) | sms | whatsapp
//   SMS_GATEWAY_URL        e.g. https://gateway.example/send?to={phone}&text={message}&sender={sender}&tid={template_id}
//   SMS_GATEWAY_METHOD     GET (default) or POST
//   SMS_GATEWAY_BODY       POST body template (JSON text) using the same {placeholders}
//   SMS_GATEWAY_HEADERS    JSON object of extra headers, e.g. {"Authorization":"Bearer ..."}
//   SMS_SENDER_ID, SMS_DLT_TEMPLATE_ID   values substituted into {sender} and {template_id}
//   SMS_OTP_TEMPLATE       message text; {otp} and {minutes} are replaced. Must equal the registered
//                          (DLT) template when the gateway enforces one.

const TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_15_MIN = 3;
const MIN_GAP_SECONDS = 30;

export const normalizePhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);
export const smsConfigured = () => !!process.env.SMS_GATEWAY_URL;
const channelChoice = () => {
  const c = (process.env.OTP_CHANNEL || 'auto').toLowerCase();
  if (c === 'sms' || c === 'whatsapp') return c;
  return smsConfigured() ? 'sms' : 'whatsapp';
};
const template = () => process.env.SMS_OTP_TEMPLATE || 'Your hospital login OTP is {otp}. It is valid for {minutes} minutes. Do not share it with anyone.';
const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));

const digest = (audience, phone, code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(`${audience}|${phone}|${code}`).digest('hex');

export async function sendSms(phone, message) {
  if (!smsConfigured()) throw new Error('SMS gateway is not configured.');
  const vars = { phone: `91${normalizePhone(phone)}`, phone10: normalizePhone(phone), message, sender: process.env.SMS_SENDER_ID || '', template_id: process.env.SMS_DLT_TEMPLATE_ID || '' };
  const method = (process.env.SMS_GATEWAY_METHOD || 'GET').toUpperCase();
  const enc = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, encodeURIComponent(v)]));
  const url = fill(process.env.SMS_GATEWAY_URL, method === 'GET' ? enc : enc);
  let headers = {};
  try { headers = process.env.SMS_GATEWAY_HEADERS ? JSON.parse(process.env.SMS_GATEWAY_HEADERS) : {}; } catch { throw new Error('SMS_GATEWAY_HEADERS is not valid JSON.'); }
  const init = { method, headers };
  if (method === 'POST') {
    const jsonSafe = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, JSON.stringify(String(v)).slice(1, -1)]));
    init.body = fill(process.env.SMS_GATEWAY_BODY || '{"to":"{phone}","message":"{message}"}', jsonSafe);
    init.headers = { 'Content-Type': 'application/json', ...headers };
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`SMS gateway answered ${res.status}`);
  return { provider: 'sms' };
}

async function deliver(phone, code) {
  const text = fill(template(), { otp: code, minutes: TTL_MINUTES });
  const channel = channelChoice();
  if (channel === 'sms') { await sendSms(phone, text); return 'sms'; }
  await sendWhatsAppMessage(phone, text);
  return 'whatsapp';
}

/**
 * Issues an OTP. Returns { ok, message, expires_in } and never says whether the phone is known —
 * callers decide that before calling (and answer identically either way).
 */
export async function issueOtp({ audience, phone, ip }) {
  const p = normalizePhone(phone);
  if (p.length !== 10) return { ok: false, status: 400, message: 'Enter a valid 10-digit mobile number.' };
  const [[recent]] = await db.query(
    `SELECT COUNT(*) AS n, MAX(created_at) AS last FROM portal_otps WHERE audience = ? AND phone = ? AND created_at >= NOW() - INTERVAL 15 MINUTE`, [audience, p]);
  if (recent.n >= MAX_SENDS_PER_15_MIN) return { ok: false, status: 429, message: 'Too many codes requested. Please wait 15 minutes and try again.' };
  if (recent.last && Date.now() - new Date(recent.last).getTime() < MIN_GAP_SECONDS * 1000) {
    return { ok: false, status: 429, message: `Please wait ${MIN_GAP_SECONDS} seconds before asking for another code.` };
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const [ins] = await db.query(
    `INSERT INTO portal_otps (audience, phone, code_hash, expires_at, ip) VALUES (?, ?, ?, NOW() + INTERVAL ${TTL_MINUTES} MINUTE, ?)`,
    [audience, p, digest(audience, p, code), ip || null]);
  try {
    const channel = await deliver(p, code);
    await db.query('UPDATE portal_otps SET channel = ? WHERE id = ?', [channel, ins.insertId]);
  } catch (e) {
    const dev = process.env.NODE_ENV !== 'production';
    console.error('OTP delivery failed:', e.message);
    if (dev) { console.log(`[dev] OTP for ${p}: ${code}`); return { ok: true, message: 'Code generated (development: see server log).', expires_in: TTL_MINUTES * 60, dev_code: code }; }
    await db.query('DELETE FROM portal_otps WHERE id = ?', [ins.insertId]);
    return { ok: false, status: 503, message: 'The code could not be sent right now. Please try again later.' };
  }
  return { ok: true, message: 'A 6-digit code has been sent to your mobile number.', expires_in: TTL_MINUTES * 60 };
}

/** Checks a code. A wrong code counts an attempt; the code is single use. */
export async function checkOtp({ audience, phone, code }) {
  const p = normalizePhone(phone);
  const [[row]] = await db.query(
    `SELECT * FROM portal_otps WHERE audience = ? AND phone = ? AND consumed_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1`, [audience, p]);
  if (!row) return { ok: false, message: 'The code has expired or was not requested. Ask for a new one.' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, message: 'Too many wrong attempts. Ask for a new code.' };
  await db.query('UPDATE portal_otps SET attempts = attempts + 1 WHERE id = ?', [row.id]);
  const a = Buffer.from(digest(audience, p, String(code || '').trim()), 'hex');
  const b = Buffer.from(row.code_hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, message: 'That code is not correct.' };
  await db.query('UPDATE portal_otps SET consumed_at = NOW() WHERE id = ?', [row.id]);
  return { ok: true };
}
