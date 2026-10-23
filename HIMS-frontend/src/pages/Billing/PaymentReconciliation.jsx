import { useState, useEffect, useCallback } from 'react';
import '../../assets/CSS/Governance.css';
import { api, fmtDT, daysAgo, ymd, saveCsv, role } from '../../utils/govApi';

const BADGE = { Created: 'info', Paid: 'ok', Failed: 'bad', Expired: '', Cancelled: '' };
const canAct = () => role() !== 'auditor';
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

// Razorpay transactions against bills: what was initiated, what Razorpay
// says happened, and the receipt each payment produced. "Reconcile" asks
// Razorpay about every open transaction (the server also does this every
// 15 minutes); a paid transaction without a receipt would be listed here.
export default function PaymentReconciliation() {
  const [f, setF] = useState({ from: daysAgo(6), to: ymd(), status: '', q: '' });
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    return api(`/api/payments/transactions?${qs}`).then((d) => (d.success ? setData(d) : setMsg({ ok: false, text: d.message })));
  }, [f]);
  useEffect(() => { load(); }, [load]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const act = async (key, path) => {
    setBusy(key);
    const d = await api(path, { method: 'POST' });
    setBusy('');
    setMsg({ ok: d.success, text: d.message });
    load();
  };

  const s = data?.summary || {};
  const k = (st) => s[st] || { count: 0, amount: 0 };

  return (
    <div className="gv-page">
      <div className="gv-head">
        <div>
          <h1>Online Payments</h1>
          <p>Razorpay payments for paid investigations: each attempt, its status at Razorpay, and the receipt it produced. Free-scheme (NFDS) orders never appear here — they carry no charge.</p>
        </div>
        <div className="gv-actions">
          {canAct() && <button className="gv-btn" disabled={busy === 'rec'} onClick={() => act('rec', '/api/payments/reconcile')}>{busy === 'rec' ? 'Reconciling…' : 'Reconcile now'}</button>}
          <button className="gv-btn ghost" onClick={() => saveCsv(`online-payments-${f.from}-to-${f.to}.csv`, data?.transactions || [], [
            ['Created', (t) => t.created_at], ['Bill', (t) => t.bill_number], ['Patient', (t) => t.patient_name], ['Kind', (t) => t.kind], ['Amount', (t) => t.amount],
            ['Status', (t) => t.status], ['Razorpay ref', (t) => t.gateway_ref], ['Payment id', (t) => t.gateway_payment_id], ['Method', (t) => t.pay_method],
            ['Paid at', (t) => t.paid_at], ['Receipt', (t) => t.receipt_no], ['Initiated by', (t) => t.created_by_name], ['Error', (t) => t.error]])}>Export CSV</button>
        </div>
      </div>

      <div className="gv-kpis">
        <div className="gv-kpi ok"><b>{inr(k('Paid').amount)}</b><span>Collected online</span><small>{k('Paid').count} payments</small></div>
        <div className={`gv-kpi ${k('Created').count ? 'warn' : ''}`}><b>{k('Created').count}</b><span>Awaiting payment</span><small>{inr(k('Created').amount)}</small></div>
        <div className="gv-kpi"><b>{k('Expired').count + k('Cancelled').count}</b><span>Expired / cancelled</span></div>
        <div className={`gv-kpi ${k('Failed').count ? 'bad' : ''}`}><b>{k('Failed').count}</b><span>Could not start</span></div>
        <div className={`gv-kpi ${data?.unreceipted_paid ? 'bad' : 'ok'}`}><b>{data?.unreceipted_paid ?? '—'}</b><span>Paid without receipt</span><small>should always be 0</small></div>
      </div>

      <div className="gv-filters">
        <label>From<input type="date" value={f.from} onChange={set('from')} /></label>
        <label>To<input type="date" value={f.to} onChange={set('to')} /></label>
        <label>Status<select value={f.status} onChange={set('status')}><option value="">All</option>{Object.keys(BADGE).map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Search<input value={f.q} onChange={set('q')} placeholder="Bill no., patient, order / payment id" /></label>
      </div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}

      <div className="gv-table-wrap">
        <table className="gv-table">
          <thead><tr><th>When</th><th>Bill / patient</th><th>Type</th><th className="num">Amount</th><th>Status</th><th>Razorpay</th><th>Receipt</th><th /></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={8} className="gv-empty">Loading…</td></tr>}
            {data?.transactions.length === 0 && <tr><td colSpan={8} className="gv-empty">No online payments in this period.</td></tr>}
            {(data?.transactions || []).map((t) => (
              <tr key={t.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(t.created_at)}<div className="gv-sub">{t.created_by_name || '—'}</div></td>
                <td><b>{t.bill_number}</b><div className="gv-sub">{t.patient_name}</div><div className="gv-sub">Bill {t.payment_status} · {inr(t.paid_amount)} of {inr(t.net_amount)}</div></td>
                <td>{t.kind}{t.short_url ? <div className="gv-sub gv-mono">{t.short_url}</div> : null}</td>
                <td className="num">{inr(t.amount)}</td>
                <td><span className={`gv-badge ${BADGE[t.status]}`}>{t.status}</span>{t.paid_at ? <div className="gv-sub">{fmtDT(t.paid_at)}</div> : null}
                  {t.error ? <div className="gv-sub" style={{ color: '#b91c1c', maxWidth: 220 }}>{t.error}</div> : null}</td>
                <td className="gv-mono">{t.gateway_ref}{t.gateway_payment_id ? <div>{t.gateway_payment_id}{t.pay_method ? ` · ${t.pay_method}` : ''}</div> : null}</td>
                <td>{t.receipt_no ? <><b>{t.receipt_no}</b><div className="gv-sub">{inr(t.receipt_amount)}</div></> : <span className="gv-sub">—</span>}</td>
                <td>{canAct() && t.status === 'Created' && (
                  <div className="gv-actions">
                    <button className="gv-btn sm ghost" disabled={busy === `c${t.id}`} onClick={() => act(`c${t.id}`, `/api/payments/transactions/${t.id}/check`)}>Check</button>
                    {t.kind === 'Payment link' && <button className="gv-btn sm ghost" disabled={busy === `x${t.id}`} onClick={() => act(`x${t.id}`, `/api/payments/transactions/${t.id}/cancel`)}>Cancel link</button>}
                  </div>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
