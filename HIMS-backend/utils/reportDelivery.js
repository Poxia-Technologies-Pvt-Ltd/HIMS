import db from '../config/db.js';
import { sendWhatsAppMessage } from '../services/whatsappService.js';
import { sendLabReportEmail } from '../services/emailService.js';
import { generateLabReportPDFStream } from './pdfGenerator.js';

// Report delivery: the one path every authorised report takes to a patient by
// WhatsApp or e-mail, and the log of every delivery, kiosk view/print and
// portal download (report_deliveries). Rules enforced here, so no caller can
// skip them:
//   - only an Approved report is ever sent;
//   - it goes only to the mobile / e-mail registered on the patient record;
//   - a patient who refused digital delivery (patients.report_consent = 0)
//     gets nothing — the attempt is logged as Blocked;
//   - every attempt is logged, and a failed one keeps its error for resend.

export class DeliveryError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const digits10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
export const maskPhone = (p) => { const d = digits10(p); return d.length >= 4 ? `xxxxxx${d.slice(-4)}` : null; };
export const maskEmail = (e) => {
  const [user, domain] = String(e || '').split('@');
  return domain ? `${user.slice(0, 2)}***@${domain}` : null;
};
export const clientIp = (req) =>
  String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '').split(',')[0].trim() || null;

async function nameOf(actor) {
  if (!actor?.id) return null;
  const [[u]] = await db.query("SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [actor.id]);
  return u?.name || null;
}

// The approved report's patient and contact details.
export async function reportOwner(sampleId) {
  const [[row]] = await db.query(
    `SELECT tr.patient_id, tr.branch_id, tr.test_name, p.telephone, p.email_id, p.report_consent,
            CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name
       FROM lab_test_result tr
       LEFT JOIN patients p ON p.id = tr.patient_id
      WHERE tr.sample_id = ? AND tr.status = 'Approved'
      ORDER BY tr.id DESC LIMIT 1`,
    [sampleId]
  );
  return row || null;
}

// Never throws: a logging failure must not stop a patient getting a report.
export async function recordDelivery({ sampleId, channel, recipient = null, status, error = null, provider = null,
  providerMessageId = null, triggeredBy, actor = null, req = null, resendOf = null, owner = null }) {
  try {
    const o = owner || (await reportOwner(sampleId)) || {};
    const [r] = await db.query(
      `INSERT INTO report_deliveries (sample_id, patient_id, branch_id, channel, recipient, status, error, provider,
                                      provider_message_id, triggered_by, actor_id, actor_name, ip_address, resend_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sampleId, o.patient_id || null, o.branch_id || null, channel, recipient, status, error ? String(error).slice(0, 500) : null,
       provider, providerMessageId, triggeredBy, actor?.id || null, await nameOf(actor), clientIp(req), resendOf]
    );
    return r.insertId;
  } catch (e) {
    console.error('recordDelivery failed:', e.message);
    return null;
  }
}

export async function updateDelivery(id, { status, error = null, provider = null, providerMessageId = null }) {
  if (!id) return;
  try {
    await db.query(
      `UPDATE report_deliveries SET status = ?, error = ?, provider = COALESCE(?, provider),
              provider_message_id = COALESCE(?, provider_message_id) WHERE id = ?`,
      [status, error ? String(error).slice(0, 500) : null, provider, providerMessageId, id]
    );
  } catch (e) {
    console.error('updateDelivery failed:', e.message);
  }
}

async function reportPdf(buildData, sampleId) {
  const data = await buildData(sampleId);
  if (!data) return null;
  const doc = await generateLabReportPDFStream(data);
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

async function whatsappCaption(owner, sampleId) {
  const [[s]] = await db.query('SELECT hospital_name FROM hospital_settings LIMIT 1').catch(() => [[null]]);
  return [
    `🏥 *${(s?.hospital_name || 'Hospital').toUpperCase()}*`,
    ``,
    `✅ *Report Ready!*`,
    `👤 *Patient:* ${owner.patient_name || 'Patient'}`,
    `🔬 *Test:* ${owner.test_name || 'Lab Test'}`,
    `🆔 *Sample ID:* ${sampleId}`,
    ``,
    `_Please find your lab report attached as PDF. Scan the QR code on it to verify it is genuine._`,
  ].join('\n');
}

/**
 * Send an approved report to the patient's registered WhatsApp number or
 * e-mail address and log it. `recipient`, when given, must match what is on
 * file (the kiosk passes the number the patient typed; staff pass nothing).
 * `buildData` is labController.buildLabReportData, passed in so this module
 * stays independent of the controller. Resolves to { deliveryId, recipient }
 * (recipient masked) or throws DeliveryError with an HTTP status.
 */
export async function dispatchReport({ sampleId, channel, buildData, recipient = null, triggeredBy, actor = null, req = null, resendOf = null }) {
  if (!['WhatsApp', 'Email'].includes(channel)) throw new DeliveryError('Unsupported delivery channel');
  const owner = await reportOwner(sampleId);
  if (!owner) throw new DeliveryError('Approved report not found for this sample', 404);

  const to = channel === 'Email' ? String(owner.email_id || '').trim() : owner.telephone;
  if (!to) {
    throw new DeliveryError(channel === 'Email'
      ? 'No e-mail address is registered for this patient'
      : 'No mobile number is registered for this patient', 409);
  }
  if (recipient) {
    const same = channel === 'Email'
      ? String(recipient).trim().toLowerCase() === to.toLowerCase()
      : digits10(recipient).length === 10 && digits10(recipient) === digits10(to);
    if (!same) throw new DeliveryError(`Reports are sent only to the ${channel === 'Email' ? 'e-mail address' : 'mobile number'} registered for this patient`, 403);
  }

  const masked = channel === 'Email' ? maskEmail(to) : maskPhone(to);
  const base = { sampleId, channel, recipient: masked, triggeredBy, actor, req, resendOf, owner };

  if (owner.report_consent === 0) {
    await recordDelivery({ ...base, status: 'Blocked', error: 'Patient has opted out of digital report delivery' });
    throw new DeliveryError('This patient has opted out of digital report delivery. Please hand over a printed copy.', 403);
  }

  const deliveryId = await recordDelivery({ ...base, status: 'Queued' });
  try {
    const pdf = await reportPdf(buildData, sampleId);
    if (!pdf) throw new DeliveryError('Report not found or not approved', 404);
    let provider; let messageId;
    if (channel === 'WhatsApp') {
      ({ provider, messageId } = await sendWhatsAppMessage(to, await whatsappCaption(owner, sampleId), pdf.toString('base64'), `lab-report-${sampleId}.pdf`));
    } else {
      provider = 'smtp';
      messageId = await sendLabReportEmail(to, { patientName: owner.patient_name, testName: owner.test_name, sampleId }, pdf);
    }
    await updateDelivery(deliveryId, { status: 'Sent', provider, providerMessageId: messageId });
    return { deliveryId, recipient: masked };
  } catch (e) {
    await updateDelivery(deliveryId, { status: 'Failed', error: e.message });
    if (e instanceof DeliveryError) throw e;
    console.error(`dispatchReport ${channel} failed:`, e.message);
    throw new DeliveryError(`Could not send the report by ${channel === 'Email' ? 'e-mail' : 'WhatsApp'}. It has been logged for resend.`, 502);
  }
}
