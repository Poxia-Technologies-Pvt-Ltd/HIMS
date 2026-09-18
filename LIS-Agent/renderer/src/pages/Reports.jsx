import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Download, Printer, MessageCircle, FileBarChart2, Search, X, RefreshCw } from 'lucide-react';
import { API_BASE } from '../apiBase';

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - i);

const Reports = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const [search, setSearch] = useState('');
  const [year, setYear] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    fetchApproved();
  }, [search, fromDate, toDate]);

  const fetchApproved = async () => {
    setRefreshing(true);
    try {
      const res = await axios.get(`${API_BASE}/api/lab/approved-reports`, {
        params: {
          search: search || undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
        }
      });
      if (res.data.success) {
        setReports(res.data.reports || []);
      }
    } catch (err) {
      console.error("Error fetching reports:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Year is a convenience filter on top of from/to — picking one just sets
  // the date range to that calendar year, so it stays in sync with (and can
  // still be fine-tuned by) the manual From/To pickers below it.
  const handleYearChange = (value) => {
    setYear(value);
    if (value === 'all') {
      setFromDate('');
      setToDate('');
    } else {
      setFromDate(`${value}-01-01`);
      setToDate(`${value}-12-31`);
    }
  };

  const handleFromChange = (value) => {
    setFromDate(value);
    setYear('all');
  };

  const handleToChange = (value) => {
    setToDate(value);
    setYear('all');
  };

  const hasActiveFilters = search || fromDate || toDate;

  const clearFilters = () => {
    setSearch('');
    setYear('all');
    setFromDate('');
    setToDate('');
  };

  const handleDownload = (sampleId) => {
    window.open(`${API_BASE}/api/lab/generate-report-pdf/${sampleId}`, '_blank');
  };

  // Opens the PDF in a new tab and triggers the print dialog, instead of
  // forcing a download — the backend endpoint always sends
  // Content-Disposition: attachment, so we fetch it as a blob ourselves
  // rather than letting the browser navigate straight to it.
  const handlePrint = async (sampleId) => {
    const win = window.open('', '_blank');
    try {
      const res = await axios.get(`${API_BASE}/api/lab/generate-report-pdf/${sampleId}`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      if (win) {
        win.location.href = blobUrl;
        setTimeout(() => { try { win.print(); } catch (e) { /* user can print manually from the viewer */ } }, 800);
      }
    } catch (err) {
      console.error('Print error:', err);
      if (win) win.close();
      alert('Failed to load report for printing');
    }
  };

  const handleWhatsApp = async (report) => {
    if (!window.confirm(`Send this report to ${report.patient_name} on WhatsApp?`)) return;
    setBusyId(report.id);
    try {
      const res = await axios.post(`${API_BASE}/api/lab/resend-report-whatsapp/${report.sample_id}`);
      if (res.data.success) {
        alert('Report sent on WhatsApp successfully!');
      } else {
        alert(res.data.message || 'Failed to send report on WhatsApp');
      }
    } catch (err) {
      console.error('WhatsApp resend error:', err);
      alert(err.response?.data?.message || 'Failed to send report on WhatsApp');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="page loading-row"><div className="spinner" /> Loading reports...</div>;
  }

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Approved Lab Reports</h1>
          <p className="page-subtitle">Download, print, or resend finalized laboratory reports on WhatsApp</p>
        </div>
      </div>

      <div className="card flex-between worklist-toolbar">
        <div className="flex-row gap-12" style={{ flexWrap: 'wrap' }}>
          <div className="worklist-search-box">
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Search patient, sample ID, or test..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 220 }}
            />
            {search && (
              <button onClick={() => setSearch('')} title="Clear search" className="worklist-clear-btn"><X size={14} /></button>
            )}
          </div>

          <select value={year} onChange={(e) => handleYearChange(e.target.value)} className="control worklist-select">
            <option value="all">All Years</option>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>

          <div className="flex-row gap-8">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => handleFromChange(e.target.value)}
              className="control"
              style={{ width: 155 }}
              title="From date"
            />
            <span className="text-muted" style={{ fontSize: 13 }}>to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => handleToChange(e.target.value)}
              className="control"
              style={{ width: 155 }}
              title="To date"
            />
          </div>

          {hasActiveFilters && (
            <button onClick={clearFilters} className="btn btn-ghost btn-sm" style={{ color: 'var(--brand-blue)' }}>
              Clear filters
            </button>
          )}
        </div>

        <button onClick={fetchApproved} disabled={refreshing} className="btn btn-secondary">
          <RefreshCw size={14} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 24px', fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, borderBottom: '1px solid var(--border-subtle)' }}>
          {reports.length} {reports.length === 1 ? 'report' : 'reports'}
        </div>
        <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Sample ID</th>
              <th>Patient Name</th>
              <th>Test Name</th>
              <th>Verified At</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {reports.length === 0 ? (
              <tr><td colSpan={5}>
                <div className="empty-state">
                  <div className="empty-state-icon"><FileBarChart2 size={26} /></div>
                  <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
                    {hasActiveFilters ? 'No reports match your filters' : 'No approved reports yet'}
                  </div>
                </div>
              </td></tr>
            ) : reports.map(report => (
              <tr key={report.id}>
                <td style={{ fontWeight: 700 }}>{report.sample_id}</td>
                <td style={{ fontWeight: 600 }}>{report.patient_name}</td>
                <td>{report.test_name}</td>
                <td style={{ color: 'var(--text-muted)' }}>{new Date(report.verified_at).toLocaleString()}</td>
                <td>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => handleDownload(report.sample_id)} className="btn btn-primary btn-sm" title="Download PDF">
                      <Download size={13} /> PDF
                    </button>
                    <button onClick={() => handlePrint(report.sample_id)} className="btn btn-secondary btn-sm" title="Print report">
                      <Printer size={13} /> Print
                    </button>
                    <button
                      onClick={() => handleWhatsApp(report)}
                      disabled={busyId === report.id || !report.patient_phone}
                      title={report.patient_phone ? 'Send on WhatsApp' : 'No phone number on file for this patient'}
                      className="btn btn-sm"
                      style={{ background: '#25D366', color: '#fff' }}
                    >
                      <MessageCircle size={13} /> {busyId === report.id ? 'Sending...' : 'WhatsApp'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
};

export default Reports;
