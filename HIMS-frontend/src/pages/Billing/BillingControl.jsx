import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHead, Stat, Empty, Badge, Tabs } from '../../components/hmis/ui';
import { get, money, todayIST } from '../../utils/hmisApi';

// The day's money in one place, for Admin and the Accounts Manager: what came
// in and by whom, refunds and discounts, services given but not yet billed,
// dues, every exception (credit, cancellation, concession) and cash closings.
const when = (dt) => (dt ? new Date(dt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const sum = (rows, k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);

export default function BillingControl() {
  const [date, setDate] = useState(todayIST());
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('unbilled');

  const load = useCallback(async () => {
    const r = await get(`/api/billing/control?date=${date}`);
    if (r.ok) setD(r.data);
  }, [date]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <div className="hm-page"><PageHead title="Billing Control" /><Empty>Loading…</Empty></div>;

  const received = sum(d.by_method, 'received');
  const refunded = sum(d.by_method, 'refunded');
  // A service already given (seen by the doctor / scan started) and still not billed is a leak.
  const risky = d.unbilled.filter((u) => ['Completed', 'In Consultation'].includes(u.appointment_status) || ['InProgress', 'Completed'].includes(u.imaging_status));
  const pending = d.exceptions.filter((e) => e.status === 'Pending');
  const shortClosings = d.closings.filter((c) => Math.abs(Number(c.difference)) >= 1);

  return (
    <div className="hm-page">
      <PageHead title="Billing Control" subtitle="Collections, leaks and exceptions for the day.">
        <input type="date" className="hm-input" style={{ width: 160 }} value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
        <button type="button" className="hm-btn" onClick={load}><RefreshCw size={14} /> Refresh</button>
      </PageHead>

      <div className="hm-stats">
        <Stat label="Received" value={money(received)} note={`${sum(d.by_method, 'receipts')} receipts`} tone="green" />
        <Stat label="Refunded" value={money(refunded)} tone={refunded ? 'red' : ''} />
        <Stat label="Billed (net)" value={money(d.billing.net)} note={`${d.billing.bills} bills · ${money(d.billing.discounts)} discount`} />
        <Stat label="Not yet billed" value={money(sum(d.unbilled, 'amount'))} note={risky.length ? `${risky.length} already given!` : `${d.unbilled.length} charges`} tone={risky.length ? 'red' : 'amber'} />
        <Stat label="Dues outstanding" value={money(sum(d.dues, 'balance'))} note={`${d.dues.length} bills`} tone="amber" />
        <Stat label="Waiting approval" value={pending.length} tone={pending.length ? 'amber' : ''} />
      </div>

      <div className="hm-split" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="hm-card">
          <div className="hm-card-head"><h3>By payment method</h3></div>
          {d.by_method.length === 0 ? <Empty>No money moved.</Empty> : (
            <table className="hm-table">
              <thead><tr><th>Method</th><th className="num">Received</th><th className="num">Refunded</th><th className="num">Net</th></tr></thead>
              <tbody>{d.by_method.map((m) => (
                <tr key={m.method}><td>{m.method}</td><td className="num">{money(m.received)}</td><td className="num">{money(m.refunded)}</td><td className="num"><b>{money(m.received - m.refunded)}</b></td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className="hm-card">
          <div className="hm-card-head"><h3>By cashier</h3></div>
          {d.by_cashier.length === 0 ? <Empty>No money moved.</Empty> : (
            <table className="hm-table">
              <thead><tr><th>Cashier</th><th className="num">Received</th><th className="num">Refunded</th><th>Shift</th></tr></thead>
              <tbody>{d.by_cashier.map((c) => {
                const open = d.open_cashiers.some((o) => o.received_by === c.received_by);
                return (
                  <tr key={`${c.cashier}-${c.received_by}`}>
                    <td>{c.cashier}</td><td className="num">{money(c.received)}</td><td className="num">{money(c.refunded)}</td>
                    <td>{c.received_by ? (open ? <Badge tone="amber">Not closed</Badge> : <Badge tone="green">Closed</Badge>) : '—'}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </div>
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'unbilled', label: 'Not yet billed', count: d.unbilled.length },
        { id: 'dues', label: 'Dues', count: d.dues.length },
        { id: 'exceptions', label: 'Credit, cancellations & concessions', count: d.exceptions.length },
        { id: 'closings', label: 'Cash closings', count: shortClosings.length || undefined },
      ]} />

      <div className="hm-card">
        {tab === 'unbilled' && (d.unbilled.length === 0 ? <Empty>Everything given has been billed.</Empty> : (
          <div className="hm-table-wrap"><table className="hm-table">
            <thead><tr><th>Patient</th><th>Service</th><th>State</th><th>Waiting</th><th className="num">Amount</th></tr></thead>
            <tbody>{d.unbilled.map((u) => {
              const given = ['Completed', 'In Consultation'].includes(u.appointment_status) || ['InProgress', 'Completed'].includes(u.imaging_status);
              return (
                <tr key={u.id}>
                  <td>{u.patient_name}<span className="sub">{u.reg_no}</span></td>
                  <td>{u.description}<span className="sub">{u.source_type}</span></td>
                  <td>{given ? <Badge tone="red">Service given</Badge> : <Badge>{u.imaging_status || u.appointment_status || 'Ordered'}</Badge>}</td>
                  <td className="hm-muted">{u.age_min < 60 ? `${u.age_min} min` : u.age_min < 1440 ? `${Math.floor(u.age_min / 60)} h` : `${Math.floor(u.age_min / 1440)} d`}</td>
                  <td className="num">{money(u.amount)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ))}
        {tab === 'dues' && (d.dues.length === 0 ? <Empty>No dues.</Empty> : (
          <div className="hm-table-wrap"><table className="hm-table">
            <thead><tr><th>Bill</th><th>Patient</th><th className="num">Bill</th><th className="num">Paid</th><th className="num">Due</th><th>Age</th></tr></thead>
            <tbody>{d.dues.map((b) => (
              <tr key={b.id}>
                <td>{b.invoice_no || b.bill_number} {b.on_credit ? <Badge tone="blue">Pay-later</Badge> : null}</td>
                <td>{b.patient_name}</td>
                <td className="num">{money(b.net_amount)}</td><td className="num">{money(b.paid_amount)}</td><td className="num"><b>{money(b.balance)}</b></td>
                <td>{b.age_days > 7 ? <Badge tone="red">{b.age_days} days</Badge> : `${b.age_days} d`}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ))}
        {tab === 'exceptions' && (d.exceptions.length === 0 ? <Empty>No exceptions.</Empty> : (
          <div className="hm-table-wrap"><table className="hm-table">
            <thead><tr><th>Type</th><th>Patient / bill</th><th>Reason</th><th>Asked by</th><th>Decided by</th><th className="num">Amount</th></tr></thead>
            <tbody>{d.exceptions.map((e) => (
              <tr key={e.id}>
                <td><Badge tone={{ Credit: 'blue', 'Cancel bill': 'red', 'Cancel item': 'amber', Concession: 'violet' }[e.kind]}>{e.kind}</Badge><span className="sub">{e.status}</span></td>
                <td>{e.patient_name}<span className="sub">{e.invoice_no}</span></td>
                <td style={{ maxWidth: 260 }}>{e.reason}</td>
                <td>{e.requested_by_name}<span className="sub">{when(e.requested_at)}</span></td>
                <td>{e.decided_by_name || '—'}<span className="sub">{when(e.decided_at)}</span></td>
                <td className="num">{money(e.amount)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ))}
        {tab === 'closings' && (d.closings.length === 0 ? <Empty>No shift closed on this day.</Empty> : (
          <div className="hm-table-wrap"><table className="hm-table">
            <thead><tr><th>Cashier</th><th>Closed</th><th className="num">Expected cash</th><th className="num">Counted</th><th className="num">Difference</th><th>Note</th></tr></thead>
            <tbody>{d.closings.map((c) => (
              <tr key={c.id}>
                <td>{c.user_name}</td><td>{when(c.closed_at)}</td>
                <td className="num">{money(c.system_cash)}</td><td className="num">{money(c.declared_cash)}</td>
                <td className="num">{Math.abs(Number(c.difference)) < 1 ? <Badge tone="green">Matched</Badge> : <Badge tone="red">{money(c.difference)}</Badge>}</td>
                <td>{c.note || '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ))}
      </div>
    </div>
  );
}
