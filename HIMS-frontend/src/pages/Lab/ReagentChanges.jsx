import { useState, useEffect, useCallback } from 'react';
import '../../assets/CSS/EquipmentMaintenance.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}`, 'Content-Type': 'application/json' });
const fmt = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDT = (d) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const left = (r) => (r.days_left < 0 ? `expired ${-r.days_left} day${r.days_left === -1 ? '' : 's'} ago` : r.days_left === 0 ? 'expires today' : `${r.days_left} day${r.days_left === 1 ? '' : 's'} left`);
const REASONS = ['Empty', 'Expired', 'New lot', 'On-board stability', 'QC failure', 'Other'];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Which reagent lot is on each analyzer, with a record of every change.
// Expiry only warns — it never stops a test.
export default function ReagentChanges() {
  const [data, setData] = useState(null);
  const [target, setTarget] = useState(null);
  const [f, setF] = useState({});
  const [hist, setHist] = useState(null);
  const [msg, setMsg] = useState(null);
  const [stock, setStock] = useState([]);
  const [source, setSource] = useState('stock');

  const load = useCallback(() => {
    fetch(`${API_BASE}/api/lab/reagents/overview`, { headers: authHdr() }).then((r) => r.json()).then((d) => d.success && setData(d)).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const open = (m, prefill = {}) => {
    setTarget(m); setMsg(null); setStock([]); setSource('stock');
    fetch(`${API_BASE}/api/lab/reagents/stock?machine_id=${m.id}`, { headers: authHdr() }).then((r) => r.json())
      .then((d) => { if (d.success) { setStock(d.stock); if (d.stock.length === 0) setSource('manual'); } }).catch(() => setSource('manual'));
    setF({ inventory_batch_id: '', quantity_issued: 1, reagent_name: '', lot_no: '', expiry_date: '', opened_on: today(), stability_days: '', slot: '', manufacturer: '', reason: 'Empty', notes: '', ...prefill }); };
  const save = async () => {
    const r = await fetch(`${API_BASE}/api/lab/reagents/change`, { method: 'POST', headers: authHdr(), body: JSON.stringify(source === 'stock' ? { machine_id: target.id, inventory_batch_id: f.inventory_batch_id, quantity_issued: f.quantity_issued, slot: f.slot, reason: f.reason, notes: f.notes, opened_on: f.opened_on } : { ...f, machine_id: target.id, inventory_batch_id: undefined }) });
    const d = await r.json();
    setMsg({ ok: !!d.success, text: d.message });
    if (d.success) { setTarget(null); load(); }
  };
  const showHistory = async (m) => {
    const r = await fetch(`${API_BASE}/api/lab/reagents/history/${m.id}`, { headers: authHdr() });
    const d = await r.json();
    if (d.success) setHist(d);
  };

  return (
    <div className="em-page">
      <div className="em-head">
        <h1>Reagent Changes</h1>
        <p>The reagent lot on each analyzer and a record of every change. Expired or nearly-expired reagents are flagged everywhere but never stop a test.</p>
      </div>
      {data && (
        <div className="em-kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)', maxWidth: 640 }}>
          <button><b>{data.summary.on_board}</b><span>Reagents on board</span></button>
          <button className={data.summary.expired ? 'bad' : ''}><b>{data.summary.expired}</b><span>Expired</span></button>
          <button className={data.summary.expiring ? 'warn' : ''}><b>{data.summary.expiring}</b><span>Expiring soon</span></button>
        </div>
      )}
      {msg && !target && <div className={`em-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      <div className="em-list">
        {!data && <div className="em-empty">Loading…</div>}
        {data?.equipment.map((m) => (
          <div key={m.id} className={`em-card${m.expired ? ' overdue' : m.expiring ? ' soon' : ''}`}>
            <div className="em-card-top" style={{ cursor: 'default' }}>
              <div><div className="em-name">{m.name} <span>{m.manufacturer} {m.model}</span></div><div className="em-sub">{m.lab_name || '—'}</div></div>
              <div className="em-row-actions" style={{ margin: 0 }}>
                <button className="em-btn ghost" onClick={() => showHistory(m)}>History</button>
                <button className="em-btn" onClick={() => open(m)}>Record reagent change</button>
              </div>
            </div>
            <div className="em-body">
              {m.reagents.length === 0 ? <div className="em-sub" style={{ padding: '10px 0' }}>No reagents recorded on this analyzer yet.</div> : (
                <table className="em-table">
                  <thead><tr><th>Reagent</th><th>Lot</th><th>Slot</th><th>Expiry</th><th>Loaded</th><th>Source</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {m.reagents.map((r) => (
                      <tr key={r.id}>
                        <td><b>{r.reagent_name}</b></td><td>{r.lot_no}</td><td>{r.slot || '—'}</td>
                        <td>{fmt(r.effective_expiry)}<div className="em-sub">{r.limited_by}</div></td>
                        <td>{fmtDT(r.changed_at)}<div className="em-sub">{r.changed_by_name}</div></td>
                        <td>{r.inventory_batch_id ? <span className="em-badge">Stock{r.quantity_issued ? ` ×${r.quantity_issued}` : ''}</span> : <span className="em-sub">Manual</span>}</td>
                        <td><span className={`em-state ${r.state === 'Expired' ? 'overdue' : r.state === 'Expiring soon' ? 'due-soon' : ''}`}>{r.state}</span><div className="em-sub">{left(r)}</div></td>
                        <td><button className="em-btn ghost" onClick={() => open(m, { reagent_name: r.reagent_name, manufacturer: r.manufacturer || '', slot: r.slot || '', stability_days: r.stability_days || '' })}>Change</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ))}
      </div>

      {target && (
        <div className="em-overlay" onClick={() => setTarget(null)}>
          <div className="em-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reagent change — {target.name}</h2>
            <div className="em-source">
              <button type="button" className={source === 'stock' ? 'active' : ''} disabled={stock.length === 0} onClick={() => setSource('stock')}>From stock{stock.length === 0 ? ' (none available)' : ''}</button>
              <button type="button" className={source === 'manual' ? 'active' : ''} onClick={() => setSource('manual')}>Enter manually</button>
            </div>
            {source === 'stock' ? (
              <div className="em-grid">
                <label className="em-full" style={{ gridColumn: '1 / -1' }}>Stock batch (issued from inventory)
                  <select value={f.inventory_batch_id} onChange={(e) => setF({ ...f, inventory_batch_id: e.target.value })}>
                    <option value="">Select the pack you are loading…</option>
                    {stock.map((s) => <option key={s.batch_id} value={s.batch_id} disabled={s.status === 'Quarantine'}>{s.item_name} — lot {s.lot} — exp {fmt(s.expiry_date)} — {Number(s.quantity_available)} {s.unit} left{s.status === 'Quarantine' ? ' (quarantine)' : ''}</option>)}
                  </select></label>
                <label>Packs loaded<input type="number" min="1" value={f.quantity_issued} onChange={(e) => setF({ ...f, quantity_issued: e.target.value })} /></label>
                <label>Slot / position<input value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })} /></label>
                <label>Put on board on<input type="date" value={f.opened_on} onChange={(e) => setF({ ...f, opened_on: e.target.value })} /></label>
                <label>Reason<select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{REASONS.map((x) => <option key={x}>{x}</option>)}</select></label>
              </div>
            ) : (
            <div className="em-grid">
              <label>Reagent<input list="rg-names" value={f.reagent_name} onChange={(e) => setF({ ...f, reagent_name: e.target.value })} /><datalist id="rg-names">{(target.known_reagents || []).map((n) => <option key={n} value={n} />)}</datalist></label>
              <label>Lot number<input value={f.lot_no} onChange={(e) => setF({ ...f, lot_no: e.target.value })} /></label>
              <label>Expiry date<input type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></label>
              <label>Put on board on<input type="date" value={f.opened_on} onChange={(e) => setF({ ...f, opened_on: e.target.value })} /></label>
              <label>On-board stability (days, if given)<input type="number" min="1" value={f.stability_days} onChange={(e) => setF({ ...f, stability_days: e.target.value })} /></label>
              <label>Slot / position<input value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })} /></label>
              <label>Reason<select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{REASONS.map((x) => <option key={x}>{x}</option>)}</select></label>
            </div>
            )}
            <label className="em-full">Notes (required if the lot is expired)<textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
            {msg && <div className={`em-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
            <div className="em-modal-actions">
              <button className="em-btn ghost" onClick={() => setTarget(null)}>Cancel</button>
              <button className="em-btn" disabled={source === 'stock' ? !f.inventory_batch_id : (!f.reagent_name || !f.lot_no || !f.expiry_date)} onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}

      {hist && (
        <div className="em-overlay" onClick={() => setHist(null)}>
          <div className="em-modal wide" onClick={(e) => e.stopPropagation()}>
            <h2>Reagent history — {hist.machine.name}</h2>
            <table className="em-table">
              <thead><tr><th>When</th><th>Reagent</th><th>Lot</th><th>Replaced</th><th>Expiry</th><th>Reason</th><th>By</th></tr></thead>
              <tbody>
                {hist.history.map((h) => (
                  <tr key={h.id}><td>{fmtDT(h.changed_at)}</td><td>{h.reagent_name}</td><td>{h.lot_no}{h.loaded_expired ? <span className="em-badge bad small">expired</span> : null}</td><td>{h.replaced_lot_no || '—'}</td><td>{fmt(h.expiry_date)}</td><td>{h.reason}{h.notes ? ` — ${h.notes}` : ''}</td><td>{h.changed_by_name}</td></tr>
                ))}
                {hist.history.length === 0 && <tr><td colSpan={7} className="em-empty">No changes recorded.</td></tr>}
              </tbody>
            </table>
            <div className="em-modal-actions"><button className="em-btn ghost" onClick={() => setHist(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
