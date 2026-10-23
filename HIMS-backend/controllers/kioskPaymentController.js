import crypto from 'crypto';
import QRCode from 'qrcode';
import db from '../config/db.js';
import { razorpayEnabled, GatewayError } from '../services/razorpayService.js';
import { PaymentError } from '../utils/billPayments.js';
import { getPaymentSettings } from '../utils/paymentSettings.js';
import {
  payableBill, openCheckout, verifyCheckoutCallback, assertOnlineAllowed,
  openUpiQr, sendPaymentLink, checkTransaction, withdrawGatewayTxn,
} from './paymentController.js';
import { resolveBranch, identifyPatient, KioskChoiceNeeded, maskedChoice } from './kioskTokenController.js';
import { labPrices } from '../utils/testPricing.js';
import { applyRegistrationRule } from '../utils/paymentSettings.js';
import { generateBillNumber } from './billingController.js';

// Paying for today's lab order at the lobby kiosk with Razorpay. Two ways:
//   - a UPI QR drawn on the kiosk screen, paid from any UPI app;
//   - a payment link sent by SMS to the patient's registered mobile.
// Public like the rest of the kiosk: the patient proves the order is theirs
// with the same exact identifier match (mobile / ABHA / UHID), the amount is
// always the bill's balance at that facility's prices (never from the screen),
// and payment is only ever confirmed from Razorpay itself. Free-scheme orders
// have nothing due and never reach here.

const fail = (res, error) => {
  if (error instanceof KioskChoiceNeeded) return res.status(409).json({ success: false, choose: true, choices: error.choices, message: error.message });
  if (error instanceof PaymentError) return res.status(error.status).json({ success: false, message: error.message });
  if (error instanceof GatewayError) return res.status(502).json({ success: false, message: 'Online payment is not available right now. Please pay at the counter.' });
  console.error('Kiosk payment error:', error);
  return res.status(500).json({ success: false, message: 'Could not start the payment. Please pay at the counter.' });
};

// The kiosk polls a payment by transaction id; the key proves it started it.
const pollKey = (txnId) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'kiosk').update(`kiosk-pay:${txnId}`).digest('hex').slice(0, 32);
const keyValid = (txnId, key) => {
  const a = Buffer.from(pollKey(txnId)); const b = Buffer.from(String(key || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Today's unpaid order at this facility for the patient the kiosk identified.
async function kioskBill(body) {
  if (!razorpayEnabled()) throw new PaymentError('Online payment is not available at this kiosk. Please pay at the counter.', 503);
  const query = String(body?.query || '').trim();
  if (query.replace(/[^0-9A-Za-z]/g, '').length < 4) throw new PaymentError('Enter your mobile number, ABHA number or UHID.');
  const branch = await resolveBranch(body?.branch_id);
  if (!branch) throw new PaymentError('This kiosk is not set up for a facility. Please pay at the counter.');

  const patient = await identifyPatient(query, body?.pick);
  if (!patient) throw new PaymentError('No registration found. Please ask at the counter.', 404);

  let billId;
  if (Array.isArray(body?.test_ids) && body.test_ids.length) {
    // The patient chose tests at the kiosk: a payment-first order at this
    // facility's prices (nothing is booked until the payment is confirmed).
    await assertOnlineAllowed(branch.id, 'online_kiosk');
    billId = await createKioskOrder({ branch, patient, testIds: body.test_ids, ip: clientIp(body.__req) });
  } else {
    const [[row]] = await db.query(
      `SELECT id FROM bills WHERE patient_id = ? AND branch_id = ? AND DATE(created_at) = CURDATE()
          AND billing_type = 'Standard' AND payment_status IN ('Pending', 'Partial') AND net_amount > COALESCE(paid_amount, 0)
          AND order_state <> 'Cancelled'
        ORDER BY id DESC LIMIT 1`, [patient.id, branch.id]);
    if (!row) throw new PaymentError('There is nothing to pay for today.', 404);
    billId = row.id;
  }

  const { bill, due } = await payableBill(billId);
  await assertOnlineAllowed(bill.branch_id, 'online_kiosk');
  let [items] = await db.query('SELECT service_name, total_price FROM bill_items WHERE bill_id = ? ORDER BY id', [bill.id]);
  if (!items.length) {
    // An order awaiting online payment gets its lines only once paid.
    const [[p]] = await db.query('SELECT pending_order FROM bills WHERE id = ?', [bill.id]);
    const pending = typeof p?.pending_order === 'string' ? JSON.parse(p.pending_order) : p?.pending_order;
    items = (pending?.items || []).map((i) => ({ service_name: i.service_name, total_price: i.total_price }));
  }
  return {
    branch, bill, due,
    // The patient's name and contact stay off a lobby screen.
    items: items.map((i) => ({ name: i.service_name, amount: Number(i.total_price) })),
  };
}

const clientIp = (req) => String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '').split(',')[0].trim() || null;
const KIOSK_NOTE = 'Kiosk self-service';

// Withdraws the unpaid kiosk orders a patient left behind today (they changed
// their mind, switched from QR to link…). Open QRs / links for them are closed.
async function withdrawKioskOrders(conn, { patientId, branchId, billId = null }) {
  const [old] = await conn.query(
    `SELECT id FROM bills WHERE order_state = 'Awaiting payment' AND paid_amount = 0 AND notes = ? AND DATE(created_at) = CURDATE()
        AND ${billId ? 'id = ?' : 'patient_id = ? AND branch_id = ?'}`,
    [KIOSK_NOTE, ...(billId ? [billId] : [patientId, branchId])]);
  const toClose = [];
  for (const o of old) {
    // eslint-disable-next-line no-await-in-loop
    await conn.query("UPDATE bills SET order_state = 'Cancelled', payment_status = 'Cancelled', status = 'Inactive', pending_order = NULL WHERE id = ?", [o.id]);
    // eslint-disable-next-line no-await-in-loop
    const [open] = await conn.query("SELECT id, kind, gateway_ref FROM payment_gateway_transactions WHERE bill_id = ? AND status = 'Created'", [o.id]);
    toClose.push(...open);
  }
  return toClose;
}
const closeAll = (txns) => Promise.all(txns.map((t) => withdrawGatewayTxn(t, 'Order changed at the kiosk')
  .catch((e) => console.error(`kiosk: could not close ${t.kind} ${t.gateway_ref}:`, e.message))));

// An unpaid, payment-first order for the tests the patient picked.
async function createKioskOrder({ branch, patient, testIds, ip }) {
  const ids = [...new Set(testIds.map(Number).filter(Boolean))].slice(0, 25);
  if (!ids.length) throw new PaymentError('Choose at least one test.');
  const conn = await db.getConnection();
  let toClose = [];
  try {
    await conn.beginTransaction();
    const [tests] = await conn.query(
      `SELECT lt.id, lt.test_code, lt.test_name, lt.lab_id, i.name AS lab_name FROM lab_tests lt
         LEFT JOIN infrastructure i ON i.id = lt.lab_id WHERE lt.id IN (?) AND lt.status = 'Active'`, [ids]);
    if (tests.length !== ids.length) throw new PaymentError('One of the chosen tests is not available. Please choose again.');

    // A test already ordered today and not yet collected is never booked twice.
    const [dups] = await conn.query(
      `SELECT DISTINCT bi.service_name FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
        WHERE b.patient_id = ? AND b.branch_id = ? AND DATE(b.created_at) = CURDATE() AND b.payment_status <> 'Cancelled'
          AND bi.service_type = 'Laboratory' AND bi.service_id IN (?) AND bi.status IN ('Pending', 'Collected')`, [patient.id, branch.id, ids]);
    if (dups.length) throw new PaymentError(`Already ordered today: ${dups.map((d) => d.service_name).join(', ')}.`, 409);

    const prices = await labPrices(conn, branch.id, ids);
    const labLines = tests.map((t) => ({
      service_type: 'Laboratory', service_id: t.id, service_name: t.test_name, service_code: t.test_code, lab_id: t.lab_id, lab_name: t.lab_name,
      quantity: 1, unit_price: prices.get(t.id) ?? 0, total_price: prices.get(t.id) ?? 0,
    }));
    const settings = await getPaymentSettings(conn, branch.id);
    const { items, registration } = await applyRegistrationRule(conn, {
      items: [{ service_type: 'Registration', service_name: 'Registration Fee', quantity: 1, unit_price: 0, total_price: 0 }, ...labLines],
      patientId: patient.id, settings,
    });
    const total = Math.round(items.reduce((s, i) => s + Number(i.total_price || 0), 0) * 100) / 100;
    if (!(total >= 1)) throw new PaymentError('These tests have no price set at this hospital. Please pay at the counter.', 409);

    toClose = await withdrawKioskOrders(conn, { patientId: patient.id, branchId: branch.id });
    const [[b]] = await conn.query('SELECT hospital_code FROM branches WHERE id = ?', [branch.id]);
    const [[full]] = await conn.query('SELECT first_name, last_name, telephone FROM patients WHERE id = ?', [patient.id]);
    const name = `${full.first_name} ${full.last_name}`.trim();
    const billNumber = generateBillNumber('ORD');
    const [r] = await conn.query(
      `INSERT INTO bills (bill_number, patient_id, patient_name, patient_phone, total_amount, discount_amount, net_amount,
          payment_method, payment_status, paid_amount, status, notes, branch_id, priority, billing_type, order_state)
        VALUES (?, ?, ?, ?, ?, 0, ?, 'Online', 'Pending', 0, 'Active', ?, ?, 'Routine', 'Standard', 'Awaiting payment')`,
      [billNumber, patient.id, name, full.telephone, total, total, KIOSK_NOTE, branch.id]);
    await conn.query('UPDATE bills SET pending_order = ? WHERE id = ?', [JSON.stringify({
      branch_id: branch.id, patient_id: patient.id, items, overwrite_duplicates: false, user_id: null, priority: 'Routine',
      notes: KIOSK_NOTE, appointment_booking: null, patient_name: name, final_patient_name: name, final_patient_phone: full.telephone,
      sampleActor: { id: null, role: 'Kiosk', ip, device: null }, hospital_code: b?.hospital_code || 'BILL', registration,
    }), r.insertId]);
    await conn.commit();
    await closeAll(toClose);
    return r.insertId;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// POST /api/lab/kiosk-payment/identify { branch_id?, query, pick? } — who is this,
// and what can they do next. Read-only: nothing is issued or created here.
export const kioskIdentify = async (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    if (query.replace(/[^0-9A-Za-z]/g, '').length < 4) throw new PaymentError('Enter your mobile number, ABHA number or UHID.');
    const branch = await resolveBranch(req.body?.branch_id);
    if (!branch) throw new PaymentError('This kiosk is not set up for a facility. Please ask at the counter.');
    const patient = await identifyPatient(query, req.body?.pick);
    if (!patient) return res.status(404).json({ success: false, not_found: true, message: 'No registration found.' });
    // Already ordered at the counter today? Then it is their token, not a new order.
    const [[order]] = await db.query(
      `SELECT b.id FROM bills b JOIN bill_items bi ON bi.bill_id = b.id
        WHERE b.patient_id = ? AND b.branch_id = ? AND DATE(b.created_at) = CURDATE() AND b.order_state = 'Confirmed'
          AND b.payment_status <> 'Cancelled' AND bi.service_type = 'Laboratory' AND bi.status IN ('Pending', 'Collected') LIMIT 1`,
      [patient.id, branch.id]);
    const pay = await getPaymentSettings(db, branch.id);
    res.json({
      success: true, label: maskedChoice(patient), has_order_today: !!order,
      // Where the payment link would go — only ever the registered mobile, shown masked.
      sms_to: String(patient.telephone || '').replace(/\D/g, '').length >= 10 ? `xxxxxx${String(patient.telephone).replace(/\D/g, '').slice(-4)}` : null,
      can_pay_online: razorpayEnabled() && pay.methods.includes('Online') && pay.online_kiosk,
    });
  } catch (error) { fail(res, error); }
};

// GET /api/lab/kiosk-payment/tests?branch_id=&q= — tests the patient can choose,
// at this facility's prices.
export const kioskTests = async (req, res) => {
  try {
    const branch = await resolveBranch(req.query.branch_id);
    if (!branch) throw new PaymentError('This kiosk is not set up for a facility.');
    const q = String(req.query.q || '').trim().slice(0, 40);
    const [rows] = await db.query(
      `SELECT lt.id, lt.test_code AS code, lt.test_name AS name, COALESCE(p.price, lt.price) AS price, lc.name AS category
         FROM lab_tests lt
         LEFT JOIN lab_test_branch_prices p ON p.test_id = lt.id AND p.branch_id = ? AND p.is_active = 1
         LEFT JOIN lab_categories lc ON lc.id = lt.category_id
        WHERE lt.status = 'Active' AND COALESCE(p.price, lt.price) > 0 ${q ? 'AND (lt.test_name LIKE ? OR lt.test_code LIKE ?)' : ''}
        ORDER BY lt.test_name LIMIT 300`, q ? [branch.id, `%${q}%`, `%${q}%`] : [branch.id]);
    res.json({ success: true, tests: rows.map((t) => ({ ...t, price: Number(t.price) })) });
  } catch (error) { fail(res, error); }
};

// POST /api/lab/kiosk-payment/qr { branch_id?, query, pick? } — UPI QR for the amount due.
export const kioskPaymentQr = async (req, res) => {
  try {
    const { branch, bill, due, items } = await kioskBill({ ...req.body, __req: req });
    const qr = await openUpiQr({ bill, charge: due, actorLabel: 'Kiosk' });
    const image = qr.qr_picture || await QRCode.toDataURL(qr.qr_content, { width: 520, margin: 1, errorCorrectionLevel: 'M' });
    res.json({
      success: true, due, items, facility: branch.branch_name,
      txn_id: qr.txn_id, key: pollKey(qr.txn_id), kind: qr.kind, qr_image: image, expires_at: qr.expires_at,
    });
  } catch (error) { fail(res, error); }
};

// POST /api/lab/kiosk-payment/link { branch_id?, query, pick? } — payment link by
// SMS, only ever to the mobile number registered for the patient.
export const kioskPaymentLink = async (req, res) => {
  try {
    const { bill, due } = await kioskBill({ ...req.body, __req: req });
    const settings = await getPaymentSettings(db, bill.branch_id);
    const link = await sendPaymentLink({ bill, charge: due, actorLabel: 'Kiosk', expiryHours: settings.link_expiry_hours });
    res.json({
      success: true, due, txn_id: link.txn_id, key: pollKey(link.txn_id), sent_to: link.masked_phone,
      message: `Payment link for ₹${due} sent to ${link.masked_phone}.`,
    });
  } catch (error) { fail(res, error); }
};

// GET /api/lab/kiosk-payment/status/:txnId?key= — polled while the kiosk waits.
export const kioskPaymentStatus = async (req, res) => {
  try {
    if (!keyValid(req.params.txnId, req.query.key)) throw new PaymentError('Payment not recognised.', 404);
    let [[txn]] = await db.query('SELECT * FROM payment_gateway_transactions WHERE id = ?', [req.params.txnId]);
    if (!txn) throw new PaymentError('Payment not recognised.', 404);
    // Ask Razorpay at most every few seconds; the webhook usually gets there first.
    const stale = !txn.last_checked_at || Date.now() - new Date(txn.last_checked_at).getTime() > 3000;
    if (txn.status === 'Created' && !txn.gateway_ref.startsWith('pending-') && stale) {
      try { await checkTransaction(txn); } catch (e) { console.error(`kiosk status check ${txn.id}:`, e.message); }
      [[txn]] = await db.query('SELECT * FROM payment_gateway_transactions WHERE id = ?', [txn.id]);
    }
    if (txn.status !== 'Paid') return res.json({ success: true, status: txn.status });

    const [[receipt]] = await db.query('SELECT receipt_no FROM bill_payments WHERE gateway_txn_id = ?', [txn.id]);
    const [[bill]] = await db.query('SELECT payment_status FROM bills WHERE id = ?', [txn.bill_id]);
    const [[token]] = await db.query(
      `SELECT token_number FROM patient_queue_tokens WHERE bill_id = ? AND service_point = 'Sample Collection'
         AND token_date = CURDATE() ORDER BY id DESC LIMIT 1`, [txn.bill_id]);
    res.json({
      success: true, status: 'Paid', receipt_no: receipt?.receipt_no || null,
      payment_status: bill?.payment_status, refund_due: !receipt,
      queue_token: token ? { token_number: token.token_number, service_point: 'Sample Collection' } : null,
    });
  } catch (error) { fail(res, error); }
};

// POST /api/lab/kiosk-payment/cancel { txn_id, key } — the patient left the QR
// screen: close the QR so it can no longer be paid. A payment that beat the
// close is still settled (checked first).
export const kioskPaymentCancel = async (req, res) => {
  try {
    const { txn_id: txnId, key } = req.body || {};
    if (!keyValid(txnId, key)) throw new PaymentError('Payment not recognised.', 404);
    const [[txn]] = await db.query('SELECT * FROM payment_gateway_transactions WHERE id = ?', [txnId]);
    if (!txn || txn.status !== 'Created') return res.json({ success: true, status: txn?.status || null });
    if (txn.kind === 'Checkout' || txn.gateway_ref.startsWith('pending-')) return res.json({ success: true, status: txn.status });
    const out = await checkTransaction(txn).catch(() => ({ status: 'Created' }));
    if (out.status === 'Created') {
      await withdrawGatewayTxn(txn, 'Closed at the kiosk');
      // The order was never paid, so it is withdrawn with the QR.
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const toClose = await withdrawKioskOrders(conn, { billId: txn.bill_id });
        await conn.commit();
        await closeAll(toClose);
      } catch (e) { await conn.rollback().catch(() => {}); console.error('kiosk cancel order:', e.message); } finally { conn.release(); }
    }
    res.json({ success: true, status: out.status === 'Created' ? 'Cancelled' : out.status });
  } catch (error) { fail(res, error); }
};

// ── Razorpay Checkout at the kiosk (earlier flow, kept for existing kiosks) ──

// POST /api/lab/kiosk-payment/order { branch_id?, query, pick? }
export const kioskPaymentOrder = async (req, res) => {
  try {
    const { branch, bill, due, items } = await kioskBill({ ...req.body, __req: req });
    const { patient_name: _n, contact: _c, email: _e, ...checkout } = await openCheckout({ bill, charge: due, actorLabel: 'Kiosk' });
    res.json({ success: true, due, items, ...checkout, facility: branch.branch_name });
  } catch (error) { fail(res, error); }
};

// POST /api/lab/kiosk-payment/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature }
export const kioskPaymentVerify = async (req, res) => {
  try {
    const s = await verifyCheckoutCallback(req.body || {});
    res.json({
      success: true, receipt_no: s.receipt_no, payment_status: s.payment_status,
      // An order confirmed by this payment brings its Sample Collection token.
      queue_token: s.queue_token ? { token_number: s.queue_token.token_number, service_point: 'Sample Collection' } : null,
      message: `Payment received. Receipt ${s.receipt_no}.`,
    });
  } catch (error) { fail(res, error); }
};
