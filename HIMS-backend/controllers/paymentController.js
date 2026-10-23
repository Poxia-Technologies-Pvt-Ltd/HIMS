import db from '../config/db.js';
import {
  razorpayEnabled, razorpayKeyId, toPaise, toRupees, GatewayError,
  createOrder, orderPayments, fetchPayment, capturePayment,
  createPaymentLink, fetchPaymentLink, cancelPaymentLink,
  checkoutSignatureValid, webhookSignatureValid,
  createUpiQr, fetchUpiQr, upiQrPayments, closeUpiQr,
} from '../services/razorpayService.js';
import { recordBillPayment, balanceDue, PaymentError } from '../utils/billPayments.js';
import { getPaymentSettings } from '../utils/paymentSettings.js';
import { fulfilOrder, generateBillNumber } from './billingController.js';
import { sendOrderConfirmation } from '../utils/orderNotify.js';
import { PNG } from 'pngjs';

// The hospital's switch for where Razorpay may be used: 'online_counter',
// 'online_link' or 'online_kiosk' (Settings → Payment Settings).
export async function assertOnlineAllowed(branchId, channel) {
  const settings = await getPaymentSettings(db, branchId);
  const labels = { online_counter: 'at the billing counter', online_link: 'by payment link', online_kiosk: 'at the kiosk' };
  if (!settings.methods.includes('Online') || !settings[channel]) {
    throw new PaymentError(`Online payment ${labels[channel]} is not enabled at this hospital.`, 403);
  }
  return settings;
}

// Online payment for paid investigations through Razorpay (tender #7):
// payment initiation (Checkout at the counter or kiosk, or a payment link to
// the patient's phone), transaction status, receipt / reference capture and
// reconciliation. A gateway payment reaches the bill only through settle(),
// which is idempotent — the browser callback, the webhook and reconciliation
// can all report the same payment and it is still counted once.
// Free-scheme (NFDS) bills have nothing due and are refused before any
// gateway call: free diagnostics never depend on payment.

const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null);

async function userName(id) {
  if (!id) return null;
  const [[u]] = await db.query("SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [id]);
  return u?.name || null;
}

const fail = (res, error, what) => {
  if (error instanceof PaymentError) return res.status(error.status).json({ success: false, message: error.message });
  if (error instanceof GatewayError) return res.status(502).json({ success: false, message: error.message });
  console.error(`${what}:`, error);
  return res.status(500).json({ success: false, message: 'Server error' });
};

// The bill a payment is for, and how much may be charged now.
export async function payableBill(billId, { branchScope = null, amount = null } = {}) {
  const [[bill]] = await db.query(
    `SELECT b.id, b.bill_number, b.branch_id, b.patient_id, b.billing_type, b.net_amount, b.paid_amount, b.payment_status, b.order_state,
            COALESCE(CONCAT_WS(' ', p.first_name, p.last_name), b.patient_name) AS patient_name,
            COALESCE(p.telephone, b.patient_phone) AS phone, p.email_id
       FROM bills b LEFT JOIN patients p ON p.id = b.patient_id
      WHERE b.id = ? ${branchScope ? 'AND b.branch_id = ?' : ''}`,
    branchScope ? [billId, branchScope] : [billId]);
  if (!bill) throw new PaymentError('Bill not found', 404);
  if (bill.billing_type === 'Free_Scheme') throw new PaymentError('This is a free-scheme order — no payment is due.', 409);
  if (bill.payment_status === 'Cancelled') throw new PaymentError('This bill has been cancelled.', 409);
  const due = balanceDue(bill);
  if (!(due > 0)) throw new PaymentError('Nothing is due on this bill.', 409);
  const charge = amount == null || amount === '' ? due : Math.round(Number(amount) * 100) / 100;
  if (!(charge >= 1)) throw new PaymentError('The amount must be at least ₹1.');
  if (charge > due) throw new PaymentError(`The amount cannot exceed the balance due (₹${due}).`);
  if (bill.order_state === 'Cancelled') throw new PaymentError('This order has been cancelled.', 409);
  if (bill.order_state === 'Awaiting payment' && charge !== due) {
    throw new PaymentError(`This order is confirmed only on full payment (₹${due}).`, 400);
  }
  return { bill, due, charge };
}

// ── Settlement ──────────────────────────────────────────────────────────────

const CHANNEL = { Checkout: 'Razorpay Checkout', 'Payment link': 'Razorpay Link', 'UPI QR': 'Razorpay QR' };

// Applies a captured Razorpay payment to its transaction and bill, once.
async function settle(txnId, payment) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[txn]] = await conn.query('SELECT * FROM payment_gateway_transactions WHERE id = ? FOR UPDATE', [txnId]);
    if (!txn) throw new PaymentError('Transaction not found', 404);
    if (txn.status === 'Paid') {
      await conn.commit();
      const [[r]] = await db.query('SELECT receipt_no FROM bill_payments WHERE gateway_txn_id = ?', [txn.id]);
      return { already: true, receipt_no: r?.receipt_no || null, txn };
    }
    const amount = toRupees(payment.amount);
    const [[bill]] = await conn.query('SELECT order_state, pending_order FROM bills WHERE id = ? FOR UPDATE', [txn.bill_id]);
    if (bill?.order_state === 'Cancelled') {
      // The order was withdrawn before this payment arrived: keep the record
      // for refund, but book nothing against the cancelled order.
      await conn.query(
        `UPDATE payment_gateway_transactions SET status = 'Paid', gateway_payment_id = ?, pay_method = ?, paid_at = NOW(),
                last_checked_at = NOW(), error = 'Paid after the order was cancelled — refund due' WHERE id = ?`,
        [payment.id, payment.method || null, txn.id]);
      await conn.commit();
      return { already: false, refund_due: true, receipt_no: null, txn };
    }
    const r = await recordBillPayment(conn, {
      bill_id: txn.bill_id, amount, method: 'Online', channel: CHANNEL[txn.kind],
      reference: payment.id, gateway_txn_id: txn.id, actor_id: txn.created_by, actor_name: txn.created_by_name,
    });
    await conn.query(
      `UPDATE payment_gateway_transactions SET status = 'Paid', gateway_payment_id = ?, pay_method = ?, error = NULL,
              paid_at = NOW(), last_checked_at = NOW() WHERE id = ?`,
      [payment.id, payment.method || null, txn.id]);
    let confirmed = false;
    if (bill?.order_state === 'Awaiting payment' && r.payment_status === 'Paid') {
      // Paid in full: the order becomes real now — invoice number, test
      // lines, sample IDs, queue token — in the same transaction as the
      // receipt, so a payment is never recorded without its order.
      const pending = typeof bill.pending_order === 'string' ? JSON.parse(bill.pending_order) : bill.pending_order;
      const bill_number = generateBillNumber(pending.hospital_code || 'BILL');
      await conn.query("UPDATE bills SET bill_number = ?, order_state = 'Confirmed', pending_order = NULL WHERE id = ?", [bill_number, txn.bill_id]);
      const order = await fulfilOrder(conn, { ...pending, bill_id: txn.bill_id, bill_number, duplicatePolicy: 'ignore', notifyBooked: false });
      confirmed = true;
      r.bill_number = bill_number;
      r.queue_token = order.queue_token;
    }
    await conn.commit();
    // The patient gets the invoice and token on WhatsApp once the order is real.
    if (confirmed) sendOrderConfirmation(txn.bill_id);
    if (r.payment_status === 'Paid') await withdrawOpenLinks(txn.bill_id, txn.id);
    return { already: false, ...r, txn };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// Withdraws an open payment link or UPI QR at Razorpay (so it can no longer
// be paid) and marks the attempt Cancelled.
export async function withdrawGatewayTxn(t, reason) {
  if (!t.gateway_ref.startsWith('pending-')) {
    if (t.kind === 'Payment link') await cancelPaymentLink(t.gateway_ref);
    else if (t.kind === 'UPI QR') await closeUpiQr(t.gateway_ref);
  }
  await db.query("UPDATE payment_gateway_transactions SET status = 'Cancelled', error = ? WHERE id = ? AND status = 'Created'", [reason, t.id]);
}

// Once a bill is fully paid, any payment link or UPI QR still out for it is
// withdrawn, so the patient cannot pay twice. Best effort — one that cannot
// be withdrawn is left for reconciliation to report.
async function withdrawOpenLinks(billId, exceptTxnId) {
  const [open] = await db.query(
    "SELECT id, kind, gateway_ref FROM payment_gateway_transactions WHERE bill_id = ? AND id <> ? AND kind IN ('Payment link', 'UPI QR') AND status = 'Created'",
    [billId, exceptTxnId]);
  for (const t of open) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await withdrawGatewayTxn(t, 'Bill paid by another payment');
    } catch (e) {
      console.error(`could not withdraw ${t.kind} ${t.gateway_ref}:`, e.message);
    }
  }
}

// Authorised-but-uncaptured payments are captured (accounts without
// auto-capture), so money is never left hanging on the patient's card.
async function ensureCaptured(payment) {
  if (payment.status === 'authorized') return capturePayment(payment.id, payment.amount);
  return payment;
}

// Asks Razorpay where a transaction stands and brings it up to date.
export async function checkTransaction(txn) {
  if (txn.status !== 'Created') return { status: txn.status };
  if (txn.kind === 'Checkout') {
    const { items = [] } = await orderPayments(txn.gateway_ref);
    let paid = items.find((p) => p.status === 'captured');
    if (!paid) {
      const authorised = items.find((p) => p.status === 'authorized');
      if (authorised) paid = await ensureCaptured(authorised);
    }
    if (paid && paid.status === 'captured') {
      const s = await settle(txn.id, paid);
      return { status: 'Paid', receipt_no: s.receipt_no, queue_token: s.queue_token || null, refund_due: !!s.refund_due };
    }
    const lastFail = items.filter((p) => p.status === 'failed').pop();
    await db.query('UPDATE payment_gateway_transactions SET last_checked_at = NOW(), error = COALESCE(?, error) WHERE id = ?',
      [lastFail?.error_description || null, txn.id]);
    return { status: 'Created', error: lastFail?.error_description || null };
  }
  if (txn.kind === 'UPI QR') {
    const { items = [] } = await upiQrPayments(txn.gateway_ref);
    let paid = items.find((p) => p.status === 'captured');
    if (!paid) {
      const authorised = items.find((p) => p.status === 'authorized');
      if (authorised) paid = await ensureCaptured(authorised);
    }
    if (paid && paid.status === 'captured') {
      const s = await settle(txn.id, paid);
      return { status: 'Paid', receipt_no: s.receipt_no, queue_token: s.queue_token || null, refund_due: !!s.refund_due };
    }
    const qr = await fetchUpiQr(txn.gateway_ref);
    const next = qr.status === 'closed' ? 'Expired' : null;
    await db.query(`UPDATE payment_gateway_transactions SET last_checked_at = NOW() ${next ? ', status = ?' : ''} WHERE id = ?`,
      next ? [next, txn.id] : [txn.id]);
    return { status: next || 'Created' };
  }
  const link = await fetchPaymentLink(txn.gateway_ref);
  if (link.status === 'paid') {
    const pid = (link.payments || []).find((p) => p.status === 'captured')?.payment_id || link.payments?.[0]?.payment_id;
    const payment = await ensureCaptured(await fetchPayment(pid));
    const s = await settle(txn.id, payment);
    return { status: 'Paid', receipt_no: s.receipt_no, queue_token: s.queue_token || null, refund_due: !!s.refund_due };
  }
  const next = { expired: 'Expired', cancelled: 'Cancelled' }[link.status];
  await db.query(`UPDATE payment_gateway_transactions SET last_checked_at = NOW() ${next ? ', status = ?' : ''} WHERE id = ?`,
    next ? [next, txn.id] : [txn.id]);
  return { status: next || 'Created' };
}

// ── Initiation ──────────────────────────────────────────────────────────────

// Creates a Razorpay order for Checkout and records the attempt. Shared with
// the kiosk (kioskPaymentController), which passes no staff user.
export async function openCheckout({ bill, charge, userId = null, actorLabel = null }) {
  const order = await createOrder({ amount: charge, receipt: bill.bill_number, notes: { bill_id: String(bill.id), branch_id: String(bill.branch_id || '') } });
  const [r] = await db.query(
    `INSERT INTO payment_gateway_transactions (bill_id, branch_id, kind, amount, gateway_ref, created_by, created_by_name)
     VALUES (?, ?, 'Checkout', ?, ?, ?, ?)`,
    [bill.id, bill.branch_id, charge, order.id, userId, (await userName(userId)) || actorLabel]);
  return {
    txn_id: r.insertId, key_id: razorpayKeyId(), order_id: order.id, amount: order.amount, currency: order.currency,
    bill_number: bill.bill_number, patient_name: bill.patient_name,
    contact: String(bill.phone || '').replace(/\D/g, '').slice(-10) || undefined, email: bill.email_id || undefined,
  };
}

// Verifies the Checkout callback and settles the payment. Shared with the kiosk.
export async function verifyCheckoutCallback({ razorpay_order_id, razorpay_payment_id, razorpay_signature }, { branchScope = null } = {}) {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) throw new PaymentError('Incomplete payment response.');
  if (!checkoutSignatureValid(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    throw new PaymentError('Payment signature could not be verified.', 400);
  }
  const [[txn]] = await db.query(
    `SELECT * FROM payment_gateway_transactions WHERE gateway = 'razorpay' AND gateway_ref = ? ${branchScope ? 'AND branch_id = ?' : ''}`,
    branchScope ? [razorpay_order_id, branchScope] : [razorpay_order_id]);
  if (!txn) throw new PaymentError('Payment not recognised.', 404);
  const payment = await ensureCaptured(await fetchPayment(razorpay_payment_id));
  if (payment.order_id !== razorpay_order_id) throw new PaymentError('Payment does not belong to this order.', 400);
  if (payment.status !== 'captured') throw new PaymentError(`Payment is ${payment.status}; it has not been received.`, 409);
  return settle(txn.id, payment);
}

export const getConfig = (req, res) => res.json({ success: true, enabled: razorpayEnabled(), key_id: razorpayKeyId() });

// POST /api/payments/razorpay/order { bill_id, amount? }
export const createCheckoutOrder = async (req, res) => {
  try {
    const { bill, charge } = await payableBill(req.body?.bill_id, { branchScope: pinned(req), amount: req.body?.amount });
    await assertOnlineAllowed(bill.branch_id, 'online_counter');
    res.json({ success: true, ...(await openCheckout({ bill, charge, userId: req.user?.id })) });
  } catch (error) { fail(res, error, 'createCheckoutOrder'); }
};

// POST /api/payments/razorpay/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature }
export const verifyCheckout = async (req, res) => {
  try {
    const s = await verifyCheckoutCallback(req.body || {}, { branchScope: pinned(req) });
    res.json({ success: true, message: `Payment received — receipt ${s.receipt_no}.`, receipt_no: s.receipt_no, payment_status: s.payment_status });
  } catch (error) { fail(res, error, 'verifyCheckout'); }
};

// POST /api/payments/razorpay/checkout-failed { order_id, error } — the patient's
// attempt failed or was dismissed; kept on the transaction for the record.
export const checkoutFailed = async (req, res) => {
  try {
    const pin = pinned(req);
    await db.query(
      `UPDATE payment_gateway_transactions SET error = ? WHERE gateway_ref = ? AND status = 'Created' ${pin ? 'AND branch_id = ?' : ''}`,
      [String(req.body?.error || 'Payment not completed').slice(0, 500), req.body?.order_id, ...(pin ? [pin] : [])]);
    res.json({ success: true });
  } catch (error) { fail(res, error, 'checkoutFailed'); }
};

// Creates a Razorpay payment link and records the attempt. With sms, Razorpay
// texts it to the patient's registered mobile; without, the caller shows it
// (the kiosk draws it as a QR when UPI QR is not available on the account).
export async function sendPaymentLink({ bill, charge, userId = null, actorLabel = null, expiryHours = 24, sms = true }) {
  const phone = String(bill.phone || '').replace(/\D/g, '').slice(-10);
  if (sms && phone.length !== 10) throw new PaymentError('No valid mobile number is registered for this patient.', 409);
  const [r] = await db.query(
    `INSERT INTO payment_gateway_transactions (bill_id, branch_id, kind, amount, gateway_ref, created_by, created_by_name)
     VALUES (?, ?, 'Payment link', ?, CONCAT('pending-', UUID_SHORT()), ?, ?)`,
    [bill.id, bill.branch_id, charge, userId, (await userName(userId)) || actorLabel]);
  try {
    const link = await createPaymentLink({
      amount: charge, referenceId: `${bill.bill_number}-${r.insertId}`,
      description: `Lab investigations — ${bill.bill_number}`,
      customer: sms
        ? { name: bill.patient_name || 'Patient', contact: `+91${phone}`, ...(bill.email_id ? { email: bill.email_id } : {}) }
        : { name: bill.patient_name || 'Patient' },
      notes: { bill_id: String(bill.id) },
      expireBy: Math.floor(Date.now() / 1000) + Math.max(expiryHours * 3600, 16 * 60),
    });
    await db.query('UPDATE payment_gateway_transactions SET gateway_ref = ?, short_url = ? WHERE id = ?', [link.id, link.short_url, r.insertId]);
    return { txn_id: r.insertId, short_url: link.short_url, masked_phone: phone ? `xxxxxx${phone.slice(-4)}` : null };
  } catch (e) {
    await db.query("UPDATE payment_gateway_transactions SET status = 'Failed', error = ? WHERE id = ?", [String(e.message).slice(0, 500), r.insertId]);
    throw e;
  }
}

// Razorpay hosts the QR picture (BHIM / UPI branded, amount fixed); fetched
// here so the kiosk shows it without calling out to another site.
async function fetchQrPicture(url) {
  const { hostname, protocol } = new URL(url);
  if (protocol !== 'https:' || !/(^|\.)rzp\.io$|(^|\.)razorpay\.com$/.test(hostname)) throw new GatewayError('Unexpected QR image address.');
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new GatewayError('Could not load the payment QR.');
  return cropQrCard(Buffer.from(await res.arrayBuffer()));
}

// Razorpay's picture is a tall poster with the QR in a small white card in the
// middle. Cropping to that card lets the kiosk show the QR large. If the
// poster is ever a different shape, the whole picture is sent unchanged.
function cropQrCard(buf) {
  const whole = `data:image/png;base64,${buf.toString('base64')}`;
  try {
    const src = PNG.sync.read(buf);
    const ratio = src.height / src.width;
    if (ratio < 2.2 || ratio > 2.7) return whole;
    const x0 = Math.round(src.width * 0.14); const x1 = Math.round(src.width * 0.86);
    const y0 = Math.round(src.height * 0.305); const y1 = Math.round(src.height * 0.7);
    const out = new PNG({ width: x1 - x0, height: y1 - y0 });
    PNG.bitblt(src, out, x0, y0, out.width, out.height, 0, 0);
    return `data:image/png;base64,${PNG.sync.write(out).toString('base64')}`;
  } catch {
    return whole;
  }
}

// Creates a single-use UPI QR for exactly the amount due and records the
// attempt; the QR closes itself after validMinutes. Returns either the
// picture Razorpay hosts (qr_picture) or, for a link fallback, the text to
// draw (qr_content). Accounts without Razorpay QR Codes fall back to a
// payment link, whose page also offers UPI, drawn as the QR instead.
export async function openUpiQr({ bill, charge, actorLabel = null, validMinutes = 15 }) {
  const closeBy = Math.floor(Date.now() / 1000) + Math.max(validMinutes, 3) * 60;
  const [r] = await db.query(
    `INSERT INTO payment_gateway_transactions (bill_id, branch_id, kind, amount, gateway_ref, created_by_name)
     VALUES (?, ?, 'UPI QR', ?, CONCAT('pending-', UUID_SHORT()), ?)`,
    [bill.id, bill.branch_id, charge, actorLabel]);
  try {
    const qr = await createUpiQr({
      amount: charge, name: bill.bill_number, description: `Lab investigations — ${bill.bill_number}`,
      closeBy, notes: { bill_id: String(bill.id), txn_id: String(r.insertId) },
    });
    await db.query('UPDATE payment_gateway_transactions SET gateway_ref = ?, short_url = ? WHERE id = ?', [qr.id, qr.image_url || null, r.insertId]);
    const picture = qr.image_content ? null : await fetchQrPicture(qr.image_url);
    return { txn_id: r.insertId, kind: 'UPI QR', qr_content: qr.image_content || null, qr_picture: picture, expires_at: closeBy * 1000 };
  } catch (e) {
    await db.query("UPDATE payment_gateway_transactions SET status = 'Failed', error = ? WHERE id = ?", [String(e.message).slice(0, 500), r.insertId]);
    if (!(e instanceof GatewayError)) throw e;
    console.warn(`UPI QR unavailable (${e.message}); using a payment link QR`);
    const link = await sendPaymentLink({ bill, charge, actorLabel, expiryHours: 0, sms: false });
    return { txn_id: link.txn_id, kind: 'Payment link', qr_content: link.short_url, expires_at: Date.now() + 16 * 60 * 1000 };
  }
}

// POST /api/payments/razorpay/link { bill_id, amount? } — SMS payment link to the patient.
export const createLink = async (req, res) => {
  try {
    const { bill, charge } = await payableBill(req.body?.bill_id, { branchScope: pinned(req), amount: req.body?.amount });
    const settings = await assertOnlineAllowed(bill.branch_id, 'online_link');
    const link = await sendPaymentLink({ bill, charge, userId: req.user?.id || null, expiryHours: settings.link_expiry_hours });
    res.json({ success: true, txn_id: link.txn_id, short_url: link.short_url, message: `Payment link for ₹${charge} sent by SMS to ${link.masked_phone}.` });
  } catch (error) { fail(res, error, 'createLink'); }
};

async function txnInScope(req, id) {
  const pin = pinned(req);
  const [[txn]] = await db.query(`SELECT * FROM payment_gateway_transactions WHERE id = ? ${pin ? 'AND branch_id = ?' : ''}`, pin ? [id, pin] : [id]);
  if (!txn) throw new PaymentError('Transaction not found', 404);
  return txn;
}

// POST /api/payments/transactions/:id/check — live status from Razorpay.
export const checkStatus = async (req, res) => {
  try {
    const out = await checkTransaction(await txnInScope(req, req.params.id));
    res.json({ success: true, ...out, message: out.status === 'Paid' ? `Paid — receipt ${out.receipt_no}.` : `Status: ${out.status}${out.error ? ` (${out.error})` : ''}` });
  } catch (error) { fail(res, error, 'checkStatus'); }
};

// POST /api/payments/transactions/:id/cancel — withdraw an unpaid payment link.
export const cancelLink = async (req, res) => {
  try {
    const txn = await txnInScope(req, req.params.id);
    if (txn.kind !== 'Payment link' || txn.status !== 'Created') throw new PaymentError('Only an unpaid payment link can be cancelled.', 409);
    await cancelPaymentLink(txn.gateway_ref);
    await db.query("UPDATE payment_gateway_transactions SET status = 'Cancelled', last_checked_at = NOW() WHERE id = ?", [txn.id]);
    res.json({ success: true, message: 'Payment link cancelled.' });
  } catch (error) { fail(res, error, 'cancelLink'); }
};

// GET /api/payments/bills/:billId — receipts and gateway attempts for one bill.
export const billPayments = async (req, res) => {
  try {
    const pin = pinned(req);
    const [[bill]] = await db.query(`SELECT id FROM bills WHERE id = ? ${pin ? 'AND branch_id = ?' : ''}`, pin ? [req.params.billId, pin] : [req.params.billId]);
    if (!bill) throw new PaymentError('Bill not found', 404);
    const [receipts] = await db.query('SELECT * FROM bill_payments WHERE bill_id = ? ORDER BY id', [bill.id]);
    const [attempts] = await db.query('SELECT * FROM payment_gateway_transactions WHERE bill_id = ? ORDER BY id DESC', [bill.id]);
    res.json({ success: true, receipts, attempts });
  } catch (error) { fail(res, error, 'billPayments'); }
};

// GET /api/payments/transactions?from&to&status&q — reconciliation view.
export const listTransactions = async (req, res) => {
  try {
    const { from, to, status, q } = req.query;
    const where = ['1=1']; const params = [];
    const pin = pinned(req);
    if (pin) { where.push('t.branch_id = ?'); params.push(pin); }
    if (from) { where.push('t.created_at >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('t.created_at <= ?'); params.push(`${to} 23:59:59`); }
    if (q) { where.push('(b.bill_number LIKE ? OR t.gateway_ref LIKE ? OR t.gateway_payment_id LIKE ? OR b.patient_name LIKE ?)'); params.push(...Array(4).fill(`%${q}%`)); }
    const base = `FROM payment_gateway_transactions t JOIN bills b ON b.id = t.bill_id LEFT JOIN bill_payments bp ON bp.gateway_txn_id = t.id WHERE ${where.join(' AND ')}`;
    const [sum] = await db.query(`SELECT t.status, COUNT(*) AS n, COALESCE(SUM(t.amount), 0) AS amount ${base} GROUP BY t.status`, params);
    const [[mismatch]] = await db.query(`SELECT COUNT(*) AS n ${base} AND t.status = 'Paid' AND bp.id IS NULL`, params);
    const [rows] = await db.query(
      `SELECT t.*, b.bill_number, b.patient_name, b.net_amount, b.paid_amount, b.payment_status, bp.receipt_no, bp.amount AS receipt_amount
       ${base} ${status ? 'AND t.status = ?' : ''} ORDER BY t.id DESC LIMIT 500`, status ? [...params, status] : params);
    res.json({
      success: true,
      summary: Object.fromEntries(sum.map((s) => [s.status, { count: Number(s.n), amount: Number(s.amount) }])),
      unreceipted_paid: Number(mismatch.n),
      transactions: rows,
    });
  } catch (error) { fail(res, error, 'listTransactions'); }
};

// Checks every open transaction of the last week against Razorpay.
export async function reconcileOpen({ branchScope = null } = {}) {
  const [open] = await db.query(
    `SELECT * FROM payment_gateway_transactions WHERE status = 'Created' AND gateway_ref NOT LIKE 'pending-%'
       AND created_at >= NOW() - INTERVAL 7 DAY ${branchScope ? 'AND branch_id = ?' : ''} ORDER BY id`, branchScope ? [branchScope] : []);
  const result = { checked: 0, paid: 0, expired: 0, errors: 0 };
  for (const txn of open) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await checkTransaction(txn);
      result.checked += 1;
      if (out.status === 'Paid') result.paid += 1;
      if (out.status === 'Expired' || out.status === 'Cancelled') result.expired += 1;
    } catch (e) {
      result.errors += 1;
      console.error(`reconcile txn ${txn.id}:`, e.message);
    }
  }
  return result;
}

// POST /api/payments/reconcile
export const reconcile = async (req, res) => {
  try {
    const r = await reconcileOpen({ branchScope: pinned(req) });
    res.json({ success: true, ...r, message: `Checked ${r.checked} open transaction(s): ${r.paid} newly paid, ${r.expired} expired/cancelled${r.errors ? `, ${r.errors} could not be checked` : ''}.` });
  } catch (error) { fail(res, error, 'reconcile'); }
};

// POST /api/payments/razorpay/webhook — signed by RAZORPAY_WEBHOOK_SECRET.
export const webhook = async (req, res) => {
  if (!webhookSignatureValid(req.rawBody, req.headers['x-razorpay-signature'])) return res.sendStatus(401);
  try {
    const { event, payload } = req.body || {};
    const payment = payload?.payment?.entity;
    let txn = null;
    if (event?.startsWith('payment_link.')) {
      [[txn]] = await db.query("SELECT * FROM payment_gateway_transactions WHERE gateway = 'razorpay' AND gateway_ref = ?", [payload?.payment_link?.entity?.id]);
    } else if (event?.startsWith('qr_code.')) {
      [[txn]] = await db.query("SELECT * FROM payment_gateway_transactions WHERE gateway = 'razorpay' AND gateway_ref = ?", [payload?.qr_code?.entity?.id]);
    } else if (payment?.order_id) {
      [[txn]] = await db.query("SELECT * FROM payment_gateway_transactions WHERE gateway = 'razorpay' AND gateway_ref = ?", [payment.order_id]);
    }
    if (txn) {
      if (['payment.captured', 'payment_link.paid', 'order.paid', 'qr_code.credited'].includes(event) && payment?.status === 'captured') {
        await settle(txn.id, payment);
      } else if (event === 'payment.failed' && txn.status === 'Created') {
        await db.query('UPDATE payment_gateway_transactions SET error = ? WHERE id = ?', [String(payment?.error_description || 'Payment failed').slice(0, 500), txn.id]);
      } else if ((event === 'payment_link.expired' || event === 'payment_link.cancelled') && txn.status === 'Created') {
        await db.query('UPDATE payment_gateway_transactions SET status = ? WHERE id = ?', [event.endsWith('expired') ? 'Expired' : 'Cancelled', txn.id]);
      } else if (event === 'qr_code.closed' && txn.status === 'Created') {
        // A QR closes once paid as well; settle any payment before calling it expired.
        await checkTransaction(txn);
      }
    }
  } catch (error) {
    console.error('Razorpay webhook error:', error.message);
  }
  // Acknowledge once authenticated; reconciliation picks up anything missed.
  res.sendStatus(200);
};
