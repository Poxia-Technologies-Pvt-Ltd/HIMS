import PDFDocument from 'pdfkit';
import db from '../config/db.js';
import { issueToken, getOrIssueSampleToken } from '../utils/queueTokens.js';
import { getPaymentSettings } from '../utils/paymentSettings.js';
import { razorpayEnabled } from '../services/razorpayService.js';

// Self-service queue tokens at the lobby kiosk (tender #9, #47).
//
// POST /api/lab/kiosk-token { branch_id?, query? }
//   query = the patient's mobile number, ABHA number or UHID.
//   - Registered patient with lab tests ordered today at this facility:
//       their order's Sample Collection token (the same one the counter would
//       print — asking twice never creates a second token).
//   - Registered patient with no lab order today, or no query at all (a new
//     patient): a Registration token, so they join the registration queue.
//
// Public and unauthenticated like the rest of the kiosk, so the response is a
// token number, the queue and how many are ahead — never a name or any other
// patient detail. Identifiers are matched exactly (never by substring), the
// same rule as the kiosk report lookup. Every token is written to the queue
// audit log with actor role "Kiosk" and the kiosk's IP.

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || null;

export async function resolveBranch(raw) {
  if (raw) {
    const [[b]] = await db.query("SELECT id, branch_name FROM branches WHERE id = ? AND status = 'Active'", [raw]);
    return b || null;
  }
  // A kiosk set up without ?branch_id= only works in a single-facility install.
  const [rows] = await db.query("SELECT id, branch_name FROM branches WHERE status = 'Active' LIMIT 2");
  return rows.length === 1 ? rows[0] : null;
}

// Exact match on the last 10 digits of the phone, the full ABHA number or the UHID.
export async function findPatients(query) {
  const q = String(query).trim();
  const digits = q.replace(/\D/g, '');
  const regNo = q.toUpperCase().replace(/^CARE-/, '');
  const clauses = ['UPPER(p.reg_no) = ?', 'UPPER(p.reg_no) = ?'];
  const params = [regNo, `CARE-${regNo}`];
  if (digits.length >= 10) {
    clauses.push(`RIGHT(REGEXP_REPLACE(COALESCE(p.telephone, ''), '[^0-9]', ''), 10) = ?`);
    params.push(digits.slice(-10));
  }
  if (digits.length >= 12) {
    clauses.push(`REGEXP_REPLACE(COALESCE(p.abha_id, ''), '[^0-9]', '') = ?`);
    params.push(digits);
  }
  const [rows] = await db.query(
    `SELECT p.id, p.reg_no, CONCAT_WS(' ', p.first_name, p.last_name) AS name, p.first_name, p.last_name, p.dob, p.gender, p.telephone
       FROM patients p WHERE ${clauses.join(' OR ')} ORDER BY p.id LIMIT 6`,
    params);
  return rows;
}

// "Ramesh Kumar", 54, Male → "Ramesh K. · 54 M": enough for the patient (or a family sharing one
// mobile) to recognise their own entry, without printing a surname on a lobby screen.
const cap = (w) => (w ? `${String(w)[0].toUpperCase()}${String(w).slice(1)}` : '');
export function maskedChoice(p) {
  const age = p.dob ? Math.floor((Date.now() - new Date(p.dob).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
  const sex = p.gender ? String(p.gender)[0].toUpperCase() : '';
  return [[cap(p.first_name), p.last_name ? `${p.last_name[0].toUpperCase()}.` : ''].filter(Boolean).join(' '), [age != null ? age : null, sex].filter((x) => x !== null && x !== '').join(' ')]
    .filter(Boolean).join(' · ');
}

// The one patient a kiosk query refers to. Several patients may share a
// mobile number (a family): the kiosk then lists them, masked, and the
// patient picks theirs (pick = position in that list, which is in id order).
export class KioskChoiceNeeded extends Error {
  constructor(choices) { super('More than one patient uses this mobile number. Please choose your name.'); this.choices = choices; }
}
export async function identifyPatient(query, pick) {
  const matches = await findPatients(query);
  if (matches.length > 1) {
    const i = pick === undefined || pick === null || pick === '' ? -1 : Number(pick);
    if (Number.isInteger(i) && i >= 0 && i < matches.length) return matches[i];
    throw new KioskChoiceNeeded(matches.map((m, idx) => ({ pick: idx, label: maskedChoice(m) })));
  }
  return matches[0] || null;
}

const aheadOf = async (conn, branchId, servicePoint, seq) => {
  const [[{ ahead }]] = await conn.query(
    `SELECT COUNT(*) AS ahead FROM patient_queue_tokens
      WHERE branch_id = ? AND token_date = CURDATE() AND service_point = ?
        AND status IN ('Waiting', 'Called', 'In Service') AND seq < ?`, [branchId, servicePoint, seq]);
  return Number(ahead);
};

// 80 mm thermal-printer slip.
async function tokenSlip({ hospital, branch, token }) {
  const doc = new PDFDocument({ size: [226, 250], margins: { top: 16, left: 14, right: 14, bottom: 12 } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const w = 198;
  doc.font('Helvetica-Bold').fontSize(11).text(hospital, { width: w, align: 'center' });
  doc.font('Helvetica').fontSize(9).text(branch, { width: w, align: 'center' });
  doc.moveDown(0.6).fontSize(10).text(`${token.service_point} token`, { width: w, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(64).text(token.token_number, { width: w, align: 'center' });
  doc.font('Helvetica').fontSize(10)
    .text(token.ahead === 0 ? 'You are next' : `${token.ahead} ${token.ahead === 1 ? 'person' : 'people'} ahead of you`, { width: w, align: 'center' });
  doc.moveDown(0.6).fontSize(8.5).fillColor('#444')
    .text(token.service_point === 'Registration'
      ? 'Please wait for your number to be called at the registration counter.'
      : 'Please wait for your number to be called at the sample collection counter.', { width: w, align: 'center' });
  doc.moveDown(0.5).fontSize(8)
    .text(new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), { width: w, align: 'center' });
  doc.end();
  return (await done).toString('base64');
}

export const issueKioskToken = async (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (query && query.replace(/[^0-9A-Za-z]/g, '').length < 4) {
    return res.status(400).json({ success: false, message: 'Enter your mobile number, ABHA number or UHID.' });
  }

  const conn = await db.getConnection();
  try {
    const branch = await resolveBranch(req.body?.branch_id);
    if (!branch) return res.status(400).json({ success: false, message: 'This kiosk is not set up for a facility. Please ask at the counter.' });

    const ip = clientIp(req);
    const actor = { issued_by: null, actor_role: 'Kiosk', ip, issued_via: 'Kiosk' };
    let patient = null;

    if (query) {
      try {
        patient = await identifyPatient(query, req.body?.pick);
      } catch (e) {
        if (e instanceof KioskChoiceNeeded) return res.status(409).json({ success: false, choose: true, choices: e.choices, message: e.message });
        throw e;
      }
      if (!patient) {
        return res.status(404).json({ success: false, not_found: true, message: 'No registration found. Take a Registration token to register at the counter.' });
      }
    }

    await conn.beginTransaction();
    let token = null;
    let paymentDue = 0; // balance on today's order, payable at the kiosk

    if (patient) {
      // Today's order at this facility with lab tests. Billing labels lab
      // items "Collected" as soon as the barcode is printed, so the item status
      // says nothing about the queue — the token's own status does (below).
      const [[bill]] = await conn.query(
        `SELECT b.id, b.billing_type, b.net_amount, b.paid_amount FROM bills b JOIN bill_items bi ON bi.bill_id = b.id
          WHERE b.patient_id = ? AND b.branch_id = ? AND DATE(b.created_at) = CURDATE()
            AND bi.service_type = 'Laboratory' AND bi.status IN ('Pending', 'Collected')
            AND b.payment_status <> 'Cancelled'
          ORDER BY b.id DESC LIMIT 1`, [patient.id, branch.id]);
      if (!bill) {
        const [[order]] = await conn.query(
          `SELECT net_amount, paid_amount FROM bills WHERE patient_id = ? AND branch_id = ? AND DATE(created_at) = CURDATE()
              AND order_state = 'Awaiting payment' ORDER BY id DESC LIMIT 1`, [patient.id, branch.id]);
        const pay = order && await getPaymentSettings(conn, branch.id);
        if (order && razorpayEnabled() && pay.online_kiosk && pay.methods.includes('Online')) {
          paymentDue = Math.max(0, Math.round((Number(order.net_amount) - Number(order.paid_amount || 0)) * 100) / 100);
        }
      }
      if (bill && bill.billing_type !== 'Free_Scheme') {
        paymentDue = Math.max(0, Math.round((Number(bill.net_amount) - Number(bill.paid_amount || 0)) * 100) / 100);
        // Offer "Pay now" only where the hospital allows payment at the kiosk.
        const pay = await getPaymentSettings(conn, branch.id);
        if (!razorpayEnabled() || !pay.online_kiosk || !pay.methods.includes('Online')) paymentDue = 0;
      }
      if (bill) {
        token = await getOrIssueSampleToken(conn, bill.id, { has_lab_items: true, ...actor });
        if (token && ['Completed', 'Cancelled'].includes(token.status)) {
          await conn.rollback();
          return res.status(409).json({ success: false, message: `Token ${token.token_number} for today has already been ${token.status.toLowerCase()}. Please ask at the counter.` });
        }
      }
    }

    if (!token) {
      // Registration queue. A known patient asking again gets their open token back.
      if (patient) {
        const [[open]] = await conn.query(
          `SELECT id, token_number, seq, status FROM patient_queue_tokens
            WHERE branch_id = ? AND token_date = CURDATE() AND service_point = 'Registration'
              AND patient_reg_no = ? AND status IN ('Waiting', 'Called', 'In Service') LIMIT 1`, [branch.id, patient.reg_no]);
        if (open) {
          token = { ...open, service_point: 'Registration', ahead: await aheadOf(conn, branch.id, 'Registration', open.seq), reused: true };
        }
      }
      token ||= await issueToken(conn, {
        branch_id: branch.id, service_point: 'Registration',
        patient_reg_no: patient?.reg_no || null, patient_name: patient?.name || null, ...actor,
      });
    }
    await conn.commit();

    const [[settings]] = await db.query('SELECT hospital_name FROM hospital_settings LIMIT 1');
    const slip = await tokenSlip({
      hospital: settings?.hospital_name || branch.branch_name, branch: branch.branch_name, token,
    });

    res.json({
      success: true,
      token_number: token.token_number,
      service_point: token.service_point,
      status: token.status,
      ahead: Number(token.ahead) || 0,
      reused: !!token.reused,
      payment_due: paymentDue,
      // How the patient may pay here: an on-screen UPI QR, or a link sent to
      // the mobile number registered for them (shown masked).
      pay_options: paymentDue > 0 ? {
        qr: true,
        sms_to: String(patient?.telephone || '').replace(/\D/g, '').length >= 10
          ? `xxxxxx${String(patient.telephone).replace(/\D/g, '').slice(-4)}` : null,
      } : null,
      slip_pdf: slip,
    });
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('Kiosk token error:', error);
    res.status(500).json({ success: false, message: 'Could not issue a token. Please ask at the counter.' });
  } finally {
    conn.release();
  }
};
