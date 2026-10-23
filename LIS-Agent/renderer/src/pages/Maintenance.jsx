import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { RefreshCw, Wrench, CheckCircle2 } from 'lucide-react';
import { API_BASE } from '../apiBase';
import { loadLocalMachines, isLocalMachine } from '../utils/localMachines';
import '../assets/CSS/Maintenance.css';

const fmtDate = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
const dueText = (s) => (s.days_until_due < 0 ? `${-s.days_until_due} day${s.days_until_due === -1 ? '' : 's'} overdue` : s.days_until_due === 0 ? 'Due today' : `Due in ${s.days_until_due} day${s.days_until_due === 1 ? '' : 's'}`);

// Equipment tasks that are due or overdue. A reminder only — an overdue
// analyzer can still be used; the technician just records the work here.
export default function Maintenance() {
  const [alerts, setAlerts] = useState([]);
  const [localCount, setLocalCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(null);
  const [f, setF] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, local] = await Promise.all([axios.get(`${API_BASE}/api/lab/maintenance/alerts`), loadLocalMachines()]);
      // Only the analyzers set up on this computer.
      if (r.data.success) { setAlerts(r.data.alerts.filter((a) => isLocalMachine(local, a.machine_name))); setLocalCount(local.count); }
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const open = (a) => { setTarget(a); setMsg(null); setF({ outcome: 'Completed', notes: '', parts_used: '', vendor: '', performed_by_name: localStorage.getItem('operator_name') || '' }); };

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await axios.post(`${API_BASE}/api/lab/maintenance/schedules/${target.id}/complete`, f, { validateStatus: () => true });
      setMsg({ ok: !!r.data.success, text: r.data.message });
      if (r.data.success) { try { localStorage.setItem('operator_name', f.performed_by_name); } catch { /* ignore */ } setTarget(null); load(); }
    } catch { setMsg({ ok: false, text: 'Could not reach the server.' }); }
    finally { setBusy(false); }
  };

  const byMachine = alerts.reduce((acc, a) => { (acc[a.machine_name] ||= []).push(a); return acc; }, {});

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Equipment Maintenance</h1>
          <p className="page-subtitle">Maintenance and calibration that is due or overdue. This is a reminder — it does not stop you running tests.</p>
        </div>
        <div className="page-actions"><button onClick={load} className="btn btn-secondary"><RefreshCw size={14} /> Refresh</button></div>
      </div>

      {loading && <div className="loading-row"><div className="spinner" /> Loading...</div>}
      {!loading && alerts.length === 0 && (
        <div className="card mt-empty"><CheckCircle2 size={26} /><div>{localCount === 0 ? 'No analyzers are set up on this computer yet. Add them in Machine Setup.' : 'All equipment maintenance is up to date.'}</div></div>
      )}

      <div className="mt-list">
        {Object.entries(byMachine).map(([machine, tasks]) => (
          <div key={machine} className="card mt-card">
            <div className="mt-machine"><Wrench size={16} /> {machine} <span>{tasks[0].model} · {tasks[0].lab_name}</span></div>
            {tasks.map((t) => (
              <div key={t.id} className="mt-task">
                <div>
                  <div className="mt-task-name">{t.task_name}</div>
                  <div className="mt-sub">{t.task_type} · due {fmtDate(t.next_due_at)}{t.last_done_at ? ` · last done ${fmtDate(t.last_done_at)}` : ''}</div>
                </div>
                <span className={`badge ${t.state === 'Overdue' ? 'badge-danger' : 'badge-warning'}`}>{dueText(t)}</span>
                <button className="btn btn-primary mt-btn" onClick={() => open(t)}>Record done</button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {target && (
        <div className="modal-overlay">
          <div className="modal-card mt-modal">
            <h3>Record maintenance</h3>
            <p className="mt-sub">{target.machine_name} — <b>{target.task_name}</b></p>
            {target.instructions && <p className="mt-note">{target.instructions}</p>}
            <div className="mt-grid">
              <label><span className="field-label">Outcome</span><select className="control" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}><option>Completed</option><option>Completed with issues</option><option>Not completed</option></select></label>
              <label><span className="field-label">Your name</span><input className="control" value={f.performed_by_name} onChange={(e) => setF({ ...f, performed_by_name: e.target.value })} /></label>
              <label><span className="field-label">Service engineer / company (if external)</span><input className="control" value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></label>
              <label><span className="field-label">Parts used</span><input className="control" value={f.parts_used} onChange={(e) => setF({ ...f, parts_used: e.target.value })} /></label>
            </div>
            <label style={{ display: 'block' }}><span className="field-label">Notes{f.outcome !== 'Completed' ? ' (required)' : ''}</span><textarea className="control" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
            {msg && <div className={`mt-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
            <div className="mt-actions">
              <button className="btn btn-secondary" onClick={() => setTarget(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || f.performed_by_name.trim().length < 3} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
