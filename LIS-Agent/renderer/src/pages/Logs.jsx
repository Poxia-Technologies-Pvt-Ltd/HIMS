import { useState, useEffect } from 'react';
import axios from 'axios';
import { Search, RefreshCw, ScrollText } from 'lucide-react';
import { API_BASE } from '../apiBase';

function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/lab/activity-logs`, {
        params: { search, limit: 100 }
      });
      if (res.data.success) {
        setLogs(res.data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch activity logs', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 60000);
    return () => clearInterval(interval);
  }, [search]);

  const statusBadgeClass = (status) => {
    switch (status) {
      case 'Test Done': return 'badge-success';
      case 'Verified': return 'badge-info';
      case 'Approved': return 'badge-success';
      default: return 'badge-neutral';
    }
  };

  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Activity Logs</h1>
          <p className="page-subtitle">Complete Audit Trail of Captured Results</p>
        </div>
        <div className="page-actions">
          <div className="worklist-search-box" style={{ width: 300 }}>
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Search sample, patient or test..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <button onClick={fetchLogs} className="btn btn-secondary"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Sample &amp; Patient</th>
              <th>Billed</th>
              <th>Acknowledged</th>
              <th>Run (Result)</th>
              <th>Verified</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && logs.length === 0 ? (
              <tr><td colSpan="6"><div className="loading-row"><div className="spinner" /> Loading...</div></td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan="6">
                <div className="empty-state">
                  <div className="empty-state-icon"><ScrollText size={26} /></div>
                  <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>No logs found</div>
                </div>
              </td></tr>
            ) : (
              logs.map((log) => (
                <tr key={log.bill_item_id}>
                  <td>
                    <div style={{ fontWeight: 800, color: 'var(--brand-blue)', fontSize: 14 }}>{log.sample_id || 'NO SAMPLE ID'}</div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{log.patient_first_name} {log.patient_last_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Test: {log.test_name}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{new Date(log.billed_at).toLocaleDateString()}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(log.billed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 4 }}>By: {log.billed_by_name || 'System'}</div>
                  </td>
                  <td>
                    {log.current_status !== 'Pending' ? (
                      <>
                        <div style={{ fontWeight: 600, color: 'var(--color-success)' }}>{new Date(log.status_updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>By: {log.acknowledged_by_name || '-'}</div>
                      </>
                    ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                  </td>
                  <td>
                    {log.tested_at ? (
                      <>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{new Date(log.tested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>By: {log.technician_name || 'System'}</div>
                      </>
                    ) : <span style={{ color: 'var(--text-muted)' }}>Pending</span>}
                  </td>
                  <td>
                    {log.verified_at && (log.current_status === 'Verified' || log.current_status === 'Completed') ? (
                      <>
                        <div style={{ fontWeight: 700, color: '#1e40af' }}>{new Date(log.verified_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Dr: {log.verifier_name}</div>
                      </>
                    ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                  </td>
                  <td>
                    <span className={`badge ${statusBadgeClass(log.current_status)}`}>{log.current_status.toUpperCase()}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

export default Logs;
