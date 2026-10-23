import { useState, useEffect, useCallback } from 'react';
import '../../assets/CSS/EquipmentMaintenance.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}`, 'Content-Type': 'application/json' });
const TYPES = ['Preventive maintenance', 'Calibration', 'Quality control', 'Cleaning', 'Other'];
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDT = (d) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dueText = (s) => (s.days_until_due < 0 ? `${-s.days_until_due} day${s.days_until_due === -1 ? '' : 's'} overdue` : s.days_until_due === 0 ? 'Due today' : `Due in ${s.days_until_due} day${s.days_until_due === 1 ? '' : 's'}`);

// Preventive-maintenance schedules for lab equipment: what is due, what is
// overdue, and the service history. Overdue equipment only warns — it never
// stops a test from being run.
export default function EquipmentMaintenance() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('attention');
  const [open, setOpen] = useState({});
  const [record, setRecord] = useState(null);       // schedule being recorded
  const [history, setHistory] = useState(null);     // { machine, history }
  const [adding, setAdding] = useState(null);       // machine
  const [msg, setMsg] = useState(null);
  const canManage = ['admin', 'super admin', 'lab head', 'lab doctor', 'lab_doctor'].includes((localStorage.getItem('role') || '').toLowerCase());

  const load = useCallback(() => {
    fetch(`${API_BASE}/api/lab/maintenance/overview`, { headers: authHdr() }).then((r) => r.json()).then((d) => d.success && setData(d)).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const post = async (url, body, method = 'POST') => {
    const r = await fetch(`${API_BASE}${url}`, { method, headers: authHdr(), body: JSON.stringify(body) });
    const d = await r.json();
    setMsg({ ok: !!d.success, text: d.message });
    if (d.success) load();
    return d;
  };

  const openHistory = async (m) => {
    const r = await fetch(`${API_BASE}/api/lab/maintenance/history/${m.id}`, { headers: authHdr() });
    const d = await r.json();
    if (d.success) setHistory(d);
  };

  const rows = (data?.equipment || []).filter((e) => filter === 'all' ? true : filter === 'attention' ? e.overdue + e.due_soon > 0 : e.schedules.length === 0);

  return (
    <div className="em-page">
      <div className="em-head">
        <div>
          <h1>Equipment Maintenance</h1>
          <p>Preventive-maintenance and calibration schedules for lab equipment. Overdue tasks are flagged everywhere but never stop a test from being run.</p>
        </div>
      </div>

      {data && (
        <div className="em-kpis">
          <button onClick={() => setFilter('all')}><b>{data.summary.equipment}</b><span>Equipment</span></button>
          <button className={data.summary.overdue ? 'bad' : ''} onClick={() => setFilter('attention')}><b>{data.summary.overdue}</b><span>Overdue tasks</span></button>
          <button className={data.summary.due_soon ? 'warn' : ''} onClick={() => setFilter('attention')}><b>{data.summary.due_soon}</b><span>Due soon</span></button>
          <button onClick={() => setFilter('none')}><b>{data.summary.without_schedule}</b><span>No schedule yet</span></button>
        </div>
      )}

      <div className="em-tabs">
        {[['attention', 'Needs attention'], ['all', 'All equipment'], ['none', 'No schedule']].map(([k, l]) => (
          <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {msg && <div className={`em-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}

      <div className="em-list">
        {!data && <div className="em-empty">Loading…</div>}
        {data && rows.length === 0 && <div className="em-empty">{filter === 'attention' ? 'Everything is up to date.' : 'Nothing to show.'}</div>}
        {rows.map((e) => {
          const expanded = open[e.id] || filter === 'attention';
          return (
            <div key={e.id} className={`em-card${e.overdue ? ' overdue' : e.due_soon ? ' soon' : ''}`}>
              <div className="em-card-top" onClick={() => setOpen({ ...open, [e.id]: !open[e.id] })}>
                <div>
                  <div className="em-name">{e.name} <span>{e.manufacturer} {e.model}</span></div>
                  <div className="em-sub">{e.lab_name || '—'}{e.serial_number ? ` · S/N ${e.serial_number}` : ''} · {e.schedules.length} task{e.schedules.length === 1 ? '' : 's'}</div>
                </div>
                <div className="em-badges">
                  {e.overdue > 0 && <span className="em-badge bad">{e.overdue} overdue</span>}
                  {e.due_soon > 0 && <span className="em-badge warn">{e.due_soon} due soon</span>}
                  {e.schedules.length === 0 && <span className="em-badge">No schedule</span>}
                </div>
              </div>
              {expanded && (
                <div className="em-body">
                  {e.schedules.length > 0 && (
                    <table className="em-table">
                      <thead><tr><th>Task</th><th>Every</th><th>Last done</th><th>Next due</th><th /></tr></thead>
                      <tbody>
                        {e.schedules.map((s) => (
                          <tr key={s.id}>
                            <td><b>{s.task_name}</b><div className="em-sub">{s.task_type}</div></td>
                            <td>{s.frequency_every} {s.frequency_unit.toLowerCase()}{s.frequency_every > 1 ? 's' : ''}</td>
                            <td>{fmtDate(s.last_done_at)}</td>
                            <td><span className={`em-state ${s.state.replace(' ', '-').toLowerCase()}`}>{s.state}</span><div className="em-sub">{fmtDate(s.next_due_at)} · {dueText(s)}</div></td>
                            <td className="em-actions">
                              <button className="em-btn" onClick={() => setRecord({ schedule: s, machine: e })}>Record done</button>
                              {canManage && <button className="em-btn ghost" onClick={() => post(`/api/lab/maintenance/schedules/${s.id}`, { active: false }, 'PUT')}>Remove</button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="em-row-actions">
                    {canManage && <button className="em-btn ghost" onClick={() => post('/api/lab/maintenance/apply-standard', { machine_id: e.id })}>Apply standard schedule</button>}
                    {canManage && <button className="em-btn ghost" onClick={() => setAdding(e)}>Add task</button>}
                    <button className="em-btn ghost" onClick={() => openHistory(e)}>Service history</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {record && <RecordModal {...record} onClose={() => setRecord(null)} onSave={async (body) => { const d = await post(`/api/lab/maintenance/schedules/${record.schedule.id}/complete`, body); if (d.success) setRecord(null); return d; }} />}
      {adding && <AddModal machine={adding} onClose={() => setAdding(null)} onSave={async (body) => { const d = await post('/api/lab/maintenance/schedules', { ...body, machine_id: adding.id }); if (d.success) setAdding(null); return d; }} />}
      {history && (
        <div className="em-overlay" onClick={() => setHistory(null)}>
          <div className="em-modal wide" onClick={(e) => e.stopPropagation()}>
            <h2>Service history — {history.machine.name}</h2>
            <table className="em-table">
              <thead><tr><th>Date</th><th>Task</th><th>Done by</th><th>Outcome</th><th>Notes</th></tr></thead>
              <tbody>
                {history.history.map((h) => (
                  <tr key={h.id}><td>{fmtDT(h.performed_at)}</td><td>{h.task_name}{h.was_overdue ? <span className="em-badge bad small">was overdue</span> : null}</td><td>{h.performed_by_name}{h.vendor ? ` · ${h.vendor}` : ''}</td><td>{h.outcome}</td><td>{[h.notes, h.parts_used && `Parts: ${h.parts_used}`].filter(Boolean).join(' — ')}</td></tr>
                ))}
                {history.history.length === 0 && <tr><td colSpan={5} className="em-empty">No service recorded yet.</td></tr>}
              </tbody>
            </table>
            <div className="em-modal-actions"><button className="em-btn ghost" onClick={() => setHistory(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordModal({ schedule, machine, onClose, onSave }) {
  const [f, setF] = useState({ outcome: 'Completed', notes: '', parts_used: '', vendor: '', performed_at: '' });
  const [err, setErr] = useState(null);
  return (
    <div className="em-overlay" onClick={onClose}>
      <div className="em-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Record maintenance</h2>
        <p className="em-sub">{machine.name} — <b>{schedule.task_name}</b></p>
        {schedule.instructions && <p className="em-note">{schedule.instructions}</p>}
        <div className="em-grid">
          <label>Outcome<select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}><option>Completed</option><option>Completed with issues</option><option>Not completed</option></select></label>
          <label>Date and time (blank = now)<input type="datetime-local" value={f.performed_at} onChange={(e) => setF({ ...f, performed_at: e.target.value })} /></label>
          <label>Service engineer / company (if external)<input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></label>
          <label>Parts used<input value={f.parts_used} onChange={(e) => setF({ ...f, parts_used: e.target.value })} /></label>
        </div>
        <label className="em-full">Notes{f.outcome !== 'Completed' ? ' (required)' : ''}<textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {err && <div className="em-msg bad">{err}</div>}
        <div className="em-modal-actions">
          <button className="em-btn ghost" onClick={onClose}>Cancel</button>
          <button className="em-btn" onClick={async () => { const d = await onSave({ ...f, performed_at: f.performed_at || undefined }); if (!d.success) setErr(d.message); }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function AddModal({ machine, onClose, onSave }) {
  const [f, setF] = useState({ task_name: '', task_type: TYPES[0], frequency_unit: 'Month', frequency_every: 1, warn_days_before: 7, first_due_at: '', instructions: '' });
  const [err, setErr] = useState(null);
  return (
    <div className="em-overlay" onClick={onClose}>
      <div className="em-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add task — {machine.name}</h2>
        <div className="em-grid">
          <label className="em-full">Task<input value={f.task_name} onChange={(e) => setF({ ...f, task_name: e.target.value })} placeholder="e.g. Replace pump tubing" /></label>
          <label>Type<select value={f.task_type} onChange={(e) => setF({ ...f, task_type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>First due on (blank = one interval from today)<input type="date" value={f.first_due_at} onChange={(e) => setF({ ...f, first_due_at: e.target.value })} /></label>
          <label>Repeat every<input type="number" min="1" value={f.frequency_every} onChange={(e) => setF({ ...f, frequency_every: e.target.value })} /></label>
          <label>Unit<select value={f.frequency_unit} onChange={(e) => setF({ ...f, frequency_unit: e.target.value })}><option>Day</option><option>Week</option><option>Month</option><option>Year</option></select></label>
          <label>Warn this many days before<input type="number" min="0" value={f.warn_days_before} onChange={(e) => setF({ ...f, warn_days_before: e.target.value })} /></label>
        </div>
        <label className="em-full">Instructions (optional)<textarea rows={2} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></label>
        {err && <div className="em-msg bad">{err}</div>}
        <div className="em-modal-actions">
          <button className="em-btn ghost" onClick={onClose}>Cancel</button>
          <button className="em-btn" onClick={async () => { const d = await onSave({ ...f, first_due_at: f.first_due_at || undefined }); if (!d.success) setErr(d.message); }}>Add task</button>
        </div>
      </div>
    </div>
  );
}
