import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Megaphone, Play, CheckCircle2, SkipForward, XCircle } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/QueueManagement.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}` });
const POLL_MS = 15_000;

// Registration tokens are taken by new patients at the lobby kiosk.
const SERVICE_POINTS = ['Sample Collection', 'Registration'];
const STATUSES = ['Waiting', 'Called', 'In Service', 'Completed', 'Skipped', 'Cancelled'];

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const statusClass = (s) => `qm-status qm-status-${s.toLowerCase().replace(' ', '-')}`;

// Operator screen for the Sample Collection and Registration queues. Tokens
// are persisted server-side (patient_queue_tokens) — issued automatically when
// a bill with lab tests is created, or taken by the patient at the kiosk — and
// move Waiting -> Called -> In Service -> Completed; every step is stamped
// with time and operator by the API.
export default function QueueManagement() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [servicePoint, setServicePoint] = useState(SERVICE_POINTS[0]);
  const [statusFilter, setStatusFilter] = useState('active');
  const [tokens, setTokens] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [counter, setCounter] = useState('');
  const [busyId, setBusyId] = useState(null);

  const fetchTokens = useCallback(async () => {
    try {
      const branch = localStorage.getItem('branch_id');
      const res = await fetch(`${API_BASE}/api/queue/tokens${branch ? `?branch_id=${branch}` : ''}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        setTokens(data.tokens || []);
        setSummary(data.summary || {});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
    const t = setInterval(fetchTokens, POLL_MS);
    return () => clearInterval(t);
  }, [fetchTokens]);

  const move = async (token, status) => {
    setBusyId(token.id);
    try {
      const res = await fetch(`${API_BASE}/api/queue/tokens/${token.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ status, counter: status === 'Called' ? counter.trim() || undefined : undefined }),
      });
      const data = await res.json();
      if (data.success) fetchTokens();
      else showAlert(data.message || 'Update failed.', 'error');
    } catch {
      showAlert('Network error updating token.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const visible = tokens.filter((t) => {
    if (t.service_point !== servicePoint) return false;
    if (statusFilter === 'active') return ['Waiting', 'Called', 'In Service', 'Skipped'].includes(t.status);
    if (statusFilter === 'all') return true;
    return t.status === statusFilter;
  });

  const sp = summary[servicePoint] || {};
  const nextWaiting = tokens.find((t) => t.service_point === servicePoint && t.status === 'Waiting');

  const actionsFor = (t) => {
    const btn = (label, status, Icon, tone) => (
      <button key={status} className={`qm-btn qm-btn-${tone}`} disabled={busyId === t.id} onClick={() => move(t, status)}>
        <Icon size={13} />{label}
      </button>
    );
    switch (t.status) {
      case 'Waiting':    return [btn('Call', 'Called', Megaphone, 'primary'), btn('Skip', 'Skipped', SkipForward, 'ghost')];
      case 'Called':     return [btn('Start', 'In Service', Play, 'primary'), btn('Skip', 'Skipped', SkipForward, 'ghost')];
      case 'In Service': return [btn('Complete', 'Completed', CheckCircle2, 'success')];
      case 'Skipped':    return [btn('Recall', 'Called', Megaphone, 'ghost'), btn('Cancel', 'Cancelled', XCircle, 'danger')];
      default:           return null;
    }
  };

  return (
    <div className="qm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={3500} />}

      <div className="qm-header">
        <div>
          <h1>{servicePoint} Queue</h1>
          <p>{servicePoint === 'Registration'
            ? 'Registration tokens are taken by new patients at the lobby kiosk. Call them to the registration counter.'
            : 'Tokens are issued automatically when a bill with lab tests is generated, or by the patient at the kiosk.'} Every step is time-stamped and attributed to the operator.</p>
        </div>
        <button className="qm-btn qm-btn-ghost" onClick={fetchTokens}><RefreshCw size={14} />Refresh</button>
      </div>

      <div className="qm-kpis">
        {STATUSES.slice(0, 4).map((s) => (
          <div key={s} className="qm-kpi">
            <span className="qm-kpi-label">{s}</span>
            <span className="qm-kpi-value">{sp[s] || 0}</span>
          </div>
        ))}
      </div>

      <div className="qm-card">
        <div className="qm-toolbar">
          <div className="qm-tabs">
            {SERVICE_POINTS.map((p) => {
              const waiting = summary[p]?.Waiting || 0;
              return (
                <button key={p} type="button" className={`qm-tab${servicePoint === p ? ' active' : ''}`} onClick={() => setServicePoint(p)}>
                  {p}{waiting ? ` (${waiting})` : ''}
                </button>
              );
            })}
          </div>
          <div className="qm-toolbar-right">
            <input className="qm-input" style={{ width: 150 }} placeholder="Counter / desk (optional)" value={counter} onChange={(e) => setCounter(e.target.value)} />
            <select className="qm-input" style={{ width: 150 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="active">Active tokens</option>
              <option value="all">All today</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {nextWaiting && (
          <div className="qm-next">Next in queue: <strong>{nextWaiting.token_number}</strong>{nextWaiting.patient_name ? ` — ${nextWaiting.patient_name}` : ''}</div>
        )}

        <div className="qm-table-wrap">
          <table className="qm-table">
            <thead>
              <tr>
                <th>Token</th><th>Patient</th><th>Priority</th><th>Status</th><th>Counter</th>
                <th>Issued</th><th>Called</th><th>Started</th><th>Completed</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} className="qm-empty">Loading…</td></tr>}
              {!loading && visible.length === 0 && <tr><td colSpan={10} className="qm-empty">No tokens to show.</td></tr>}
              {visible.map((t) => (
                <tr key={t.id}>
                  <td className="qm-token">{t.token_number}</td>
                  <td>
                    <div className="qm-patient">{t.patient_name || '—'}</div>
                    {t.patient_reg_no && <div className="qm-sub">{t.patient_reg_no}</div>}
                    {t.issued_via === 'Kiosk' && <div className="qm-sub">Taken at kiosk{!t.patient_reg_no ? ' · new patient' : ''}</div>}
                  </td>
                  <td>{t.priority !== 'Routine' ? <span className={`qm-pri qm-pri-${t.priority.toLowerCase()}`}>{t.priority}</span> : <span className="qm-sub">Routine</span>}</td>
                  <td><span className={statusClass(t.status)}>{t.status}</span></td>
                  <td>{t.counter || '—'}</td>
                  <td>{fmtTime(t.issued_at)}</td>
                  <td>{fmtTime(t.called_at)}</td>
                  <td>{fmtTime(t.started_at)}</td>
                  <td>{fmtTime(t.completed_at)}</td>
                  <td><div className="qm-actions">{actionsFor(t)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
