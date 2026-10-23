import crypto from 'crypto';
import db from '../config/db.js';
import { buildLabReportData } from './labController.js';
import { dispatchReport, DeliveryError, maskPhone, maskEmail } from '../utils/reportDelivery.js';

// Report Delivery page: every delivery attempt with its status, resend of
// failed ones, sending by e-mail, and the patient's digital-delivery consent.

const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null);

const fail = (res, error, what) => {
  if (error instanceof DeliveryError) return res.status(error.status).json({ success: false, message: error.message });
  console.error(`${what}:`, error.message);
  return res.status(500).json({ success: false, message: 'Server error' });
};

// GET /api/report-delivery?status=&channel=&from=&to=&q=
export const listDeliveries = async (req, res) => {
  try {
    const { status, channel, from, to, q } = req.query;
    const where = ['1=1'];
    const params = [];
    const pin = pinned(req);
    if (pin) { where.push('rd.branch_id = ?'); params.push(pin); }
    if (from) { where.push('rd.created_at >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('rd.created_at <= ?'); params.push(`${to} 23:59:59`); }
    if (channel) { where.push('rd.channel = ?'); params.push(channel); }
    if (q) {
      where.push("(rd.sample_id LIKE ? OR p.reg_no LIKE ? OR CONCAT_WS(' ', p.first_name, p.last_name) LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const base = `FROM report_deliveries rd LEFT JOIN patients p ON p.id = rd.patient_id WHERE ${where.join(' AND ')}`;

    const [summaryRows] = await db.query(`SELECT rd.status, COUNT(*) AS n ${base} GROUP BY rd.status`, params);
    const summary = Object.fromEntries(summaryRows.map((r) => [r.status, Number(r.n)]));

    const [rows] = await db.query(
      `SELECT rd.*, p.reg_no, CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name, p.report_consent,
              (SELECT COUNT(*) FROM report_deliveries r2 WHERE r2.resend_of = rd.id) AS resend_count
       ${base} ${status ? 'AND rd.status = ?' : ''}
       ORDER BY rd.id DESC LIMIT 300`,
      status ? [...params, status] : params
    );
    res.json({ success: true, summary, deliveries: rows });
  } catch (error) {
    fail(res, error, 'listDeliveries');
  }
};

async function deliveryInScope(req, id) {
  const pin = pinned(req);
  const [[row]] = await db.query(`SELECT * FROM report_deliveries WHERE id = ? ${pin ? 'AND branch_id = ?' : ''}`, pin ? [id, pin] : [id]);
  return row || null;
}

// POST /api/report-delivery/:id/resend — re-dispatch a WhatsApp/e-mail delivery.
export const resendDelivery = async (req, res) => {
  try {
    const row = await deliveryInScope(req, req.params.id);
    if (!row) return res.status(404).json({ success: false, message: 'Delivery not found' });
    if (!['WhatsApp', 'Email'].includes(row.channel) || String(row.recipient || '').startsWith('Doctor')) {
      return res.status(400).json({ success: false, message: 'Only patient WhatsApp and e-mail deliveries can be resent' });
    }
    const out = await dispatchReport({
      sampleId: row.sample_id, channel: row.channel, buildData: buildLabReportData,
      triggeredBy: 'Staff', actor: req.user, req, resendOf: row.id,
    });
    res.json({ success: true, message: `Report resent by ${row.channel} to ${out.recipient}` });
  } catch (error) {
    fail(res, error, 'resendDelivery');
  }
};

async function sampleInScope(req, sampleId) {
  const pin = pinned(req);
  const [[row]] = await db.query(
    `SELECT tr.sample_id, tr.patient_id, tr.branch_id FROM lab_test_result tr
      WHERE tr.sample_id = ? AND tr.status = 'Approved' ${pin ? 'AND tr.branch_id = ?' : ''} ORDER BY tr.id DESC LIMIT 1`,
    pin ? [sampleId, pin] : [sampleId]
  );
  return row || null;
}

// POST /api/report-delivery/send { sample_id, channel: 'WhatsApp' | 'Email' }
// Always to the contact registered on the patient record.
export const sendReport = async (req, res) => {
  try {
    const { sample_id, channel } = req.body || {};
    if (!sample_id || !['WhatsApp', 'Email'].includes(channel)) {
      return res.status(400).json({ success: false, message: 'sample_id and channel (WhatsApp or Email) are required' });
    }
    if (!(await sampleInScope(req, sample_id))) return res.status(404).json({ success: false, message: 'Approved report not found' });
    const out = await dispatchReport({ sampleId: sample_id, channel, buildData: buildLabReportData, triggeredBy: 'Staff', actor: req.user, req });
    res.json({ success: true, message: `Report sent by ${channel === 'Email' ? 'e-mail' : 'WhatsApp'} to ${out.recipient}` });
  } catch (error) {
    fail(res, error, 'sendReport');
  }
};

// GET /api/report-delivery/consent/:sampleId — the patient behind a report,
// their (masked) contacts and consent, for the send dialog.
export const getConsent = async (req, res) => {
  try {
    const s = await sampleInScope(req, req.params.sampleId);
    if (!s) return res.status(404).json({ success: false, message: 'Approved report not found' });
    const [[p]] = await db.query(
      `SELECT id, reg_no, CONCAT_WS(' ', first_name, last_name) AS name, telephone, email_id, report_consent, report_consent_at
         FROM patients WHERE id = ?`, [s.patient_id]);
    if (!p) return res.status(404).json({ success: false, message: 'Patient not found' });
    res.json({
      success: true,
      patient: {
        id: p.id, reg_no: p.reg_no, name: p.name,
        phone: maskPhone(p.telephone), email: maskEmail(p.email_id),
        report_consent: p.report_consent, report_consent_at: p.report_consent_at,
      },
    });
  } catch (error) {
    fail(res, error, 'getConsent');
  }
};

// PUT /api/report-delivery/consent/:patientId { consent: true | false }
export const setConsent = async (req, res) => {
  try {
    const { consent } = req.body || {};
    if (typeof consent !== 'boolean') return res.status(400).json({ success: false, message: 'consent must be true or false' });
    const [r] = await db.query('UPDATE patients SET report_consent = ?, report_consent_at = NOW() WHERE id = ?', [consent ? 1 : 0, req.params.patientId]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Patient not found' });
    res.json({ success: true, message: consent ? 'Patient agreed to digital report delivery.' : 'Patient opted out of digital report delivery.' });
  } catch (error) {
    fail(res, error, 'setConsent');
  }
};

// ── WhatsApp Cloud API webhook ───────────────────────────────────────────────
// GET is Meta's one-time subscription handshake; POST carries message status
// updates (sent / delivered / read / failed), matched to report_deliveries by
// the message id returned when the report was sent. Authenticated by the
// X-Hub-Signature-256 HMAC of the raw body with WHATSAPP_APP_SECRET.

export const whatsappWebhookVerify = (req, res) => {
  const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (token && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token) {
    return res.status(200).send(String(req.query['hub.challenge'] || ''));
  }
  return res.sendStatus(403);
};

const STATUS_MAP = { sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed' };
const RANK = { Queued: 0, Sent: 1, Delivered: 2, Read: 3 };

export const whatsappWebhookReceive = async (req, res) => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const sig = String(req.headers['x-hub-signature-256'] || '');
  if (!secret || !req.rawBody || !sig.startsWith('sha256=')) return res.sendStatus(401);
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const given = sig.slice(7);
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return res.sendStatus(401);
  }

  try {
    const statuses = (req.body?.entry || []).flatMap((e) => e.changes || []).flatMap((c) => c.value?.statuses || []);
    for (const s of statuses) {
      const status = STATUS_MAP[s.status];
      if (!status || !s.id) continue;
      const error = status === 'Failed' ? (s.errors?.[0]?.title || s.errors?.[0]?.message || 'Failed') : null;
      // Statuses can arrive out of order — never move a row backwards
      // (a late "sent" must not overwrite "read").
      const [[row]] = await db.query('SELECT id, status FROM report_deliveries WHERE provider_message_id = ? LIMIT 1', [s.id]);
      if (!row) continue;
      if (status !== 'Failed' && (RANK[row.status] ?? 9) >= RANK[status]) continue;
      await db.query('UPDATE report_deliveries SET status = ?, error = ? WHERE id = ?', [status, error, row.id]);
    }
  } catch (error) {
    console.error('WhatsApp webhook error:', error.message);
  }
  // Always 200 once authenticated, or Meta retries the batch for days.
  res.sendStatus(200);
};
