import { useState } from 'react';
import { Modal, Field } from './ui';
import { post, money } from '../../utils/hmisApi';

// Asks an approver (Admin / Accounts Manager) for something the desk may not
// do alone: give credit, cancel a bill or a line on it, or give a concession.
// Nothing changes until the request is approved.
const KINDS = {
  Credit: { title: 'Ask for pay-later', hint: 'The patient pays later. An approver must agree before the bill is made.' },
  'Cancel bill': { title: 'Ask to cancel this bill', hint: 'All lines are cancelled. Money already paid is returned.' },
  'Cancel item': { title: 'Ask to cancel this line', hint: 'Only this line is cancelled. Any extra money paid is returned.' },
  Concession: { title: 'Ask for a concession', hint: 'Reduces what the patient owes. Any extra money paid is returned.' },
};
const REASONS = {
  Credit: ['Emergency – will pay later', 'Staff / staff family', 'Insurance approval awaited', 'Known patient – pays at discharge'],
  'Cancel bill': ['Patient left without service', 'Wrong patient billed', 'Duplicate bill', 'Doctor cancelled the order'],
  'Cancel item': ['Patient refused the test', 'Doctor cancelled the order', 'Wrong item billed', 'Test not available today'],
  Concession: ['Poor patient', 'Staff / staff family', 'Senior citizen', 'Doctor advised'],
};
const METHODS = ['Cash', 'UPI', 'Card', 'Other'];

export default function BillRequestModal({ kind, bill, item, patientId, chargeIds, defaultAmount, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : '');
  const [refund, setRefund] = useState('Cash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const paid = Number(bill?.paid_amount || 0);
  const net = Number(bill?.net_amount || 0);
  let refundDue = 0;
  if (kind === 'Cancel bill') refundDue = paid;
  if (kind === 'Cancel item') refundDue = Math.max(0, paid - (net - Number(item?.total_price || 0)));
  if (kind === 'Concession') refundDue = Math.max(0, paid - (net - Number(amount || 0)));
  const needsAmount = kind === 'Credit' || kind === 'Concession';

  const submit = async () => {
    setErr('');
    if (!reason.trim()) { setErr('Choose or type the reason.'); return; }
    if (needsAmount && !(Number(amount) > 0)) { setErr('Enter the amount.'); return; }
    setBusy(true);
    const r = await post('/api/billing/approvals', {
      kind, reason: reason.trim(), amount: needsAmount ? Number(amount) : undefined,
      bill_id: bill?.id, bill_item_id: item?.id, patient_id: patientId, charge_ids: chargeIds,
      refund_method: refundDue > 0 ? refund : undefined,
    });
    setBusy(false);
    if (!r.ok) { setErr(r.data.message || 'Could not send the request.'); return; }
    onDone?.(r.data.id);
  };

  const k = KINDS[kind];
  return (
    <Modal
      title={k.title}
      subtitle={k.hint}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="hm-btn" onClick={onClose}>Close</button>
          <button type="button" className="hm-btn primary" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Send for approval'}</button>
        </>
      )}
    >
      {bill && (
        <div className="hm-note">
          Bill <b>{bill.invoice_no || bill.bill_number}</b> · total {money(net)} · paid {money(paid)}
          {item && <> · line <b>{item.service_name}</b> {money(item.total_price)}</>}
        </div>
      )}
      {needsAmount && (
        <Field label={kind === 'Credit' ? 'Amount the patient will pay later (₹)' : 'Concession amount (₹)'}>
          <input className="hm-input" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
      )}
      <Field label="Reason">
        <div className="hm-chips" style={{ marginBottom: 6 }}>
          {REASONS[kind].map((r) => (
            <button key={r} type="button" className={`hm-chip${reason === r ? ' on' : ''}`} onClick={() => setReason(r)}>{r}</button>
          ))}
        </div>
        <input className="hm-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type the reason" maxLength={500} />
      </Field>
      {refundDue > 0 && (
        <Field label={`Money to return: ${money(refundDue)} — how?`} hint="The cashier who asked hands the money back; it is counted in their cash closing.">
          <div className="hm-chips">
            {METHODS.map((m) => (
              <button key={m} type="button" className={`hm-chip${refund === m ? ' on' : ''}`} onClick={() => setRefund(m)}>{m}</button>
            ))}
          </div>
        </Field>
      )}
      {err && <div className="hm-note bad">{err}</div>}
    </Modal>
  );
}
