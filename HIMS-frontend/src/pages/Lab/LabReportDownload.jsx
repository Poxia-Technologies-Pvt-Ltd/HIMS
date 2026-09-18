import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  Search, 
  RotateCcw, 
  FileText, 
  Library, 
  Eye, 
  Download, 
  Printer, 
  X,
  MessageCircle,
  Send,
  Phone
} from 'lucide-react';
import '../../assets/CSS/LabReportDownload.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

const LabReportDownload = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [selectedReport, setSelectedReport] = useState(null);
  const [reportDetails, setReportDetails] = useState(null);
  const printRef = useRef(null);

  // WhatsApp share state
  const [waModal, setWaModal] = useState(null);
  const [waSending, setWaSending] = useState(false);
  const [waStatus, setWaStatus] = useState(null); // 'success' | 'error' | null
  const [waMessage, setWaMessage] = useState('');

  useEffect(() => {
    fetchApprovedReports();
  }, []);

  const fetchApprovedReports = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/lab/approved-reports`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) setReports(data.reports || []);
    } catch (error) {
      console.error('Error fetching reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    try {
      setLoading(true);
      let url = `${API_BASE}/api/lab/approved-reports`;
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (dateRange.from) params.append('from', dateRange.from);
      if (dateRange.to) params.append('to', dateRange.to);
      if (params.toString()) url += `?${params.toString()}`;
      const res = await fetch(url, { headers: authHdr() });
      const data = await res.json();
      if (data.success) setReports(data.reports || []);
    } catch (error) {
      console.error('Error searching reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewReport = async (report) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab/report-details/${report.sample_id}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        setReportDetails(data);
        setSelectedReport(report);
      }
    } catch (error) {
      console.error('Error fetching report details:', error);
    }
  };

  const handlePrint = () => {
    if (printRef.current) {
      const printWindow = window.open('', '_blank');
      printWindow.document.write(`
        <html>
          <head>
            <title>Lab Report - ${reportDetails?.sample_id}</title>
            <style>
              body { font-family: 'IBM Plex Sans', sans-serif; margin: 0; padding: 0; }
              .report-preview { padding: 40px; }
              .report-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0f172a; padding-bottom: 20px; margin-bottom: 30px; }
              .hospital-name { font-size: 24px; font-weight: 800; color: #0f172a; font-family: 'Outfit', sans-serif; }
              .hospital-address { font-size: 13px; color: #64748b; margin-top: 5px; line-height: 1.5; }
              .report-meta-box { text-align: right; }
              .report-title { font-size: 14px; font-weight: 700; color: #2563eb; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; }
              .report-id-badge { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #64748b; background: #f1f5f9; padding: 4px 10px; border-radius: 6px; }
              .section { margin-bottom: 24px; }
              .section-title { font-family: 'IBM Plex Mono', monospace; font-size: 10px; font-weight: 700; color: #1d4ed8; background: #eff6ff; padding: 8px 12px; margin-bottom: 15px; border-left: 4px solid #3b82f6; text-transform: uppercase; letter-spacing: 0.1em; }
              .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px; }
              .info-row { display: flex; flex-direction: column; gap: 4px; }
              .info-label { font-family: 'IBM Plex Mono', monospace; font-size: 9px; font-weight: 600; color: #94a3b8; text-transform: uppercase; }
              .info-value { font-size: 13px; color: #0f172a; font-weight: 600; }
              table { width: 100%; border-collapse: collapse; margin-top: 10px; }
              th { background: #0f172a; color: rgba(255,255,255,0.7); padding: 10px; text-align: left; font-size: 10px; text-transform: uppercase; font-family: 'IBM Plex Mono', monospace; }
              td { padding: 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
              .result-value { font-family: 'IBM Plex Mono', monospace; font-weight: 700; font-size: 14px; }
              .normal { color: #166534; }
              .low, .l { color: #0000FF; font-weight: bold; }
              .high, .h { color: #FF0000; font-weight: bold; }
              .critical, .c { color: #7c3aed; font-weight: bold; }
              .flag-badge.normal, .flag-badge.n { background: #f0fdf4; color: #166534; border: 1px solid #86efac; }
              .flag-badge.low, .flag-badge.l { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
              .flag-badge.high, .flag-badge.h { background: #fff1f2; color: #991b1b; border: 1px solid #fda4af; }
              .footer { margin-top: 40px; border-top: 2px solid #e2e8f0; padding-top: 20px; }
              .audit-row { display: flex; gap: 40px; margin-bottom: 20px; }
              .signature-section { display: flex; justify-content: space-between; margin-top: 60px; }
              .signature-box { text-align: center; }
              .signature-line { border-top: 1px solid #94a3b8; width: 200px; margin-top: 40px; padding-top: 8px; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; }
              .report-footer-note { text-align: center; margin-top: 30px; font-size: 11px; color: #94a3b8; font-family: 'IBM Plex Mono', monospace; border-top: 1px dashed #e2e8f0; padding-top: 15px; }
              @media print { body { margin: 0; } .no-print { display: none; } }
            </style>
          </head>
          <body>
            <div class="report-preview">${printRef.current.innerHTML}</div>
          </body>
        </html>
      `);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); }, 500);
    }
  };

  const handleDownloadPDF = async (sampleId) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab/generate-report-pdf/${sampleId}`, { headers: authHdr() });
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lab-report-${sampleId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading PDF:', error);
      alert('Failed to download PDF. Please try again.');
    }
  };

  const handlePrintRealPDF = async (sampleId) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab/generate-report-pdf/${sampleId}`, { headers: authHdr() });
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = url;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        setTimeout(() => {
          iframe.contentWindow.print();
          setTimeout(() => {
            document.body.removeChild(iframe);
            window.URL.revokeObjectURL(url);
          }, 1000);
        }, 100);
      };
    } catch (error) {
      console.error('Error printing PDF:', error);
      alert('Failed to print PDF. Please try again.');
    }
  };

  // ── WhatsApp Share ─────────────────────────────────────────
  const openWhatsAppModal = (report) => {
    setWaModal({
      sampleId: report.sample_id,
      patientName: report.patient_name,
      testName: report.test_name,
      phone: report.patient_phone || report.telephone || ''
    });
    setWaStatus(null);
    setWaMessage('');
  };

  const handleSendWhatsApp = async () => {
    if (!waModal.phone) {
      setWaStatus('error');
      setWaMessage('Patient phone number not available in database.');
      return;
    }

    setWaSending(true);
    setWaStatus(null);
    setWaMessage('');

    try {
      // Normalize phone
      let phone = waModal.phone.replace(/[\s\-\+]/g, '');
      if (phone.length === 10) phone = '91' + phone;

      // Call backend — backend handles PDF fetch + WhatsApp send internally
      const sendRes = await fetch(`${API_BASE}/api/lab/whatsapp-send-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          sampleId: waModal.sampleId,
          phone,
          patientName: waModal.patientName,
          testName: waModal.testName
        })
      });

      const data = await sendRes.json();
      if (!sendRes.ok) throw new Error(data.message || 'Failed to send');

      setWaStatus('success');
      setWaMessage(`Report sent to ${waModal.phone} on WhatsApp successfully!`);
    } catch (err) {
      console.error('WhatsApp send error:', err);
      setWaStatus('error');
      setWaMessage(err.message || 'Failed to send. Is the WhatsApp bot running?');
    } finally {
      setWaSending(false);
    }
  };

  // ──────────────────────────────────────────────────────────

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  };

  const getFlagClass = (result) => {
    let flag = (result.result_flag || 'normal').toLowerCase();
    if ((flag === 'normal' || flag === 'n' || !flag) && result.reference_range && result.result_value !== undefined) {
      const val = parseFloat(result.result_value);
      const range = result.reference_range;
      if (!isNaN(val)) {
        const rangeMatch = range.match(/([0-9.]+)\s*-\s*([0-9.]+)/);
        if (rangeMatch) {
          const min = parseFloat(rangeMatch[1]);
          const max = parseFloat(rangeMatch[2]);
          if (val < min) flag = 'low';
          else if (val > max) flag = 'high';
        } else if (range.startsWith('<')) {
          const max = parseFloat(range.replace('<', '').trim());
          if (!isNaN(max) && val >= max) flag = 'high';
        } else if (range.startsWith('>')) {
          const min = parseFloat(range.replace('>', '').trim());
          if (!isNaN(min) && val <= min) flag = 'low';
        }
      }
    }
    return flag;
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const handleExportCSV = () => {
    if (reports.length === 0) return;
    const headers = ['Sample ID', 'Patient Name', 'Test Name', 'Tested Date', 'Approved Date'];
    const csvRows = [headers.join(',')];
    reports.forEach(report => {
      csvRows.push([
        report.sample_id,
        `"${report.patient_name}"`,
        `"${report.test_name}"`,
        formatDate(report.tested_at),
        formatDate(report.verified_at)
      ].join(','));
    });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lab_reports_list_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const handleDownloadAllPDFs = async () => {
    if (reports.length === 0) return;
    if (!window.confirm(`Are you sure you want to download ${reports.length} reports as PDF?`)) return;
    for (const report of reports) {
      await handleDownloadPDF(report.sample_id);
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  };

  return (
    <div className="lab-report-download-page">
      <div className="report-header-section">
        <div>
          <h1>Lab Test Report Download</h1>
          <p className="subtitle">Download approved lab test reports for clinical verification</p>
        </div>
      </div>

      <div className="search-section">
        <div className="search-filters">
          <div className="filter-group">
            <label>Search Reports</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Sample ID, Patient, Test, UHID, ABHA, phone or CARE ID..."
              className="search-input"
            />
          </div>
          <div className="filter-group">
            <label>From Date</label>
            <input type="date" value={dateRange.from} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })} />
          </div>
          <div className="filter-group">
            <label>To Date</label>
            <input type="date" value={dateRange.to} onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })} />
          </div>
          <button className="search-btn" onClick={handleSearch} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Search size={16} /> Search
          </button>
          <button className="reset-btn" onClick={() => { setSearchQuery(''); setDateRange({ from: '', to: '' }); fetchApprovedReports(); }} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RotateCcw size={16} /> Reset
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">Initializing clinical reports...</div>
      ) : (
        <div className="reports-table-container">
          <div className="table-toolbar">
            <div className="table-toolbar-title">
              Approved Laboratory Reports
              <span className="table-result-count">{reports.length} Records Found</span>
            </div>
            <div className="table-toolbar-actions">
              <button className="toolbar-export-btn" onClick={handleExportCSV} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={16} /> Export List (CSV)
              </button>
              <button className="toolbar-download-all-btn" onClick={handleDownloadAllPDFs} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Library size={16} /> Download All (PDF)
              </button>
            </div>
          </div>
          <table className="reports-table">
            <thead>
              <tr>
                <th>Sample ID</th>
                <th>Patient Name</th>
                <th>Test Name</th>
                <th>Tested Date</th>
                <th>Approved Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan="6" className="no-data">No approved reports found in the selected criteria</td>
                </tr>
              ) : (
                reports.map((report) => (
                  <tr key={report.id}>
                    <td><span className="sample-id">{report.sample_id}</span></td>
                    <td className="patient-name-cell">{report.patient_name}</td>
                    <td>{report.test_name}</td>
                    <td className="date-cell">{formatDate(report.tested_at)}</td>
                    <td className="date-cell">{formatDate(report.verified_at)}</td>
                    <td style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button className="view-btn" onClick={() => handleViewReport(report)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Eye size={14} /> View
                      </button>
                      <button className="view-btn" onClick={() => handleDownloadPDF(report.sample_id)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#3b82f6', color: 'white', border: 'none' }}>
                        <Download size={14} /> Download
                      </button>
                      <button className="view-btn" onClick={() => handlePrintRealPDF(report.sample_id)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#10b981', color: 'white', border: 'none' }}>
                        <Printer size={14} /> Print
                      </button>
                      <button className="view-btn" onClick={() => openWhatsAppModal(report)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#25d366', color: 'white', border: 'none' }}>
                        <MessageCircle size={14} /> WhatsApp
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── WhatsApp Share Modal ──────────────────────────────── */}
      {waModal && createPortal(
        <div className="modal-overlay" onClick={() => { setWaModal(null); setWaStatus(null); }}>
          <div className="report-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header" style={{ background: '#075e54' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageCircle size={18} /> Share Report on WhatsApp
              </h2>
              <div className="modal-actions">
                <button className="close-modal-btn" onClick={() => { setWaModal(null); setWaStatus(null); }}>
                  <X size={18} />
                </button>
              </div>
            </div>

            <div style={{ padding: '28px 28px 24px' }}>
              {/* Report summary */}
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '10px', padding: '14px 16px', marginBottom: '22px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Report Summary</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '9px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Sample ID</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>{waModal.sampleId}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '9px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Patient</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{waModal.patientName}</div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: '9px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Test</div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{waModal.testName}</div>
                  </div>
                </div>
              </div>

              {/* Status feedback */}
              {waStatus === 'success' && (
                <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>✅</span>
                  <span style={{ fontSize: '13px', color: '#166534', fontWeight: 600 }}>{waMessage}</span>
                </div>
              )}
              {waStatus === 'error' && (
                <div style={{ background: '#fff1f2', border: '1.5px solid #fda4af', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>❌</span>
                  <span style={{ fontSize: '13px', color: '#881337', fontWeight: 600 }}>{waMessage}</span>
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { setWaModal(null); setWaStatus(null); }}
                  style={{ padding: '10px 20px', borderRadius: '9999px', border: '1.5px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendWhatsApp}
                  disabled={waSending}
                  style={{
                    padding: '10px 24px', borderRadius: '9999px', border: 'none',
                    background: waSending ? '#a7f3d0' : '#25d366',
                    color: 'white', fontWeight: 700, fontSize: '13px',
                    cursor: waSending ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '8px',
                    boxShadow: '0 4px 14px rgba(37,211,102,0.3)',
                    transition: 'all 0.2s'
                  }}
                >
                  {waSending ? (
                    <>
                      <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                      Sending...
                    </>
                  ) : (
                    <><Send size={14} /> Send via WhatsApp</>
                  )}
                </button>
              </div>
            </div>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>,
        document.body
      )}

      {/* ── Report Preview Modal ──────────────────────────────── */}
      {selectedReport && reportDetails && createPortal(
        <div className="modal-overlay" onClick={() => setSelectedReport(null)}>
          <div className="report-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Lab Test Report Document</h2>
              <div className="modal-actions">
                <button className="download-btn" onClick={() => handleDownloadPDF(reportDetails?.sample_id)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Download size={16} /> Download PDF
                </button>
                <button
                  onClick={() => { setSelectedReport(null); openWhatsAppModal(selectedReport); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', background: '#25d366', color: 'white', border: 'none', borderRadius: '9999px', fontFamily: 'Roboto, sans-serif', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
                >
                  <MessageCircle size={14} /> WhatsApp
                </button>
                <button className="print-btn" onClick={handlePrint} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Printer size={16} /> Print
                </button>
                <button className="close-modal-btn" onClick={() => setSelectedReport(null)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="report-preview" ref={printRef}>
              <div className="report-header">
                <div className="hospital-logo-placeholder">LIS</div>
                <div className="hospital-info">
                  <div className="hospital-name">Meril HIMS Hospital</div>
                  <div className="hospital-address">
                    123 Healthcare Avenue, Medical District<br />
                    Phone: +91-1234567890 | Email: lab@merilhims.com
                  </div>
                </div>
                <div className="report-meta-box">
                  <div className="report-title">Laboratory Test Report</div>
                  <div className="report-id-badge">ID: {reportDetails.sample_id}</div>
                </div>
              </div>

              <div className="section">
                <div className="section-title">Patient Demographics</div>
                <div className="info-grid">
                  <div className="info-row">
                    <span className="info-label">Patient Name</span>
                    <span className="info-value">{reportDetails.patient_name}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">CRN No</span>
                    <span className="info-value">{reportDetails.patient_reg_no}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Sample ID</span>
                    <span className="info-value">{reportDetails.sample_id}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Test Name</span>
                    <span className="info-value">{reportDetails.test_name}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Collection Date</span>
                    <span className="info-value">{formatDate(reportDetails.tested_at)}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Machine ID</span>
                    <span className="info-value">{reportDetails.machine_no || 'LIS-AUTO-01'}</span>
                  </div>
                </div>
              </div>

              <div className="section">
                <div className="section-title">Clinical Findings</div>
                <table className="results-table">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Result</th>
                      <th>Unit</th>
                      <th>Reference Range</th>
                      <th>Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportDetails.results?.map((result, idx) => {
                      const flagClass = getFlagClass(result);
                      return (
                        <tr key={idx}>
                          <td style={{ fontWeight: 500 }}>{result.parameter_name}</td>
                          <td className={`result-value ${flagClass}`}>{result.result_value}</td>
                          <td style={{ fontFamily: 'IBM Plex Mono' }}>{result.unit}</td>
                          <td style={{ color: '#64748b', fontSize: '12px' }}>{result.reference_range}</td>
                          <td>
                            <span className={`flag-badge ${flagClass}`}>{flagClass.toUpperCase()}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {reportDetails.notes && (
                <div className="section">
                  <div className="section-title">Clinical Notes</div>
                  <p className="notes-text">{reportDetails.notes}</p>
                </div>
              )}

              <div className="footer">
                <div className="audit-row">
                  <div className="audit-item">
                    <span className="info-label">Tested By:</span>
                    <span className="info-value" style={{ fontSize: '12px' }}>
                      {reportDetails.tested_by_name}{' '}
                      <span style={{ color: '#94a3b8', fontWeight: 400 }}>({formatDateTime(reportDetails.tested_at)})</span>
                    </span>
                  </div>
                  <div className="audit-item">
                    <span className="info-label verified-by">Verified & Approved By:</span>
                    <span className="info-value approved-by" style={{ fontSize: '12px' }}>
                      {reportDetails.verified_by_name}{' '}
                      <span style={{ color: '#94a3b8', fontWeight: 400 }}>({formatDateTime(reportDetails.verified_at)})</span>
                    </span>
                  </div>
                </div>
                <div className="signature-section">
                  <div className="signature-box"><div className="signature-line">Lab Technician</div></div>
                  <div className="signature-box"><div className="signature-line">Pathologist / Lab Head</div></div>
                </div>
                <div className="report-footer-note">
                  <p>This is a computer-generated report verified digitally in the HIMS LIS system.</p>
                  <p>*** END OF REPORT ***</p>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default LabReportDownload;