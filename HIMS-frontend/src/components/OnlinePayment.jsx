import { useState } from 'react';
import QRCode from 'qrcode';
import '../assets/CSS/Governance.css';
import { api } from '../utils/govApi';
import { payWithRazorpay } from '../utils/razorpayCheckout';

// Online payment for one bill through Razorpay: pay now on this screen
// (UPI QR, card, netbanking), or send the patient a payment link by SMS.
// The amount is checked against the bill's balance on the server; success is
// decided only by the server's signature check (or webhook / reconciliation).
// fixedAmount: the full balance must be paid (an order awaiting payment).
export default function OnlinePayment({ billId, balance, onPaid, onCancel, fixedAmount = false }) {
  const [amount, setAmount] = useState(balance ? String(balance) : '');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [link, setLink] = useState(null); // { txn_id, short_url, qr }

  const payNow = async () => {
    setBusy('pay'); setMsg(null);
    const order = await api('/api/payments/razorpay/order', { method: 'POST', body: { bill_id: billId, amount } });
    if (!order.success) { setBusy(''); setMsg({ ok: false, text: order.message }); return; }
    try {
      const response = await payWithRazorpay(order, {
        onFailure: (error) => setMsg({ ok: false, text: `${error} — the patient can try again in the same window.` }),
      });
      setMsg({ ok: true, text: 'Confirming payment…' });
      const v = await api('/api/payments/razorpay/verify', { method: 'POST', body: response });
      setMsg({ ok: v.success, text: v.message });
      if (v.success) onPaid?.(v);
    } catch (e) {
      if (e?.dismissed) {
        api('/api/payments/razorpay/checkout-failed', { method: 'POST', body: { order_id: order.order_id, error: 'Closed without paying' } });
        setMsg({ ok: false, text: 'Payment window closed — no payment was taken.' });
      } else {
        setMsg({ ok: false, text: e?.message || 'Could not open the payment window.' });
      }
    }
    setBusy('');
  };

  const sendLink = async () => {
    setBusy('link'); setMsg(null);
    const d = await api('/api/payments/razorpay/link', { method: 'POST', body: { bill_id: billId, amount } });
    setBusy('');
    if (!d.success) { setMsg({ ok: false, text: d.message }); return; }
    setLink({ txn_id: d.txn_id, short_url: d.short_url, qr: await QRCode.toDataURL(d.short_url, { margin: 1, width: 180 }) });
    setMsg({ ok: true, text: d.message });
  };

  const checkLink = async () => {
    setBusy('check');
    const d = await api(`/api/payments/transactions/${link.txn_id}/check`, { method: 'POST' });
    setBusy('');
    setMsg({ ok: d.success && d.status !== 'Expired' && d.status !== 'Cancelled', text: d.message });
    if (d.status === 'Paid') onPaid?.(d);
  };

  return (
    <div>
      <div className="gv-form" style={{ gridTemplateColumns: '1fr', margin: '10px 0' }}>
        <label>Amount (₹)
          <input type="number" min="1" step="0.01" value={amount} readOnly={fixedAmount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      </div>
      <div className="gv-actions">
        <button className="gv-btn" disabled={!!busy || !(Number(amount) >= 1)} onClick={payNow}>{busy === 'pay' ? 'Opening…' : 'Pay now (UPI / card)'}</button>
        <button className="gv-btn ghost" disabled={!!busy || !(Number(amount) >= 1)} onClick={sendLink}>{busy === 'link' ? 'Sending…' : 'Send payment link (SMS)'}</button>
        {onCancel && <button className="gv-btn ghost" onClick={onCancel}>Close</button>}
      </div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`} style={{ marginTop: 12 }}>{msg.text}</div>}
      {link && (
        <div className="gv-card" style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 10 }}>
          <img src={link.qr} alt="Payment link QR" width={120} height={120} />
          <div>
            <div className="gv-sub">The patient can scan this or use the SMS link:</div>
            <div className="gv-mono" style={{ margin: '6px 0' }}>{link.short_url}</div>
            <button className="gv-btn sm ghost" disabled={busy === 'check'} onClick={checkLink}>{busy === 'check' ? 'Checking…' : 'Check payment status'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
