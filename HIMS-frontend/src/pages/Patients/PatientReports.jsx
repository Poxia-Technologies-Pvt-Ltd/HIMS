import { useState, useEffect } from 'react';
import '../../assets/CSS/LabWorklist.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

function PatientReports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedReport, setSelectedReport] = useState(null);
  const [reportDetails, setReportDetails] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    const patientData = localStorage.getItem('patient_data');
    if (patientData) {
      const parsed = JSON.parse(patientData);
      fetchReports(parsed.phone);
    }
  }, []);

  const fetchReports = async (phone) => {
    try {
      setLoading(true);
      setDownloadingId(null);
      const token = localStorage.getItem('patient_token');
      const response = await fetch(`${API_BASE}/api/patients/portal/reports/${phone}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      if (data.success) {
        setReports(data.reports || []);
      } else {
        setError('Failed to load reports');
      }
    } catch {
      setError('Error loading reports');
    } finally {
      setLoading(false);
    }
  };

  const viewReport = async (sampleId) => {
    const patientData = localStorage.getItem('patient_data');
    if (!patientData) return;

    const parsed = JSON.parse(patientData);
    try {
      setDownloadingId(sampleId);
      const token = localStorage.getItem('patient_token');
      const response = await fetch(`${API_BASE}/api/patients/portal/reports/${parsed.phone}/${sampleId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      if (data.success) {
        setReportDetails(data.report);
        setSelectedReport(sampleId);
      }
    } catch {
      setError('Error loading report details');
    } finally {
      setDownloadingId(null);
    }
  };

  const downloadPDF = async (sampleId) => {
    const patientData = localStorage.getItem('patient_data');
    if (!patientData) return;

    const parsed = JSON.parse(patientData);
    try {
      setDownloadingId(sampleId);
      const token = localStorage.getItem('patient_token');
      const response = await fetch(`${API_BASE}/api/patients/portal/reports/${parsed.phone}/${sampleId}/pdf`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lab-report-${sampleId}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        const data = await response.json();
        setError(data.message || 'Error downloading PDF');
      }
    } catch {
      setError('Error downloading PDF');
    } finally {
      setDownloading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getFlagStatus = (value, min, max) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return null;

    const hasMin = min !== '' && min !== null && min !== undefined;
    const hasMax = max !== '' && max !== null && max !== undefined;

    if (hasMin && numValue < parseFloat(min)) {
      return { label: 'Low', color: '#f59e0b', bg: '#fef3c7' };
    }
    if (hasMax && numValue > parseFloat(max)) {
      return { label: 'High', color: '#ef4444', bg: '#fee2e2' };
    }
    return { label: 'Normal', color: '#22c55e', bg: '#dcfce7' };
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 20px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="40" height="40">
            <circle cx="12" cy="12" r="10" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="31.416">
              <animate attributeName="stroke-dashoffset" from="31.416" to="0" dur="1s" repeatCount="indefinite" />
            </circle>
          </svg>
        </div>
        <p>Loading your reports...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1200px' }}>
      <header style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>
            Lab Reports
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            View and download your approved lab reports
          </p>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
          {reports.length} report{reports.length !== 1 ? 's' : ''} available
        </div>
      </header>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '24px' }}>
          {error}
        </div>
      )}

      {reports.length === 0 ? (
        <div style={{
          background: 'var(--surface)',
          borderRadius: '12px',
          padding: '48px',
          textAlign: 'center',
          border: '1px dashed var(--border)'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
          <h3 style={{ marginBottom: '8px', color: 'var(--text-main)' }}>No Reports Available</h3>
          <p style={{ color: 'var(--text-muted)' }}>
            Your approved lab reports will appear here once they are ready.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {reports.map((report) => (
            <div
              key={report.id}
              style={{
                background: 'var(--surface)',
                borderRadius: '12px',
                padding: '24px',
                border: '1px solid var(--border)',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onClick={() => viewReport(report.sample_id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                    {report.test_name}
                  </h3>
                  <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                    Sample ID: {report.sample_id}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadPDF(report.sample_id);
                    }}
                    disabled={downloadingId === report.sample_id}
                    style={{
                      padding: '6px 12px',
                      background: downloadingId === report.sample_id ? '#94a3b8' : 'var(--brand-blue)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '12px',
                      cursor: downloadingId === report.sample_id ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    title="Download PDF"
                  >
                    {downloadingId === report.sample_id ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="31.416">
                          <animate attributeName="stroke-dashoffset" from="31.416" to="0" dur="1s" repeatCount="indefinite" />
                        </circle>
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                      </svg>
                    )}
                    PDF
                  </button>
                  <span style={{
                    padding: '6px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    background: '#dcfce7',
                    color: '#166534'
                  }}>
                    {report.status}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '24px', fontSize: '14px', color: 'var(--text-muted)' }}>
                <div>
                  <span style={{ display: 'block', fontSize: '12px', marginBottom: '2px' }}>Verified On</span>
                  <strong style={{ color: 'var(--text-main)' }}>{formatDate(report.verified_at)}</strong>
                </div>
                <div>
                  <span style={{ display: 'block', fontSize: '12px', marginBottom: '2px' }}>Verified By</span>
                  <strong style={{ color: 'var(--text-main)' }}>{report.verified_by_name || '-'}</strong>
                </div>
              </div>

              {selectedReport === report.sample_id && !reportDetails && downloadingId === report.sample_id && (
                <div style={{ marginTop: '16px', textAlign: 'center' }}>
                  <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Loading...</span>
                </div>
              )}

              {selectedReport === report.sample_id && reportDetails && (
                <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h4 style={{ fontSize: '16px', fontWeight: 600 }}>Test Results</h4>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadPDF(report.sample_id);
                      }}
                      disabled={downloadingId === report.sample_id}
                      style={{
                        padding: '8px 16px',
                        background: downloadingId === report.sample_id ? '#94a3b8' : 'var(--brand-blue)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        cursor: downloadingId === report.sample_id ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      {downloadingId === report.sample_id ? (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="31.416">
                              <animate attributeName="stroke-dashoffset" from="31.416" to="0" dur="1s" repeatCount="indefinite" />
                            </circle>
                          </svg>
                          Generating...
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                          </svg>
                          Download PDF
                        </>
                      )}
                    </button>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                      <thead>
                        <tr style={{ background: 'var(--sys-bg)' }}>
                          <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>Parameter</th>
                          <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600 }}>Result</th>
                          <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600 }}>Unit</th>
                          <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600 }}>Reference Range</th>
                          <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600 }}>Flag</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportDetails.results?.map((result, idx) => {
                          const flag = getFlagStatus(result.value, result.min_value, result.max_value);
                          return (
                            <tr key={idx} style={{ borderTop: '1px solid var(--border)' }}>
                              <td style={{ padding: '12px' }}>{result.parameter_name}</td>
                              <td style={{ padding: '12px', textAlign: 'center', fontWeight: 600 }}>
                                {result.value}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                {result.unit}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                {result.min_value && result.max_value ? `${result.min_value} - ${result.max_value}` : '-'}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'center' }}>
                                {flag && (
                                  <span style={{
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    background: flag.bg,
                                    color: flag.color
                                  }}>
                                    {flag.label}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {reportDetails.notes && (
                    <div style={{ marginTop: '16px', padding: '12px', background: '#fef3c7', borderRadius: '6px', fontSize: '13px' }}>
                      <strong>Notes:</strong> {reportDetails.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PatientReports;
