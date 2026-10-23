import { useState, useEffect, useCallback } from 'react';
import '../../assets/CSS/CriticalAlerts.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}`, 'Content-Type': 'application/json' });
const fmt = (t) => new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);
const METHODS = ['Phone', 'In person', 'SMS', 'WhatsApp', 'Email', 'Other'];

// Critical-result alerts: who has to be told, the attempts made, and the
// documented acknowledgement (with read-back) that closes each alert.
export default function CriticalAlerts() {
  const [tab, setTab] = useState('open');
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(null);
  const [form, setForm] = useState({ method: 'Phone', outcome: 'Acknowledged', notified_to_name: '', notified_to_role: '', read_back: false, note: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/lab/critical-alerts?status=${tab === 'open' ? 'open' : 'all'}`, { headers: authHdr() });
      const d = await r.json();
      if (d.success) setAlerts(tab === 'open' ? d.alerts : d.alerts.filter((a) => a.status !== 'Open'));
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { setLoading(true); load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${API_BASE}/api/lab/critical-alerts/${target.id}/notify`, { method: 'POST', headers: authHdr(), body: JSON.stringify(form) });
      const d = await r.json();
      setMsg({ ok: !!d.success, text: d.message });
      if (d.success) { setTarget(null); load(); }
    } catch { setMsg({ ok: false, text: 'Network error.' }); }
    finally { setBusy(false); }
  };

  const open = (a) => { setTarget(a); setMsg(null); setForm({ method: 'Phone', outcome: 'Acknowledged', notified_to_name: a.referring_clinician || '', notified_to_role: '', read_back: false, note: '' }); };
  const overdue = alerts.filter((a) => a.overdue).length;

  return (
    <div className="ca-page">
      <div className="ca-head">
        <div><h1>Critical Result Alerts</h1><p>Every critical value must be communicated to the responsible clinician and acknowledged with read-back. Each attempt is recorded.</p></div>
        <div className="ca-tabs">
          <button className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>Awaiting notification{tab === 'open' && alerts.length > 0 ? ` (${alerts.length})` : ''}</button>
          <button className={tab === 'done' ? 'active' : ''} onClick={() => setTab('done')}>Recently closed</button>
        </div>
      </div>

      {tab === 'open' && overdue > 0 && <div className="ca-banner">{overdue} alert{overdue > 1 ? 's are' : ' is'} past the time limit for notification.</div>}

      <div className="ca-list">
        {loading && <div className="ca-empty">Loading…</div>}
        {!loading && alerts.length === 0 && <div className="ca-empty">{tab === 'open' ? 'No critical results are waiting.' : 'Nothing closed recently.'}</div>}
        {alerts.map((a) => (
          <div key={a.id} className={`ca-card${a.overdue ? ' overdue' : ''}${a.status !== 'Open' ? ' done' : ''}`}>
            <div className="ca-card-top">
              <div>
                <div className="ca-patient">{a.patient_name} <span>{a.reg_no}</span></div>
                <div className="ca-sub">{a.test_name} · Sample {a.sample_id.slice(-4)} · Raised {fmt(a.raised_at)}</div>
              </div>
              <div className="ca-state">
                <span className={`ca-badge ${a.status === 'Open' ? (a.overdue ? 'bad' : 'warn') : 'ok'}`}>{a.status === 'Open' ? (a.overdue ? 'Overdue' : 'Awaiting') : a.status}</span>
                <span className="ca-time">{a.status === 'Open' ? `${dur(a.minutes_open)} of ${dur(a.notify_within_minutes)}` : a.acknowledged_at ? `Acknowledged ${fmt(a.acknowledged_at)}` : ''}</span>
              </div>
            </div>
            <div className="ca-values">
              {(a.parameters || []).map((p, i) => <span key={i} className="ca-val"><b>{p.parameter}</b> {p.value} {p.unit}<i>{p.flag}</i></span>)}
            </div>
            <div className="ca-sub">Notify: <b>{a.referring_clinician || 'ordering clinician'}</b>{a.referring_facility ? ` · ${a.referring_facility}` : ''}{a.telephone ? ` · Patient ${a.telephone}` : ''}</div>
            {a.notifications.length > 0 && (
              <ul className="ca-log">
                {a.notifications.map((n) => (
                  <li key={n.id}>{fmt(n.notified_at)} — {n.method} to {n.notified_to_name || 'clinician'}{n.notified_to_role ? ` (${n.notified_to_role})` : ''}: <b>{n.outcome}</b>{n.read_back ? ' · read-back confirmed' : ''} · by {n.recorded_by_name}{n.note ? ` — ${n.note}` : ''}</li>
                ))}
              </ul>
            )}
            {a.status === 'Open' && <button className="ca-btn" onClick={() => open(a)}>Record notification</button>}
          </div>
        ))}
      </div>

      {target && (
        <div className="ca-overlay" onClick={() => setTarget(null)}>
          <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Record notification</h2>
            <p className="ca-sub">{target.patient_name} · {(target.parameters || []).map((p) => `${p.parameter} ${p.value}`).join(', ')}</p>
            <div className="ca-grid">
              <label>How was the clinician contacted
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>Outcome
                <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}><option>Acknowledged</option><option>No answer</option><option>Left message</option></select></label>
              <label>Spoke to (name)<input value={form.notified_to_name} onChange={(e) => setForm({ ...form, notified_to_name: e.target.value })} /></label>
              <label>Role / designation<input value={form.notified_to_role} onChange={(e) => setForm({ ...form, notified_to_role: e.target.value })} placeholder="e.g. Ordering physician" /></label>
            </div>
            {form.outcome === 'Acknowledged' && (
              <label className="ca-check"><input type="checkbox" checked={form.read_back} onChange={(e) => setForm({ ...form, read_back: e.target.checked })} />
                The recipient read the values back to me, and they were correct</label>
            )}
            <label className="ca-note">Note (optional)<textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            {msg && <div className={`ca-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
            <div className="ca-actions">
              <button className="ca-btn ghost" onClick={() => setTarget(null)}>Cancel</button>
              <button className="ca-btn" disabled={busy || (form.outcome === 'Acknowledged' && (!form.read_back || form.notified_to_name.trim().length < 3))} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
