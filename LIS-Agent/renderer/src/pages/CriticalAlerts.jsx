import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { RefreshCw, PhoneCall, ShieldAlert } from 'lucide-react';
import { API_BASE } from '../apiBase';
import '../assets/CSS/CriticalAlerts.css';

const fmt = (t) => new Date(t).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);
const METHODS = ['Phone', 'In person', 'SMS', 'WhatsApp', 'Email', 'Other'];

// Critical values from the analyzers: the technician informs the responsible
// clinician and records who was told, how, and that they read the values back.
export default function CriticalAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(null);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API_BASE}/api/lab/critical-alerts`, { params: { status: 'open' } });
      if (r.data.success) setAlerts(r.data.alerts);
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const open = (a) => {
    setTarget(a); setMsg(null);
    setForm({ method: 'Phone', outcome: 'Acknowledged', notified_to_name: a.referring_clinician || '', notified_to_role: '', read_back: false, note: '', recorded_by_name: localStorage.getItem('operator_name') || '' });
  };

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await axios.post(`${API_BASE}/api/lab/critical-alerts/${target.id}/notify`, form, { validateStatus: () => true });
      setMsg({ ok: !!r.data.success, text: r.data.message });
      if (r.data.success) { try { localStorage.setItem('operator_name', form.recorded_by_name); } catch { /* ignore */ } setTarget(null); load(); }
    } catch { setMsg({ ok: false, text: 'Could not reach the server.' }); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Critical Alerts</h1>
          <p className="page-subtitle">Inform the responsible clinician of each critical value and record who acknowledged it. The report cannot be authorized until then.</p>
        </div>
        <div className="page-actions"><button onClick={load} className="btn btn-secondary"><RefreshCw size={14} /> Refresh</button></div>
      </div>

      {loading && <div className="loading-row"><div className="spinner" /> Loading...</div>}
      {!loading && alerts.length === 0 && <div className="card cra-empty"><ShieldAlert size={26} /><div>No critical results are waiting.</div></div>}

      <div className="cra-list">
        {alerts.map((a) => (
          <div key={a.id} className={`card cra-card${a.overdue ? ' overdue' : ''}`}>
            <div className="cra-top">
              <div>
                <div className="cra-patient">{a.patient_name} <span>{a.reg_no}</span></div>
                <div className="cra-sub">{a.test_name} · Sample {a.sample_id.slice(-4)} · Raised {fmt(a.raised_at)}</div>
              </div>
              <span className={`badge ${a.overdue ? 'badge-danger' : 'badge-warning'}`}>{a.overdue ? 'Overdue' : 'Awaiting'} · {dur(a.minutes_open)} of {dur(a.notify_within_minutes)}</span>
            </div>
            <div className="cra-values">{(a.parameters || []).map((p, i) => <span key={i}><b>{p.parameter}</b> {p.value} {p.unit}<i>{p.flag}</i></span>)}</div>
            <div className="cra-sub">Notify: <b>{a.referring_clinician || 'ordering clinician'}</b>{a.referring_facility ? ` · ${a.referring_facility}` : ''}</div>
            {a.notifications.length > 0 && (
              <ul className="cra-log">{a.notifications.map((n) => <li key={n.id}>{fmt(n.notified_at)} — {n.method} to {n.notified_to_name || 'clinician'}: <b>{n.outcome}</b> · by {n.recorded_by_name}{n.note ? ` — ${n.note}` : ''}</li>)}</ul>
            )}
            <div><button className="btn btn-primary cra-btn" onClick={() => open(a)}><PhoneCall size={14} /> Record notification</button></div>
          </div>
        ))}
      </div>

      {target && (
        <div className="modal-overlay">
          <div className="modal-card cra-modal">
            <h3>Record notification</h3>
            <p className="cra-sub">{target.patient_name} · {(target.parameters || []).map((p) => `${p.parameter} ${p.value}`).join(', ')}</p>
            <div className="cra-grid">
              <label><span className="field-label">Contacted by</span><select className="control" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label><span className="field-label">Outcome</span><select className="control" value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}><option>Acknowledged</option><option>No answer</option><option>Left message</option></select></label>
              <label><span className="field-label">Spoke to (name)</span><input className="control" value={form.notified_to_name} onChange={(e) => setForm({ ...form, notified_to_name: e.target.value })} /></label>
              <label><span className="field-label">Designation</span><input className="control" value={form.notified_to_role} onChange={(e) => setForm({ ...form, notified_to_role: e.target.value })} /></label>
            </div>
            {form.outcome === 'Acknowledged' && (
              <label className="cra-check"><input type="checkbox" checked={form.read_back} onChange={(e) => setForm({ ...form, read_back: e.target.checked })} /> The recipient read the values back to me, and they were correct</label>
            )}
            <label><span className="field-label">Your name (recorded as who made the call)</span><input className="control" value={form.recorded_by_name} onChange={(e) => setForm({ ...form, recorded_by_name: e.target.value })} /></label>
            <label style={{ marginTop: 10, display: 'block' }}><span className="field-label">Note (optional)</span><textarea className="control" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            {msg && <div className={`cra-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
            <div className="cra-actions">
              <button className="btn btn-secondary" onClick={() => setTarget(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || form.recorded_by_name.trim().length < 3 || (form.outcome === 'Acknowledged' && (!form.read_back || form.notified_to_name.trim().length < 3))} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
