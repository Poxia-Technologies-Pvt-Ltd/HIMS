import { useCallback, useEffect, useState } from 'react';
import { Lock, RefreshCw } from 'lucide-react';
import { PageHead, Stat, Empty, Field, Badge } from '../../components/hmis/ui';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { get, post, money } from '../../utils/hmisApi';

// End of a cashier's shift: count the cash, enter it, and the system compares
// it with what was received minus what was refunded since the last closing.
const when = (dt) => new Date(dt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const totalsOf = (t) => { try { return typeof t === 'string' ? JSON.parse(t) : t || {}; } catch { return {}; } };

export default function CashClosing() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [shift, setShift] = useState(null);
  const [history, setHistory] = useState([]);
  const [declared, setDeclared] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, h] = await Promise.all([get('/api/billing/closing/current'), get('/api/billing/closings')]);
    if (s.ok) setShift(s.data);
    if (h.ok) setHistory(h.data.closings || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const diff = declared === '' || !shift ? null : Math.round((Number(declared) - Number(shift.system_cash)) * 100) / 100;

  const close = async () => {
    if (declared === '') { showAlert('Count the cash and enter the amount.', 'warning'); return; }
    if (diff !== null && Math.abs(diff) >= 1 && !note.trim()) { showAlert('The cash does not match — write what happened.', 'warning'); return; }
    if (!window.confirm(`Close your shift handing over ${money(declared)} cash?`)) return;
    setBusy(true);
    const r = await post('/api/billing/closing', { declared_cash: Number(declared), note });
    setBusy(false);
    if (!r.ok) { showAlert(r.data.message || 'Could not close the shift.', 'error'); return; }
    showAlert(r.data.difference ? `Shift closed with a difference of ${money(r.data.difference)}.` : 'Shift closed. Cash matches.', r.data.difference ? 'warning' : 'success');
    setDeclared(''); setNote('');
    load();
  };

  const methods = Object.entries(shift?.totals || {});
  return (
    <div className="hm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} />}
      <PageHead title="Cash Closing" subtitle="Hand over your cash at the end of the shift. Refunds you paid out are taken off.">
        <button type="button" className="hm-btn" onClick={load}><RefreshCw size={14} /> Refresh</button>
      </PageHead>

      <div className="hm-split">
        <div className="hm-card">
          <div className="hm-card-head"><h3>This shift</h3><span className="hm-muted">{shift?.receipts?.length || 0} entries since your last closing</span></div>
          <div className="hm-card-body">
            {methods.length === 0 ? <Empty>No money received since your last closing.</Empty> : (
              <div className="hm-stats">
                {methods.map(([m, t]) => (
                  <Stat key={m} label={m} value={money(t.in - t.out)} note={t.out ? `${money(t.in)} in · ${money(t.out)} refunded` : `${money(t.in)} received`} />
                ))}
              </div>
            )}
          </div>
          {shift?.receipts?.length > 0 && (
            <div className="hm-table-wrap">
              <table className="hm-table">
                <thead><tr><th>Receipt</th><th>Time</th><th>Method</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {shift.receipts.map((r) => (
                    <tr key={r.id}>
                      <td>{r.receipt_no || `#${r.id}`} {r.kind === 'Refund' && <Badge tone="red">Refund</Badge>}</td>
                      <td className="hm-muted">{when(r.created_at)}</td>
                      <td>{r.method}</td>
                      <td className="num" style={{ color: r.kind === 'Refund' ? '#b91c1c' : undefined }}>{r.kind === 'Refund' ? '− ' : ''}{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="hm-card">
          <div className="hm-card-head"><h3>Close shift</h3></div>
          <div className="hm-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Stat label="Cash you should have" value={money(shift?.system_cash)} tone="blue" />
            <Field label="Cash counted (₹)">
              <input className="hm-input" type="number" min="0" step="1" value={declared} onChange={(e) => setDeclared(e.target.value)}
                style={{ fontSize: 20, height: 46, fontWeight: 700 }} disabled={!shift?.receipts?.length} />
            </Field>
            {diff !== null && (
              <div className={`hm-note ${Math.abs(diff) < 1 ? '' : 'bad'}`}>
                {Math.abs(diff) < 1 ? 'Cash matches.' : diff > 0 ? `${money(diff)} more than expected.` : `${money(-diff)} short.`}
              </div>
            )}
            <Field label="Note" hint={diff !== null && Math.abs(diff) >= 1 ? 'Required when the cash does not match' : 'Optional'}>
              <textarea className="hm-textarea" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <button type="button" className="hm-btn primary lg" onClick={close} disabled={busy || !shift?.receipts?.length}><Lock size={16} /> Close my shift</button>
          </div>
        </div>
      </div>

      <div className="hm-card">
        <div className="hm-card-head"><h3>Past closings</h3><span className="hm-muted">last 30 days</span></div>
        {history.length === 0 ? <Empty>No closings yet.</Empty> : (
          <div className="hm-table-wrap">
            <table className="hm-table">
              <thead><tr><th>Closed</th><th>Cashier</th><th>Entries</th><th>By method</th><th className="num">Expected cash</th><th className="num">Counted</th><th className="num">Difference</th></tr></thead>
              <tbody>
                {history.map((c) => (
                  <tr key={c.id}>
                    <td>{when(c.closed_at)}</td>
                    <td>{c.user_name}</td>
                    <td>{c.receipts_count}</td>
                    <td className="hm-muted">{Object.entries(totalsOf(c.totals)).map(([m, t]) => `${m} ${money(t.in - t.out)}`).join(' · ')}</td>
                    <td className="num">{money(c.system_cash)}</td>
                    <td className="num">{money(c.declared_cash)}</td>
                    <td className="num">{Number(c.difference) === 0 ? <Badge tone="green">Matched</Badge> : <><Badge tone="red">{money(c.difference)}</Badge>{c.note && <span className="sub">{c.note}</span>}</>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
