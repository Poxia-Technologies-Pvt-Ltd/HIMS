import crypto from 'crypto';

// Minimal Razorpay REST client (Orders, Payments, Payment Links, signatures).
// Keys come from RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET; webhooks are signed
// with RAZORPAY_WEBHOOK_SECRET (set in the Razorpay dashboard). Amounts cross
// this boundary in rupees and are converted to paise here, nowhere else.

const API = 'https://api.razorpay.com/v1';

export const razorpayEnabled = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
export const razorpayKeyId = () => process.env.RAZORPAY_KEY_ID || null;
export const toPaise = (rupees) => Math.round(Number(rupees) * 100);
export const toRupees = (paise) => Math.round(Number(paise)) / 100;

export class GatewayError extends Error {}

async function call(method, path, body) {
  if (!razorpayEnabled()) throw new GatewayError('Online payment is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).');
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GatewayError(data?.error?.description || `Razorpay request failed (${res.status})`);
  return data;
}

export const createOrder = ({ amount, receipt, notes }) =>
  call('POST', '/orders', { amount: toPaise(amount), currency: 'INR', receipt: String(receipt).slice(0, 40), notes });

export const orderPayments = (orderId) => call('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
export const fetchPayment = (paymentId) => call('GET', `/payments/${encodeURIComponent(paymentId)}`);
export const capturePayment = (paymentId, amountPaise) =>
  call('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: 'INR' });

export const createPaymentLink = ({ amount, referenceId, description, customer, notes, expireBy }) =>
  call('POST', '/payment_links', {
    amount: toPaise(amount), currency: 'INR', accept_partial: false,
    reference_id: String(referenceId).slice(0, 40), description: String(description).slice(0, 2048),
    customer, notify: { sms: !!customer?.contact, email: !!customer?.email }, reminder_enable: true,
    expire_by: expireBy, notes,
  });
export const fetchPaymentLink = (linkId) => call('GET', `/payment_links/${encodeURIComponent(linkId)}`);
export const cancelPaymentLink = (linkId) => call('POST', `/payment_links/${encodeURIComponent(linkId)}/cancel`);

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Checkout callback: HMAC_SHA256(order_id + "|" + payment_id, key_secret).
export const checkoutSignatureValid = (orderId, paymentId, signature) =>
  safeEqual(crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${orderId}|${paymentId}`).digest('hex'), signature);

// Webhook: HMAC_SHA256(raw body, webhook secret).
export const webhookSignatureValid = (rawBody, signature) =>
  !!process.env.RAZORPAY_WEBHOOK_SECRET && !!rawBody && !!signature &&
  safeEqual(crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex'), signature);

// UPI QR codes (Razorpay "QR Codes" product): a single-use, fixed-amount QR
// that any UPI app can pay. image_content is the upi:// string, so the QR is
// drawn locally rather than loading Razorpay's hosted image.
export const createUpiQr = ({ amount, name, description, closeBy, notes }) =>
  call('POST', '/payments/qr_codes', {
    type: 'upi_qr', name: String(name).slice(0, 40), usage: 'single_use', fixed_amount: true,
    payment_amount: toPaise(amount), description: String(description).slice(0, 250), close_by: closeBy, notes,
  });
export const fetchUpiQr = (qrId) => call('GET', `/payments/qr_codes/${encodeURIComponent(qrId)}`);
export const upiQrPayments = (qrId) => call('GET', `/payments/qr_codes/${encodeURIComponent(qrId)}/payments`);
export const closeUpiQr = (qrId) => call('POST', `/payments/qr_codes/${encodeURIComponent(qrId)}/close`);
