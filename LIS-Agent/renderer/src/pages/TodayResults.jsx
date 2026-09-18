import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Clock, WifiOff, RotateCw, ListChecks } from 'lucide-react';

// Every result captured today, whatever happened to it afterwards — pushed,
// still pending, or failed. This reads local_results (db/sqlite.js) via
// IPC, the same durable queue serialManager.js/tcpManager.js write to
// BEFORE attempting any network call (see main/resultQueue.js), so a run
// shows up here even if it was captured with no internet at all.
const STATUS_META = {
  pushed:  { label: 'Pushed to server', Icon: CheckCircle2, cls: 'badge-success' },
  pending: { label: 'Not pushed yet',   Icon: Clock,        cls: 'badge-warning' },
  failed:  { label: 'Push failed',      Icon: XCircle,      cls: 'badge-danger' },
};

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts.includes('Z') || ts.includes('+') ? ts : ts + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function TodayResults() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(null);
  const [retryingId, setRetryingId] = useState(null);
  const [retryingAll, setRetryingAll] = useState(false);

  const fetchRows = useCallback(async () => {
    try {
      const data = await window.electronAPI.getTodayResults();
      setRows(data || []);
    } catch (err) {
      console.error('Failed to load today\'s results:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRows();
    window.electronAPI.getNetworkStatus().then((s) => setOnline(s?.online ?? null));

    const offUpdated = window.electronAPI.onLocalResultsUpdated?.(fetchRows);
    const offNetwork = window.electronAPI.onNetworkStatus?.((s) => setOnline(s.online));
    const interval = setInterval(fetchRows, 20000);
    return () => { offUpdated?.(); offNetwork?.(); clearInterval(interval); };
  }, [fetchRows]);

  const retryOne = async (id) => {
    setRetryingId(id);
    try { await window.electronAPI.retryResult(id); } finally { setRetryingId(null); }
  };

  const retryAll = async () => {
    setRetryingAll(true);
    try { await window.electronAPI.retryAllResults(); } finally { setRetryingAll(false); }
  };

  const failedOrPendingCount = rows.filter((r) => r.push_status !== 'pushed' && !(r.kind === 'unmapped' && !r.sample_id)).length;

  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Today's Test Results</h1>
          <p className="page-subtitle">Every result captured today, and whether it reached the server yet.</p>
        </div>
        <div className="page-actions" style={{ alignItems: 'center', gap: 12 }}>
          {online === false && (
            <span className="badge badge-danger" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <WifiOff size={13} /> No internet connection
            </span>
          )}
          {online === true && (
            <span className="badge badge-success">Online</span>
          )}
          {failedOrPendingCount > 0 && (
            <button onClick={retryAll} className="btn btn-primary" disabled={retryingAll}>
              <RotateCw size={14} className={retryingAll ? 'spin' : ''} />
              {retryingAll ? 'Retrying…' : `Retry All (${failedOrPendingCount})`}
            </button>
          )}
          <button onClick={fetchRows} className="btn btn-secondary"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Sample / Test</th>
                <th>Machine</th>
                <th>Captured At</th>
                <th>Status</th>
                <th>Pushed At</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan="6"><div className="loading-row"><div className="spinner" /> Loading...</div></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan="6">
                  <div className="empty-state">
                    <div className="empty-state-icon"><ListChecks size={26} /></div>
                    <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>No results captured yet today</div>
                  </div>
                </td></tr>
              ) : (
                rows.map((r) => {
                  const isUnmapped = r.kind === 'unmapped' && !r.sample_id;
                  const meta = isUnmapped ? null : STATUS_META[r.push_status] || STATUS_META.pending;
                  return (
                    <tr key={r.id}>
                      <td>
                        <div style={{ fontWeight: 800, color: 'var(--brand-blue)', fontSize: 14 }}>{r.sample_id || 'UNMAPPED'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.test_name || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.results?.length || 0} parameter{r.results?.length === 1 ? '' : 's'}</div>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.machine_name || r.machine_no || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmtTime(r.created_at)}</td>
                      <td>
                        {isUnmapped ? (
                          <span className="badge badge-warning">Needs mapping</span>
                        ) : (
                          <span className={`badge ${meta.cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <meta.Icon size={12} /> {meta.label}
                          </span>
                        )}
                        {r.last_error && r.push_status === 'failed' && (
                          <div style={{ fontSize: 10, color: 'var(--color-danger, #b91c1c)', marginTop: 4, maxWidth: 220 }}>{r.last_error}</div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.pushed_at ? fmtTime(r.pushed_at) : '—'}</td>
                      <td>
                        {!isUnmapped && r.push_status !== 'pushed' && (
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '5px 10px', fontSize: 12 }}
                            onClick={() => retryOne(r.id)}
                            disabled={retryingId === r.id}
                          >
                            <RotateCw size={12} className={retryingId === r.id ? 'spin' : ''} /> Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
