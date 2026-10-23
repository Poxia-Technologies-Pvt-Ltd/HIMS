import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { RefreshCw, FlaskConical, Plus, History } from 'lucide-react';
import { API_BASE } from '../apiBase';
import { loadLocalMachines, isLocalMachine } from '../utils/localMachines';
import '../assets/CSS/Reagents.css';

const REASONS = ['Empty', 'Expired', 'New lot', 'On-board stability', 'QC failure', 'Other'];
const fmt = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDT = (d) => new Date(d).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const left = (r) => (r.days_left < 0 ? `expired ${-r.days_left}d ago` : r.days_left === 0 ? 'expires today' : `${r.days_left}d left`);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Which reagent lot is on each analyzer, and a record of every change. Expiry
// warnings only remind — they never stop a test.
export default function Reagents() {
  const [data, setData] = useState(null);
  const [target, setTarget] = useState(null);      // { machine, prefill? }
  const [hist, setHist] = useState(null);
  const [f, setF] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stock, setStock] = useState([]);
  const [source, setSource] = useState('stock');   // 'stock' | 'manual'

  const load = useCallback(async () => {
    try {
      const [r, local] = await Promise.all([axios.get(`${API_BASE}/api/lab/reagents/overview`), loadLocalMachines()]);
      if (r.data.success) {
        // Only the analyzers set up on this computer.
        const equipment = r.data.equipment.filter((m) => isLocalMachine(local, m.name));
        setData({
          ...r.data, equipment, localCount: local.count,
          summary: {
            on_board: equipment.reduce((n, m) => n + m.reagents.length, 0),
            expired: equipment.reduce((n, m) => n + m.expired, 0),
            expiring: equipment.reduce((n, m) => n + m.expiring, 0),
          },
        });
      }
    } catch { /* keep last */ }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const open = (machine, prefill = {}) => {
    setTarget(machine); setMsg(null); setStock([]); setSource('stock');
    axios.get(`${API_BASE}/api/lab/reagents/stock`, { params: { machine_id: machine.id } })
      .then((r) => { if (r.data.success) { setStock(r.data.stock); if (r.data.stock.length === 0) setSource('manual'); } })
      .catch(() => setSource('manual'));
    setF({ inventory_batch_id: '', quantity_issued: 1, reagent_name: '', lot_no: '', expiry_date: '', opened_on: today(), stability_days: '', slot: '', manufacturer: '', reason: 'Empty', notes: '', changed_by_name: localStorage.getItem('operator_name') || '', ...prefill });
  };

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const body = source === 'stock' ? { machine_id: target.id, inventory_batch_id: f.inventory_batch_id, quantity_issued: f.quantity_issued, slot: f.slot, reason: f.reason, notes: f.notes, opened_on: f.opened_on, changed_by_name: f.changed_by_name } : { ...f, machine_id: target.id, inventory_batch_id: undefined };
      const r = await axios.post(`${API_BASE}/api/lab/reagents/change`, body, { validateStatus: () => true });
      setMsg({ ok: !!r.data.success, text: r.data.message });
      if (r.data.success) { try { localStorage.setItem('operator_name', f.changed_by_name); } catch { /* ignore */ } setTarget(null); load(); }
    } catch { setMsg({ ok: false, text: 'Could not reach the server.' }); }
    finally { setBusy(false); }
  };

  const showHistory = async (m) => {
    const r = await axios.get(`${API_BASE}/api/lab/reagents/history/${m.id}`);
    if (r.data.success) setHist(r.data);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Reagent Changes</h1>
          <p className="page-subtitle">Record every reagent you load on an analyzer — lot, expiry and who changed it. Expiry warnings are reminders; they do not stop testing.</p>
        </div>
        <div className="page-actions"><button onClick={load} className="btn btn-secondary"><RefreshCw size={14} /> Refresh</button></div>
      </div>

      {data && (
        <div className="rg-kpis">
          <div><b>{data.summary.on_board}</b><span>Reagents on board</span></div>
          <div className={data.summary.expired ? 'bad' : ''}><b>{data.summary.expired}</b><span>Expired</span></div>
          <div className={data.summary.expiring ? 'warn' : ''}><b>{data.summary.expiring}</b><span>Expiring soon</span></div>
        </div>
      )}

      <div className="rg-list">
        {!data && <div className="loading-row"><div className="spinner" /> Loading...</div>}
        {data && data.equipment.length === 0 && (
          <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}>
            {data.localCount === 0 ? 'No analyzers are set up on this computer yet. Add them in Machine Setup.' : 'None of the analyzers set up on this computer were found at the server. Check Machine Setup.'}
          </div>
        )}
        {data?.equipment.map((m) => (
          <div key={m.id} className={`card rg-card${m.expired ? ' bad' : m.expiring ? ' warn' : ''}`}>
            <div className="rg-top">
              <div className="rg-name"><FlaskConical size={16} /> {m.name} <span>{m.model} · {m.lab_name}</span></div>
              <div className="rg-btns">
                <button className="btn btn-secondary rg-btn" onClick={() => showHistory(m)}><History size={13} /> History</button>
                <button className="btn btn-primary rg-btn" onClick={() => open(m)}><Plus size={13} /> Reagent change</button>
              </div>
            </div>
            {m.reagents.length === 0 ? <div className="rg-none">No reagents recorded on this analyzer yet.</div> : (
              <table className="data-table rg-table">
                <thead><tr><th>Reagent</th><th>Lot</th><th>Slot</th><th>Expiry</th><th>Loaded</th><th>Source</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {m.reagents.map((r) => (
                    <tr key={r.id}>
                      <td><b>{r.reagent_name}</b></td><td>{r.lot_no}</td><td>{r.slot || '—'}</td>
                      <td>{fmt(r.effective_expiry)}<div className="rg-sub">{r.limited_by}</div></td>
                      <td>{fmtDT(r.changed_at)}<div className="rg-sub">{r.changed_by_name}</div></td>
                      <td>{r.inventory_batch_id ? <span className="badge badge-info">Stock{r.quantity_issued ? ` ×${r.quantity_issued}` : ''}</span> : <span className="rg-sub">Manual</span>}</td>
                      <td><span className={`badge ${r.state === 'Expired' ? 'badge-danger' : r.state === 'Expiring soon' ? 'badge-warning' : 'badge-success'}`}>{r.state}</span><div className="rg-sub">{left(r)}</div></td>
                      <td><button className="btn btn-secondary rg-btn" onClick={() => open(m, { reagent_name: r.reagent_name, manufacturer: r.manufacturer || '', slot: r.slot || '', stability_days: r.stability_days || '' })}>Change</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      {target && (
        <div className="modal-overlay">
          <div className="modal-card rg-modal">
            <h3>Reagent change — {target.name}</h3>
            <div className="rg-source">
              <button type="button" className={source === 'stock' ? 'active' : ''} disabled={stock.length === 0} onClick={() => setSource('stock')}>From stock{stock.length === 0 ? ' (none available)' : ''}</button>
              <button type="button" className={source === 'manual' ? 'active' : ''} onClick={() => setSource('manual')}>Enter manually</button>
            </div>
            {source === 'stock' ? (
              <div className="rg-grid">
                <label className="rg-wide"><span className="field-label">Stock batch (issued from inventory)</span>
                  <select className="control" value={f.inventory_batch_id} onChange={(e) => setF({ ...f, inventory_batch_id: e.target.value })}>
                    <option value="">Select the pack you are loading…</option>
                    {stock.map((s) => <option key={s.batch_id} value={s.batch_id} disabled={s.status === 'Quarantine'}>{s.item_name} — lot {s.lot} — exp {fmt(s.expiry_date)} — {Number(s.quantity_available)} {s.unit} left{s.status === 'Quarantine' ? ' (quarantine)' : ''}</option>)}
                  </select></label>
                <label><span className="field-label">Packs loaded</span><input className="control" type="number" min="1" value={f.quantity_issued} onChange={(e) => setF({ ...f, quantity_issued: e.target.value })} /></label>
                <label><span className="field-label">Slot / position</span><input className="control" value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })} /></label>
                <label><span className="field-label">Put on board on</span><input className="control" type="date" value={f.opened_on} onChange={(e) => setF({ ...f, opened_on: e.target.value })} /></label>
                <label><span className="field-label">Reason for change</span><select className="control" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{REASONS.map((x) => <option key={x}>{x}</option>)}</select></label>
                <label><span className="field-label">Your name</span><input className="control" value={f.changed_by_name} onChange={(e) => setF({ ...f, changed_by_name: e.target.value })} /></label>
              </div>
            ) : (
            <div className="rg-grid">
              <label><span className="field-label">Reagent</span>
                <input className="control" list="rg-names" value={f.reagent_name} onChange={(e) => setF({ ...f, reagent_name: e.target.value })} placeholder="e.g. CBC Lyse" />
                <datalist id="rg-names">{(target.known_reagents || []).map((n) => <option key={n} value={n} />)}</datalist></label>
              <label><span className="field-label">Lot number</span><input className="control" value={f.lot_no} onChange={(e) => setF({ ...f, lot_no: e.target.value })} /></label>
              <label><span className="field-label">Expiry date</span><input className="control" type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></label>
              <label><span className="field-label">Put on board on</span><input className="control" type="date" value={f.opened_on} onChange={(e) => setF({ ...f, opened_on: e.target.value })} /></label>
              <label><span className="field-label">On-board stability (days, if given)</span><input className="control" type="number" min="1" value={f.stability_days} onChange={(e) => setF({ ...f, stability_days: e.target.value })} /></label>
              <label><span className="field-label">Slot / position</span><input className="control" value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })} /></label>
              <label><span className="field-label">Reason for change</span><select className="control" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{REASONS.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label><span className="field-label">Your name</span><input className="control" value={f.changed_by_name} onChange={(e) => setF({ ...f, changed_by_name: e.target.value })} /></label>
            </div>
            )}
            <label style={{ display: 'block' }}><span className="field-label">Notes (required if the lot is expired)</span><textarea className="control" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
            {msg && <div className={`rg-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
            <div className="rg-actions">
              <button className="btn btn-secondary" onClick={() => setTarget(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || f.changed_by_name.trim().length < 3 || (source === 'stock' ? !f.inventory_batch_id : (!f.reagent_name || !f.lot_no || !f.expiry_date))} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {hist && (
        <div className="modal-overlay" onClick={() => setHist(null)}>
          <div className="modal-card rg-modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>Reagent history — {hist.machine.name}</h3>
            <div className="table-scroll" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>When</th><th>Reagent</th><th>Lot</th><th>Replaced</th><th>Expiry</th><th>Reason</th><th>By</th></tr></thead>
                <tbody>
                  {hist.history.map((h) => (
                    <tr key={h.id}><td>{fmtDT(h.changed_at)}</td><td>{h.reagent_name}</td><td>{h.lot_no}{h.loaded_expired ? <span className="badge badge-danger" style={{ marginLeft: 6 }}>expired</span> : null}</td><td>{h.replaced_lot_no || '—'}</td><td>{fmt(h.expiry_date)}</td><td>{h.reason}{h.notes ? ` — ${h.notes}` : ''}</td><td>{h.changed_by_name}</td></tr>
                  ))}
                  {hist.history.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}>No changes recorded.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="rg-actions"><button className="btn btn-secondary" onClick={() => setHist(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
