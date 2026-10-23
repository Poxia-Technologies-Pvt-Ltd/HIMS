import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { createCaptcha, verifyCaptcha } from '../utils/captchaStore.js';
import { getBlockedUntil, recordLoginFailure, recordLoginSuccess } from '../utils/bruteForceGuard.js';
import { issueOtp, checkOtp, normalizePhone } from '../services/otpService.js';
import { recordDelivery, maskPhone } from '../utils/reportDelivery.js';
import { sendApprovedReportPdf } from './patientController.js';

// Clinician portal (tender #41). A register of referring clinicians (kept by administrators),
// sign-in with a one-time code sent to the registered mobile number, and a view limited to the
// orders and reports that name that clinician as the referrer.

const fail = (res, e, what) => { console.error(`${what}:`, e); res.status(500).json({ success: false, message: `Server error ${what}` }); };
const token = (c) => jwt.sign({ id: c.id, type: 'clinician' }, process.env.JWT_SECRET, { expiresIn: '12h' });

// "Dr. A. Kumar" and "dr a kumar" are the same name on an order.
export const normName = (s) => String(s || '').toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim().replace(/^(dr|doctor)\b\s*/, '').trim();
const SQL_NORM = "TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(REPLACE(COALESCE(b.referring_clinician, ''), '.', ' ')), '[[:space:]]+', ' '), '^(dr|doctor)[[:space:]]+', ''))";

function ownershipClause(c) {
  const names = [c.name, ...String(c.name_aliases || '').split('|')].map(normName).filter(Boolean);
  const parts = []; const params = [];
  if (names.length) { parts.push(`${SQL_NORM} IN (?)`); params.push([...new Set(names)]); }
  if (c.registration_no && String(c.registration_no).trim().length >= 4) { parts.push("b.referring_clinician LIKE ?"); params.push(`%${String(c.registration_no).trim()}%`); }
  return { sql: parts.length ? `(${parts.join(' OR ')})` : '1=0', params };
}

// ── Administration ───────────────────────────────────────────────────────────────────────────
export const listClinicians = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const [rows] = await db.query(
      `SELECT id, name, registration_no, phone, email, facility, name_aliases, status, last_login_at, created_at FROM referring_clinicians
        ${q ? 'WHERE name LIKE ? OR phone LIKE ? OR registration_no LIKE ?' : ''} ORDER BY name LIMIT 500`, q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []);
    res.json({ success: true, clinicians: rows });
  } catch (e) { fail(res, e, 'loading clinicians'); }
};

const clean = (b) => ({
  name: String(b.name || '').trim().slice(0, 150),
  registration_no: String(b.registration_no || '').trim().slice(0, 60) || null,
  phone: normalizePhone(b.phone),
  email: String(b.email || '').trim().slice(0, 150) || null,
  facility: String(b.facility || '').trim().slice(0, 200) || null,
  name_aliases: String(b.name_aliases || '').trim().slice(0, 500) || null,
});

export const createClinician = async (req, res) => {
  try {
    const c = clean(req.body || {});
    if (!c.name) return res.status(400).json({ success: false, message: 'Name is required.' });
    if (c.phone.length !== 10) return res.status(400).json({ success: false, message: 'A 10-digit mobile number is required; the one-time code is sent to it.' });
    const [ins] = await db.query(
      'INSERT INTO referring_clinicians (name, registration_no, phone, email, facility, name_aliases, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [c.name, c.registration_no, c.phone, c.email, c.facility, c.name_aliases, req.user?.id || null]);
    res.status(201).json({ success: true, id: ins.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'A clinician with this mobile number is already registered.' });
    fail(res, e, 'saving the clinician');
  }
};

export const updateClinician = async (req, res) => {
  try {
    const c = clean(req.body || {});
    const status = req.body?.status === 'Inactive' ? 'Inactive' : 'Active';
    if (!c.name || c.phone.length !== 10) return res.status(400).json({ success: false, message: 'Name and a 10-digit mobile number are required.' });
    const [r] = await db.query(
      'UPDATE referring_clinicians SET name = ?, registration_no = ?, phone = ?, email = ?, facility = ?, name_aliases = ?, status = ? WHERE id = ?',
      [c.name, c.registration_no, c.phone, c.email, c.facility, c.name_aliases, status, Number(req.params.id) || 0]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Clinician not found.' });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Another clinician already uses this mobile number.' });
    fail(res, e, 'updating the clinician');
  }
};

// ── Sign-in ──────────────────────────────────────────────────────────────────────────────────
export const requestOtp = async (req, res) => {
  try {
    const { phone, captchaId, captchaText } = req.body || {};
    if (!verifyCaptcha(captchaId, captchaText)) return res.status(400).json({ success: false, message: 'Invalid or expired captcha', captcha: createCaptcha() });
    const p = normalizePhone(phone);
    if (p.length !== 10) return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number.', captcha: createCaptcha() });
    const generic = { success: true, message: 'If this number is registered, a 6-digit code has been sent to it.', expires_in: 300 };
    const [[c]] = await db.query("SELECT id FROM referring_clinicians WHERE phone = ? AND status = 'Active'", [p]);
    if (!c) return res.json(generic);
    const r = await issueOtp({ audience: 'clinician', phone: p, ip: req.ip });
    if (!r.ok) return res.status(r.status || 400).json({ success: false, message: r.message, captcha: createCaptcha() });
    res.json({ ...generic, ...(r.dev_code ? { dev_code: r.dev_code } : {}) });
  } catch (e) { fail(res, e, 'sending the code'); }
};

export const verifyOtp = async (req, res) => {
  if (getBlockedUntil(req.ip)) return res.status(429).json({ success: false, message: 'Too many failed attempts from this network. Try again later.' });
  try {
    const p = normalizePhone(req.body?.phone);
    const check = await checkOtp({ audience: 'clinician', phone: p, code: req.body?.code });
    if (!check.ok) { recordLoginFailure(req.ip); return res.status(401).json({ success: false, message: check.message }); }
    const [[c]] = await db.query("SELECT * FROM referring_clinicians WHERE phone = ? AND status = 'Active'", [p]);
    if (!c) return res.status(401).json({ success: false, message: 'This number is not registered.' });
    recordLoginSuccess(req.ip);
    await db.query('UPDATE referring_clinicians SET last_login_at = NOW() WHERE id = ?', [c.id]);
    res.json({ success: true, token: token(c), clinician: { id: c.id, name: c.name, registration_no: c.registration_no, facility: c.facility } });
  } catch (e) { fail(res, e, 'signing in'); }
};

export const authenticateClinician = async (req, res, next) => {
  const raw = req.headers.authorization?.split(' ')[1];
  if (!raw) return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  try {
    const d = jwt.verify(raw, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (d.type !== 'clinician') return res.status(403).json({ success: false, message: 'Access denied.' });
    const [[c]] = await db.query("SELECT * FROM referring_clinicians WHERE id = ? AND status = 'Active'", [d.id]);
    if (!c) return res.status(403).json({ success: false, message: 'This account is no longer active.' });
    req.clinician = c;
    next();
  } catch { res.status(403).json({ success: false, message: 'Invalid or expired token' }); }
};

// ── Their patients' orders and reports ───────────────────────────────────────────────────────
export const me = (req, res) => {
  const c = req.clinician;
  res.json({ success: true, clinician: { id: c.id, name: c.name, registration_no: c.registration_no, facility: c.facility, phone: maskPhone(c.phone) } });
};

const age = (dob) => {
  if (!dob) return null;
  const d = new Date(dob); const t = new Date(); let a = t.getFullYear() - d.getFullYear();
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--;
  return a;
};

// GET /reports?state=ready|pending|all&q=&from=&to=&page=
export const reports = async (req, res) => {
  try {
    const own = ownershipClause(req.clinician);
    const state = ['ready', 'pending', 'all'].includes(req.query.state) ? req.query.state : 'all';
    const where = [own.sql]; const params = [...own.params];
    if (state === 'ready') where.push("tr.status = 'Approved'");
    if (state === 'pending') where.push("(tr.status IS NULL OR tr.status <> 'Approved')");
    const q = String(req.query.q || '').trim();
    if (q) { where.push("(CONCAT_WS(' ', p.first_name, p.last_name) LIKE ? OR p.reg_no = ? OR bi.sample_id = ? OR bi.service_name LIKE ?)"); params.push(`%${q}%`, q, q, `%${q}%`); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) { where.push('DATE(b.created_at) >= ?'); params.push(req.query.from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) { where.push('DATE(b.created_at) <= ?'); params.push(req.query.to); }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = (Math.max(1, Number(req.query.page) || 1) - 1) * limit;
    const from = `FROM bill_items bi JOIN bills b ON b.id = bi.bill_id JOIN patients p ON p.id = b.patient_id
      LEFT JOIN lab_test_result tr ON tr.bill_item_id = bi.id LEFT JOIN branches br ON br.id = b.branch_id
      WHERE bi.service_type = 'Laboratory' AND bi.status <> 'Cancelled' AND ${where.join(' AND ')}`;
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n ${from}`, params);
    const [rows] = await db.query(
      `SELECT bi.id AS order_id, bi.sample_id, bi.service_name AS test_name, bi.status AS order_status, b.created_at AS ordered_at, b.priority,
              tr.status AS result_status, tr.approved_at, tr.has_critical, p.reg_no, p.first_name, p.last_name, p.gender, p.dob, br.branch_name
         ${from} ORDER BY b.created_at DESC, bi.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    res.json({
      success: true, total: Number(n),
      reports: rows.map((r) => ({
        order_id: r.order_id, sample_id: r.sample_id, test_name: r.test_name, ordered_at: r.ordered_at, priority: r.priority,
        ready: r.result_status === 'Approved', status: r.result_status === 'Approved' ? 'Report ready' : (r.order_status || 'Pending'),
        approved_at: r.approved_at, critical: !!r.has_critical,
        patient: { reg_no: r.reg_no, name: [r.first_name, r.last_name].filter(Boolean).join(' '), gender: r.gender, age: age(r.dob) }, facility: r.branch_name,
      })),
    });
  } catch (e) { fail(res, e, 'loading reports'); }
};

// GET /reports/:sampleId/pdf
export const reportPdf = async (req, res) => {
  try {
    const own = ownershipClause(req.clinician);
    const [rows] = await db.query(
      `SELECT tr.id FROM lab_test_result tr JOIN bill_items bi ON bi.id = tr.bill_item_id JOIN bills b ON b.id = bi.bill_id
        WHERE tr.sample_id = ? AND tr.status = 'Approved' AND ${own.sql} LIMIT 1`, [req.params.sampleId, ...own.params]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Report not found or not available to you.' });
    await recordDelivery({ sampleId: req.params.sampleId, channel: 'Clinician portal', recipient: `Dr ${req.clinician.name} ${maskPhone(req.clinician.phone)}`, status: 'Delivered', triggeredBy: 'Clinician portal', req });
    return sendApprovedReportPdf(res, req.params.sampleId, { referredBy: req.clinician.name });
  } catch (e) { fail(res, e, 'preparing the report'); }
};
