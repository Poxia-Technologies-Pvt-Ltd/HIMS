// Razorpay Standard Checkout, loaded on demand. The order is always created by
// our backend (amount from the bill at the facility's prices); this only opens
// the payment window and hands Razorpay's signed response back for the backend
// to verify. Nothing here decides whether a payment succeeded.

const SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loading = null;

export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay did not load')));
    s.onerror = () => { loading = null; reject(new Error('Could not load Razorpay. Check the internet connection.')); };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Opens Checkout for an order from POST /api/payments/razorpay/order (or the
 * kiosk equivalent). Resolves with Razorpay's { razorpay_order_id,
 * razorpay_payment_id, razorpay_signature } on success; rejects with
 * { dismissed: true } when closed without paying. A failed attempt does not
 * end it — Razorpay lets the patient retry in the same window — it is only
 * reported to onFailure. upiOnly limits the window to UPI (the kiosk, which
 * cannot open pop-ups).
 */
export async function payWithRazorpay(order, { title = 'Laboratory charges', upiOnly = false, onFailure = null } = {}) {
  const Razorpay = await loadRazorpay();
  return new Promise((resolve, reject) => {
    const rzp = new Razorpay({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency || 'INR',
      name: order.facility || 'Government of Karnataka',
      description: `${title} — bill ${order.bill_number}`,
      prefill: { name: order.patient_name || '', contact: order.contact || '', email: order.email || '' },
      notes: { bill_number: order.bill_number },
      theme: { color: '#1d4ed8' },
      ...(upiOnly ? { method: { upi: true, card: false, netbanking: false, wallet: false, emi: false, paylater: false } } : {}),
      handler: (response) => resolve(response),
      modal: { ondismiss: () => reject({ dismissed: true }), confirm_close: true },
    });
    rzp.on('payment.failed', (r) => onFailure?.(r?.error?.description || 'Payment failed'));
    rzp.open();
  });
}
