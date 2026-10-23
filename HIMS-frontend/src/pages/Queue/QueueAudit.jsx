import { useState, useEffect, useCallback } from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/QueueManagement.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}` });
const PAGE = 100;

const EVENT_TYPES = ['Issued', 'Called', 'Recalled', 'Started', 'Completed', 'Skipped', 'Cancelled'];
const today = () => new Date().toISOString().slice(0, 10);

const fmtDT = (ts) => (ts ? new Date(ts).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
const fmtT = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const mins = (m) => (m === null || m === undefined ? '—' : `${m} min`);
const statusClass = (s) => `qm-status qm-status-${String(s).toLowerCase().replace(' ', '-')}`;

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function downloadCsv(name, header, rows) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

// Queue audit trail (Admin / Lab Head / Receptionist). Two lenses on
// the same data: the token journeys (one row per token, with who issued and
// called it and how long each stage took) and the raw append-only event log
// (every issue, call, recall, start, completion, skip and cancellation).
export default function QueueAudit() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [view, setView] = useState('journeys');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [token, setToken] = useState('');
  const [eventType, setEventType] = useState('');
  const [actor, setActor] = useState('');
  const [journeys, setJourneys] = useState([]);
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ date_from: from, date_to: to });
      const branch = localStorage.getItem('branch_id');
      if (branch) q.set('branch_id', branch);
      if (token.trim()) q.set('token', token.trim());

      if (view === 'journeys') {
        const res = await fetch(`${API_BASE}/api/queue/audit/tokens?${q}`, { headers: authHdr() });
        const data = await res.json();
        if (data.success) setJourneys(data.tokens || []);
        else showAlert(data.message || 'Could not load the audit.', 'error');
      } else {
        if (eventType) q.set('event_type', eventType);
        if (actor.trim()) q.set('actor', actor.trim());
        q.set('limit', PAGE);
        q.set('offset', offset);
        const res = await fetch(`${API_BASE}/api/queue/audit/events?${q}`, { headers: authHdr() });
        const data = await res.json();
        if (data.success) { setEvents(data.events || []); setTotal(data.total || 0); }
        else showAlert(data.message || 'Could not load the audit.', 'error');
      }
    } catch {
      showAlert('Network error loading the audit.', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, from, to, token, eventType, actor, offset]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOffset(0); }, [view, from, to, token, eventType, actor]);

  const exportCsv = () => {
    if (view === 'journeys') {
      downloadCsv(`queue-token-journeys_${from}_${to}.csv`,
        ['Date', 'Token', 'Service point', 'Patient', 'Reg no', 'Priority', 'Status', 'Counter', 'Issued at', 'Issued by', 'Called at', 'Called by', 'Started at', 'Completed at', 'Wait (min)', 'Service (min)', 'Total (min)'],
        journeys.map((t) => [String(t.token_date).slice(0, 10), t.token_number, t.service_point, t.patient_name, t.patient_reg_no, t.priority, t.status, t.counter,
          t.issued_at, t.issued_by_name, t.called_at, t.called_by_name, t.started_at, t.completed_at, t.wait_minutes, t.service_minutes, t.total_minutes]));
    } else {
      downloadCsv(`queue-audit-events_${from}_${to}.csv`,
        ['Timestamp', 'Token', 'Service point', 'Event', 'From', 'To', 'Counter', 'By', 'Role', 'IP', 'Patient', 'Reg no'],
        events.map((e) => [e.created_at, e.token_number, e.service_point, e.event_type, e.from_status, e.to_status, e.counter, e.actor_name, e.actor_role, e.ip_address, e.patient_name, e.patient_reg_no]));
    }
  };

  const rows = view === 'journeys' ? journeys : events;

  return (
    <div className="qm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={3500} />}

      <div className="qm-header">
        <div>
          <h1>Queue Audit</h1>
          <p>Every token issued, called, started and completed — with who did it, at which counter and when. The event log is append-only and cannot be edited from the application.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="qm-btn qm-btn-ghost" onClick={load}><RefreshCw size={14} />Refresh</button>
          <button className="qm-btn qm-btn-primary" onClick={exportCsv} disabled={rows.length === 0}><Download size={14} />Export CSV</button>
        </div>
      </div>

      <div className="qm-card">
        <div className="qm-toolbar">
          <div className="qm-tabs">
            <button className={`qm-tab${view === 'journeys' ? ' active' : ''}`} onClick={() => setView('journeys')}>Token journeys</button>
            <button className={`qm-tab${view === 'events' ? ' active' : ''}`} onClick={() => setView('events')}>Event log</button>
          </div>
          <div className="qm-toolbar-right" style={{ flexWrap: 'wrap' }}>
            <input type="date" className="qm-input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="qm-input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
              <input className="qm-input" style={{ width: 120, paddingLeft: 30 }} placeholder="Token no." value={token} onChange={(e) => setToken(e.target.value)} />
            </div>
            {view === 'events' && (
              <>
                <select className="qm-input" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                  <option value="">All events</option>
                  {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <input className="qm-input" style={{ width: 150 }} placeholder="Staff name" value={actor} onChange={(e) => setActor(e.target.value)} />
              </>
            )}
          </div>
        </div>

        <div className="qm-table-wrap">
          {view === 'journeys' ? (
            <table className="qm-table">
              <thead>
                <tr>
                  <th>Date</th><th>Token</th><th>Patient</th><th>Priority</th><th>Status</th><th>Counter</th>
                  <th>Issued</th><th>Called</th><th>Started</th><th>Completed</th>
                  <th>Waited</th><th>Service</th><th>Total</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={13} className="qm-empty">Loading…</td></tr>}
                {!loading && journeys.length === 0 && <tr><td colSpan={13} className="qm-empty">No tokens in this period.</td></tr>}
                {journeys.map((t) => (
                  <tr key={t.id}>
                    <td>{String(t.token_date).slice(0, 10)}</td>
                    <td className="qm-token">{t.token_number}</td>
                    <td>
                      <div className="qm-patient">{t.patient_name || '—'}</div>
                      {t.patient_reg_no && <div className="qm-sub">{t.patient_reg_no}</div>}
                    </td>
                    <td>{t.priority !== 'Routine' ? <span className={`qm-pri qm-pri-${t.priority.toLowerCase()}`}>{t.priority}</span> : <span className="qm-sub">Routine</span>}</td>
                    <td><span className={statusClass(t.status)}>{t.status}</span></td>
                    <td>{t.counter || '—'}</td>
                    <td>{fmtT(t.issued_at)}<div className="qm-sub">{t.issued_by_name || ''}</div></td>
                    <td>{fmtT(t.called_at)}<div className="qm-sub">{t.called_by_name || ''}</div></td>
                    <td>{fmtT(t.started_at)}</td>
                    <td>{fmtT(t.completed_at)}</td>
                    <td>{mins(t.wait_minutes)}</td>
                    <td>{mins(t.service_minutes)}</td>
                    <td>{mins(t.total_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="qm-table">
              <thead>
                <tr><th>Timestamp</th><th>Token</th><th>Event</th><th>Status change</th><th>Counter</th><th>By</th><th>Role</th><th>IP</th><th>Patient</th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} className="qm-empty">Loading…</td></tr>}
                {!loading && events.length === 0 && <tr><td colSpan={9} className="qm-empty">No events in this period.</td></tr>}
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDT(e.created_at)}</td>
                    <td className="qm-token">{e.token_number}</td>
                    <td><span className={statusClass(e.event_type === 'Started' ? 'In Service' : e.event_type === 'Issued' || e.event_type === 'Recalled' ? 'Called' : e.event_type)}>{e.event_type}</span></td>
                    <td>{e.from_status ? `${e.from_status} → ` : ''}{e.to_status}</td>
                    <td>{e.counter || '—'}</td>
                    <td>{e.actor_name || '—'}</td>
                    <td>{e.actor_role || '—'}</td>
                    <td className="qm-sub">{e.ip_address || '—'}</td>
                    <td>{e.patient_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {view === 'events' && total > PAGE && (
          <div className="qm-toolbar" style={{ borderTop: '1px solid var(--qm-line)', borderBottom: 'none' }}>
            <span className="qm-sub">{offset + 1}–{Math.min(offset + PAGE, total)} of {total} events</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="qm-btn qm-btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
              <button className="qm-btn qm-btn-ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
