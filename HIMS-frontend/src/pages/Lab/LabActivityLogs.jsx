import { useState, useEffect } from 'react';
import axios from 'axios';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/InventoryVendors.css'; // Reusing glassmorphic CSS

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');

function LabActivityLogs() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/lab/activity-logs`, {
        params: { search },
        headers: { Authorization: `Bearer ${tok()}` }
      });
      if (res.data.success) {
        setLogs(res.data.logs || []);
      }
    } catch (err) {
      showAlert('error', 'Failed to fetch activity logs');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, [search]);

  const handleExportCSV = () => {
    if (!logs.length) {
      showAlert('error', 'No logs to export');
      return;
    }
    const headers = ['Timestamp', 'Sample ID', 'Patient', 'Test Name', 'Machine', 'Status', 'Technician', 'Verified By'];
    const csvRows = [headers.join(',')];

    logs.forEach(log => {
      csvRows.push([
        new Date(log.updated_at).toLocaleString(),
        log.sample_id,
        `"${log.patient_first_name} ${log.patient_last_name}"`,
        `"${log.test_name}"`,
        log.machine_no || 'Manual',
        log.status,
        `"${log.technician_first_name || 'N/A'} ${log.technician_last_name || ''}"`,
        `"${log.verifier_first_name || 'N/A'} ${log.verifier_last_name || ''}"`
      ].join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Lab_Activity_Logs_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    showAlert('success', 'Logs exported to CSV');
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'Test Done': return { bg: '#ecfdf5', color: '#059669' };
      case 'Verified': return { bg: '#eff6ff', color: '#1e40af' };
      case 'Approved': return { bg: '#f0fdf4', color: '#166534' };
      default: return { bg: '#f1f5f9', color: '#475569' };
    }
  };

  return (
    <div className="inv-vendor-page">
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      <div className="inv-header">
        <div>
          <h1 className="inv-title">Laboratory Activity Logs</h1>
          <p className="inv-subtitle">Detailed audit trail of all diagnostic results and verifications</p>
        </div>
        <button
          className="btn-primary"
          onClick={handleExportCSV}
          style={{ background: '#10b981', borderColor: '#10b981' }}
        >
          📥 Export CSV
        </button>
      </div>

      <div className="inv-card">
        <div className="inv-toolbar" style={{ justifyContent: 'flex-end', gap: '10px' }}>
          <div style={{ display: 'flex', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '4px 12px', alignItems: 'center', width: '300px' }}>
            <span style={{ fontSize: '14px', color: '#64748b', marginRight: '8px' }}>🔍</span>
            <input
              type="text"
              placeholder="Search sample, patient or test..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ border: 'none', outline: 'none', fontSize: '14px', padding: '8px 0', width: '100%' }}
            />
          </div>
          <button className="btn-primary" onClick={fetchLogs} style={{ background: '#fff', color: '#475569', border: '1px solid #e2e8f0' }}>Refresh</button>
        </div>

        <table className="inv-table">
          <thead>
            <tr>
              <th>Sample ID & Patient</th>
              <th>Test Details</th>
              <th>Billed At</th>
              <th>Acknowledged</th>
              <th>Run (Result)</th>
              <th>Verified</th>
              <th>Approved</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="10" style={{ textAlign: 'center', padding: '40px' }}>Loading activity logs...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan="10" style={{ textAlign: 'center', padding: '40px' }}>No logs found.</td></tr>
            ) : (
              logs.map(log => (
                <tr key={log.bill_item_id}>
                  <td>
                    <strong style={{ color: '#2563eb', display: 'block' }}>{log.sample_id || 'NO SAMPLE ID'}</strong>
                    <div style={{ fontWeight: 600 }}>{log.patient_first_name} {log.patient_last_name}</div>
                  </td>
                  <td>
                    <strong>{log.test_name}</strong>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>Src: {log.machine_no || 'MANUAL'}</div>
                  </td>
                  <td>
                    <div style={{ fontSize: '12px' }}>{new Date(log.billed_at).toLocaleDateString()}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{new Date(log.billed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#475569', marginTop: '2px' }}>{log.billed_by_name || 'System'}</div>
                  </td>
                  <td>
                    {log.current_status !== 'Pending' ? (
                      <>
                        <div style={{ fontSize: '12px' }}>{new Date(log.status_updated_at).toLocaleDateString()}</div>
                        <div style={{ fontSize: '11px', color: '#059669' }}>{new Date(log.status_updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#059669', marginTop: '2px' }}>{log.acknowledged_by_name || '-'}</div>
                      </>
                    ) : <span style={{ color: '#94a3b8' }}>-</span>}
                  </td>
                  <td>
                    {log.tested_at ? (
                      <>
                        <div style={{ fontSize: '12px', fontWeight: '600' }}>{new Date(log.tested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        <div style={{ fontSize: '10px', color: '#64748b' }}>By: {log.technician_name || 'System'}</div>
                      </>
                    ) : <span style={{ color: '#94a3b8' }}>-</span>}
                  </td>
                  <td>
                    {log.verified_at && (log.current_status === 'Verified' || log.current_status === 'Completed') ? (
                      <>
                        <div style={{ fontSize: '12px', fontWeight: '600' }}>{new Date(log.verified_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        <div style={{ fontSize: '10px', color: '#1e40af' }}>Dr: {log.verifier_name}</div>
                      </>
                    ) : <span style={{ color: '#94a3b8' }}>-</span>}
                  </td>
                  <td>
                    {log.current_status === 'Completed' ? (
                      <>
                        <div style={{ fontSize: '12px', fontWeight: '600', color: '#059669' }}>{new Date(log.status_updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        <div style={{ fontSize: '10px', color: '#059669' }}>By: {log.approver_name || log.verifier_name}</div>
                      </>
                    ) : <span style={{ color: '#94a3b8' }}>-</span>}
                  </td>
                  <td>
                    <span style={{
                      padding: '6px 10px', borderRadius: '8px', fontSize: '10px', fontWeight: '800',
                      background: getStatusStyle(log.current_status).bg, color: getStatusStyle(log.current_status).color
                    }}>
                      {log.current_status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default LabActivityLogs;
