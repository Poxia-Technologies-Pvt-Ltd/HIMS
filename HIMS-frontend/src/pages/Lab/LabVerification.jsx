import { useState, useEffect, useRef } from 'react';
import '../../assets/CSS/LabVerification.css';


// Server-computed flag (Normal / High / Low / Critical High / Critical Low /
// Invalid) with a fallback to the analyzer's own H / L for older results.
const LEGACY_FLAG = { H: 'High', L: 'Low', N: 'Normal', HH: 'Critical High', LL: 'Critical Low' };
const flagOf = (r) => r.result_flag || LEGACY_FLAG[String(r.flag || '').toUpperCase()] || 'Normal';
const flagKey = (f) => String(f).toLowerCase().replace(/\s+/g, '-');

function FlagCell({ result }) {
  const flag = flagOf(result);
  const why = (result.flag_reasons || []).map((x) => x.message).join('\n');
  return (
    <span className="flag-cell" title={why || undefined}>
      <span className={`flag-badge ${flagKey(flag)}`}>{flag}</span>
      {result.delta && (
        <span className="flag-badge delta" title={`Previous ${result.delta.previous_value} — changed ${result.delta.change_percent ?? ''}%`}>
          Delta{result.delta.change_percent != null ? ` ${result.delta.change_percent}%` : ''}
        </span>
      )}
    </span>
  );
}

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

const toLocalDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
};

import SignatureProfile from './SignatureProfile';
import ResultHistory from './ResultHistory';
import CriticalStrip from '../../components/CriticalStrip';
import MaintenanceStrip from '../../components/MaintenanceStrip';

const LabVerification = () => {
  const [tests, setTests]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [selectedTest, setSelectedTest] = useState(null);
  const [approveTest, setApproveTest]   = useState(null);
  const [rerunTest, setRerunTest]       = useState(null);
  const [rerunReason, setRerunReason]   = useState('');
  const [verificationNote, setVerificationNote] = useState('');
  const [approveNote, setApproveNote]   = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery]   = useState('');
  const [dateFilter, setDateFilter]     = useState('');
  const [bulkConfirm, setBulkConfirm]   = useState(null); // 'verify' | 'approve'
  const [showSignature, setShowSignature] = useState(false);
  const [historyFor, setHistoryFor] = useState(null);
  const [reportAction, setReportAction] = useState(null);   // { type: 'cancel' | 'reissue', test }
  const [reportReason, setReportReason] = useState('');
  const [reportPassword, setReportPassword] = useState('');
  const [signPassword, setSignPassword] = useState('');
  // The doctor's own Digital Signature Certificate, if their hospital admin set one up:
  // its password is asked for alongside the login password when signing.
  const [myDsc, setMyDsc] = useState(null);
  const [dscPassword, setDscPassword] = useState('');
  // Ask for a DSC password only when none is remembered; otherwise signing is automatic.
  const needsDsc = !!myDsc?.ask_password;

  // Hospitals that sign with the doctor's own USB token: Sign & Approve hands the report to the
  // Poxia DSC Agent running on this computer, which asks for the PIN there (never here).
  const AGENT_URL = 'http://127.0.0.1:8765';
  const agentCancel = useRef(false);
  const [agentSign, setAgentSign] = useState(null);   // { message, summary } while waiting for the token
  const apiOrigin = () => new URL(API_BASE || window.location.origin, window.location.href).origin;

  const signViaAgent = async ({ test, notes, password }) => {
    agentCancel.current = false;
    setAgentSign({ message: 'Checking the Poxia DSC Agent…' });
    let jobId = null;
    try {
      try {
        const h = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(2500) });
        if (!h.ok) throw new Error('down');
      } catch {
        return { ok: false, message: 'The Poxia DSC Agent is not running on this computer. Start "Poxia DSC Agent", insert your DSC token and try again.' };
      }
      const created = await fetch(`${API_BASE}/api/lab/dsc-agent/jobs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ test_result_id: test.id, sample_id: test.sample_id, notes, password }),
      }).then((r) => r.json());
      if (!created.success) {
        if (created.code === 'SIGNATURE_PROFILE_INCOMPLETE') setShowSignature(true);
        return { ok: false, message: created.message || 'Could not start the signing.' };
      }
      jobId = created.job.id;
      let started;
      try {
        started = await fetch(`${AGENT_URL}/sign`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ server: apiOrigin(), jobId, token: created.job.token }),
        }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));
      } catch { started = { ok: false, body: {} }; }
      if (!started.ok) {
        await fetch(`${API_BASE}/api/lab/dsc-agent/jobs/${jobId}/cancel`, { method: 'POST', headers: authHdr() }).catch(() => {});
        return { ok: false, message: started.body?.error || 'The Poxia DSC Agent did not accept the request.' };
      }
      setAgentSign({ message: 'Open the Poxia DSC Agent window: choose your certificate and type your DSC PIN.', summary: created.job.summary });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        if (agentCancel.current) {
          await fetch(`${AGENT_URL}/cancel`, { method: 'POST' }).catch(() => {});
          await fetch(`${API_BASE}/api/lab/dsc-agent/jobs/${jobId}/cancel`, { method: 'POST', headers: authHdr() }).catch(() => {});
          return { ok: false, cancelled: true, message: 'Signing cancelled. The report has not been approved.' };
        }
        const st = await fetch(`${API_BASE}/api/lab/dsc-agent/jobs/${jobId}`, { headers: authHdr() }).then((r) => r.json()).catch(() => null);
        if (!st?.success) continue;
        if (st.status === 'Completed') return { ok: true };
        if (['Failed', 'Cancelled', 'Expired'].includes(st.status)) return { ok: false, message: st.message || `Signing ${st.status.toLowerCase()}. The report has not been approved.` };
      }
    } finally {
      setAgentSign(null);
    }
  };
  const signReady = !!signPassword && (!needsDsc || !!dscPassword);
  const canSign = ['admin', 'super admin', 'lab head', 'lab doctor', 'lab_doctor'].includes((localStorage.getItem('role') || '').toLowerCase());
  const [bulkProgress, setBulkProgress] = useState(null); // { done, total, type }
  useEffect(() => {
    fetch(`${API_BASE}/api/lab/dsc/mine`, { headers: authHdr() }).then((r) => r.json()).then((d) => d.success && setMyDsc(d)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchPendingVerifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, searchQuery]);

  const fetchPendingVerifications = async () => {
    try {
      setLoading(true);
      setError(null);
      // Search is server-side: identifiers like UHID, ABHA, phone and the CARE
      // patient id are not present in this endpoint's response, so a
      // client-side filter over the returned rows could never match on them.
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      const qs = params.toString();
      const url = `${API_BASE}/api/lab/pending-verifications${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, { headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        setTests(data.tests || []);
      } else {
        setError(data.message || 'Failed to load tests');
      }
    } catch (err) {
      console.error('Error fetching tests:', err);
      setError('Connection error: Could not reach the server.');
    } finally {
      setLoading(false);
    }
  };

  // Client-side filtering by search + date
  const filteredTests = tests.filter(t => {
    // Search is applied server-side (see fetchPendingVerifications) — filtering
    // again here would drop rows matched on an identifier the row doesn't
    // display, e.g. a patient found by ABHA number.
    if (dateFilter) {
      if (toLocalDate(t.tested_at) !== dateFilter) return false;
    }
    return true;
  });

  // What THIS user may do next is decided by the server from the discipline's
  // workflow (technical validation / authorization), their role, and
  // segregation of duties — the buttons just follow it.
  const verifiableTests = filteredTests.filter(t => t.next_step === 'technical' && t.can_act);
  const approvableTests = filteredTests.filter(t => t.next_step === 'clinical' && t.can_act);

  const getDoctorId = () =>
    localStorage.getItem('user_id') ||
    JSON.parse(localStorage.getItem('user') || '{}')?.id ||
    1;

  const handleVerify = async (testId, sampleId) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab/verify-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          test_result_id: testId,
          sample_id: sampleId,
          notes: verificationNote,
          status: 'Verified'
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Test verified successfully!');
        setSelectedTest(null);
        setVerificationNote('');
        fetchPendingVerifications();
      } else {
        alert('Could not validate: ' + (data.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error verifying test:', error);
      alert('Error verifying test');
    }
  };

  const handleApprove = async () => {
    if (!approveTest) return;
    if (myDsc?.agent) {
      const r = await signViaAgent({ test: approveTest, notes: approveNote, password: signPassword });
      if (r.ok) {
        alert('Report digitally signed and approved.');
        setApproveTest(null); setApproveNote(''); setSignPassword('');
        fetchPendingVerifications();
      } else if (!r.cancelled) alert(r.message);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/lab/verify-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          test_result_id: approveTest.id,
          sample_id: approveTest.sample_id,
          status: 'Approved',
          notes: approveNote,
          password: signPassword,
          dsc_password: needsDsc ? dscPassword : undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.data?.dsc_signed ? 'Report digitally signed and approved.' : (data.data?.dsc_warning || 'Report signed and approved.'));
        setApproveTest(null);
        setApproveNote('');
        setSignPassword('');
        setDscPassword('');
        fetchPendingVerifications();
      } else {
        if (data.code === 'SIGNATURE_PROFILE_INCOMPLETE') setShowSignature(true);
        alert(data.message || 'Approval failed');
      }
    } catch (error) {
      console.error('Error approving test:', error);
      alert('Network error while approving. Please try again.');
    }
  };

  // Sends a result back to the lab tech instead of verifying/approving it —
  // shows up as an actionable "Rerun" item on the lab worklist once submitted.
  const handleRequestRerun = async () => {
    if (!rerunTest) return;
    if (!rerunReason.trim()) {
      alert('Please enter a reason for the rerun so the lab tech knows what to check.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/lab/request-rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          test_result_id: rerunTest.id,
          sample_id: rerunTest.sample_id,
          requested_by: getDoctorId(),
          reason: rerunReason.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Rerun requested — sent back to the lab.');
        setRerunTest(null);
        setRerunReason('');
        fetchPendingVerifications();
      } else {
        alert(data.message || 'Failed to request rerun');
      }
    } catch (error) {
      console.error('Error requesting rerun:', error);
      alert('Network error while requesting rerun. Please try again.');
    }
  };

  const handleVerifyAll = async () => {
    setBulkConfirm(null);
    const total = verifiableTests.length;
    setBulkProgress({ done: 0, total, type: 'verify' });
    for (let i = 0; i < verifiableTests.length; i++) {
      const t = verifiableTests[i];
      try {
        await fetch(`${API_BASE}/api/lab/verify-test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHdr() },
          body: JSON.stringify({
            test_result_id: t.id,
            sample_id: t.sample_id,
            status: 'Verified',
            notes: ''
          })
        });
      } catch { /* continue on error */ }
      setBulkProgress({ done: i + 1, total, type: 'verify' });
    }
    setBulkProgress(null);
    fetchPendingVerifications();
  };

  const handleApproveAll = async () => {
    setBulkConfirm(null);
    const total = approvableTests.length;
    setBulkProgress({ done: 0, total, type: 'approve' });
    for (let i = 0; i < approvableTests.length; i++) {
      const t = approvableTests[i];
      if (myDsc?.agent) {
        // One report at a time; the token stays unlocked between them, so the PIN is typed once.
        const out = await signViaAgent({ test: t, notes: '', password: signPassword });
        if (!out.ok) { if (!out.cancelled) alert(`${t.sample_id}: ${out.message}`); break; }
        setBulkProgress({ done: i + 1, total, type: 'approve' });
        continue;
      }
      try {
        const r = await fetch(`${API_BASE}/api/lab/verify-test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHdr() },
          body: JSON.stringify({
            test_result_id: t.id,
            sample_id: t.sample_id,
            status: 'Approved',
            notes: '',
            password: signPassword,
            dsc_password: needsDsc ? dscPassword : undefined
          })
        });
        const out = await r.json();
        if (['PASSWORD_REQUIRED', 'DSC_PASSWORD_REQUIRED', 'DSC_PASSWORD_WRONG', 'DSC_REQUIRED', 'DSC_EXPIRED', 'DSC_LOCKED', 'DSC_SIGNING_FAILED'].includes(out.code)) { alert(out.message); break; }
        if (out.code === 'SIGNATURE_PROFILE_INCOMPLETE') { setShowSignature(true); break; }
      } catch { /* continue on error */ }
      setBulkProgress({ done: i + 1, total, type: 'approve' });
    }
    setBulkProgress(null);
    setSignPassword('');
    setDscPassword('');
    fetchPendingVerifications();
  };

  const submitReportAction = async () => {
    if (!reportAction) return;
    const { type, test } = reportAction;
    try {
      const res = await fetch(`${API_BASE}/api/lab/results/${test.id}/${type}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ reason: reportReason, password: reportPassword }),
      });
      const data = await res.json();
      alert(data.message || (data.success ? 'Done.' : 'Failed.'));
      if (data.success) { setReportAction(null); setReportReason(''); setReportPassword(''); fetchPendingVerifications(); }
    } catch { alert('Network error.'); }
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const getStatusBadge = (status) => {
    const colors = {
      'Test Done':       '#06b6d4',
      'Completed':       '#22c55e',
      'Verified':        '#8b5cf6',
      'Approved':        '#22c55e',
      'Cancelled':       '#ef4444',
      'Rerun Requested': '#f59e0b'
    };
    return (
      <span className="status-badge" style={{ background: colors[status] || '#6b7280' }}>
        {status}
      </span>
    );
  };

  return (
    <div className="lab-verification-page">

      {/* ── Header ── */}
      <div className="verification-header">
        <h1>
          Lab Head Doctor – Test Verification
          {!loading && (
            <span className="total-count-badge">{filteredTests.length}</span>
          )}
        </h1>
        <div>
          {canSign && <button className="sig-btn" onClick={() => setShowSignature(true)}>My Signature</button>}
          <button className="refresh-btn" onClick={fetchPendingVerifications}>↻ Refresh</button>
        </div>
      </div>

      <CriticalStrip />
      <MaintenanceStrip />

      {/* ── Filter Bar ── */}
      <div className="filter-bar">
        <input
          type="text"
          className="filter-search"
          placeholder="Search: name, sample ID, UHID, ABHA, phone, CARE ID…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <div className="filter-group">
          <label>Date</label>
          <input
            type="date"
            className="filter-date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
          />
          {dateFilter && (
            <button className="clear-date-btn" onClick={() => setDateFilter('')}>✕</button>
          )}
        </div>
        <div className="filter-group">
          <label>Status</label>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All Pending</option>
            <option value="Test Done">Test Done</option>
            <option value="Verified">Verified</option>
            <option value="Approved">Approved</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* ── Bulk Actions Bar ── */}
      {!loading && !error && filteredTests.length > 0 && (
        <div className="bulk-actions-bar">
          <span className="bulk-info">
            Showing <strong>{filteredTests.length}</strong> test{filteredTests.length !== 1 ? 's' : ''}
            {verifiableTests.length > 0 && (
              <> · <span className="bulk-count pending">{verifiableTests.length} pending verify</span></>
            )}
            {approvableTests.length > 0 && (
              <> · <span className="bulk-count verified">{approvableTests.length} pending approval</span></>
            )}
          </span>

          <div className="bulk-btns">
            {verifiableTests.length > 0 && !bulkProgress && (
              bulkConfirm === 'verify' ? (
                <span className="bulk-confirm">
                  Verify {verifiableTests.length} tests?
                  <button className="btn-confirm-yes" onClick={handleVerifyAll}>Yes, Verify All</button>
                  <button className="btn-confirm-no" onClick={() => setBulkConfirm(null)}>Cancel</button>
                </span>
              ) : (
                <button className="bulk-verify-btn" onClick={() => setBulkConfirm('verify')}>
                  ✓ Verify All ({verifiableTests.length})
                </button>
              )
            )}

            {approvableTests.length > 0 && !bulkProgress && (
              bulkConfirm === 'approve' ? (
                <span className="bulk-confirm">
                  Sign and approve {approvableTests.length} tests?
                  <input type="password" className="bulk-password" placeholder="Your password" autoComplete="current-password" value={signPassword} onChange={e => setSignPassword(e.target.value)} />
                  {needsDsc && <input type="password" className="bulk-password" placeholder="DSC password" autoComplete="off" value={dscPassword} onChange={e => setDscPassword(e.target.value)} />}
                  <button className="btn-confirm-yes approve" disabled={!signReady} onClick={handleApproveAll}>Yes, Sign All</button>
                  <button className="btn-confirm-no" onClick={() => setBulkConfirm(null)}>Cancel</button>
                </span>
              ) : (
                <button className="bulk-approve-btn" onClick={() => setBulkConfirm('approve')}>
                  ✓ Approve All ({approvableTests.length})
                </button>
              )
            )}

            {bulkProgress && (
              <span className="bulk-progress">
                <span className="progress-spinner" />
                {bulkProgress.type === 'verify' ? 'Verifying' : 'Approving'}&nbsp;
                {bulkProgress.done} of {bulkProgress.total}…
                <span className="progress-bar-wrap">
                  <span
                    className="progress-bar-fill"
                    style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
                  />
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading tests…</div>
      ) : error ? (
        <div className="error-message" style={{ color: 'red', textAlign: 'center', padding: '20px' }}>{error}</div>
      ) : (
        <div className="tests-table-container">
          <table className="tests-table">
            <thead>
              <tr>
                <th>Sample ID</th>
                <th>Patient Name</th>
                <th>Test Name</th>
                <th>Machine No</th>
                <th>Tested At</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTests.length === 0 ? (
                <tr>
                  <td colSpan="7" className="no-data">
                    {searchQuery || dateFilter ? 'No tests match the current filters' : 'No tests pending verification'}
                  </td>
                </tr>
              ) : (
                filteredTests.map((test) => (
                  <tr key={test.id} className={`status-${test.status?.toLowerCase().replace(' ', '-')}`}>
                    <td className="sample-id">{test.sample_id}</td>
                    <td>{test.patient_name}</td>
                    <td>
                      {test.test_name}
                      {test.entry_mode && <div title={test.manual_reason || ''} style={{ fontSize: 11.5, color: '#b45309', fontWeight: 700, marginTop: 2 }}>{test.entry_mode === 'edited' ? 'Changed by hand' : 'Typed by hand'}{test.manual_reason ? ` — ${test.manual_reason}` : ''}</div>}
                    </td>
                    <td>{test.machine_no || 'N/A'}</td>
                    <td>{formatDateTime(test.tested_at)}</td>
                    <td>
                      {getStatusBadge(test.status)}
                      <span className="flag-cell" style={{ marginLeft: 6 }}>
                        {!!test.has_critical && <span className="flag-badge critical-high">Critical</span>}
                        {!!test.has_invalid && <span className="flag-badge invalid">Invalid</span>}
                        {!!test.has_delta && <span className="flag-badge delta">Delta</span>}
                        {!!test.has_abnormal && !test.has_critical && <span className="flag-badge high">Abnormal</span>}
                      </span>
                    </td>
                    <td style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {test.next_step === 'technical' && (
                        <button className="verify-btn" disabled={!test.can_act} title={test.blocked_reason || undefined} onClick={() => setSelectedTest(test)}>
                          ✓ Validate
                        </button>
                      )}
                      {test.next_step === 'clinical' && (
                        <button
                          className="approve-btn"
                          disabled={!test.can_act}
                          title={test.blocked_reason || undefined}
                          onClick={() => { setApproveTest(test); setApproveNote(''); }}
                        >
                          ✓ Authorize
                        </button>
                      )}
                      {test.blocked_reason && test.next_step && !test.can_act && (
                        <span className="wf-blocked">{test.blocked_reason}</span>
                      )}
                      {test.status === 'Approved' && (
                        <span className="approved-text">Approved ✓{test.report_version > 1 ? ` v${test.report_version}` : ''}</span>
                      )}
                      {test.status === 'Approved' && canSign && (
                        <button className="sig-btn" style={{ margin: 0, color: '#b91c1c' }} onClick={() => { setReportAction({ type: 'cancel', test }); setReportReason(''); setReportPassword(''); }}>Cancel report</button>
                      )}
                      {test.status === 'Cancelled' && canSign && (
                        <button className="sig-btn" style={{ margin: 0 }} onClick={() => { setReportAction({ type: 'reissue', test }); setReportReason(''); }}>Reissue</button>
                      )}
                      <button className="sig-btn" style={{ margin: 0 }} onClick={() => setHistoryFor(test.id)}>History</button>
                      {(test.status === 'Test Done' || test.status === 'Completed' || test.status === 'Verified') && (
                        <button
                          className="reject-btn"
                          style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontWeight: 700 }}
                          onClick={() => { setRerunTest(test); setRerunReason(''); }}
                        >
                          ↻ Request Rerun
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Approve Modal ── */}
      {approveTest && (
        <div className="modal-overlay" onClick={() => setApproveTest(null)}>
          <div className="verification-modal" onClick={e => e.stopPropagation()}>
            <h2>Approve Test Results</h2>
            <div className="test-details">
              <p><strong>Sample ID:</strong> {approveTest.sample_id}</p>
              <p><strong>Patient:</strong> {approveTest.patient_name}</p>
              <p><strong>Test:</strong> {approveTest.test_name}</p>
              <p><strong>Machine:</strong> {approveTest.machine_no || 'N/A'}</p>
              <p><strong>Verified At:</strong> {formatDateTime(approveTest.verified_at)}</p>
            </div>
            <div className="results-section">
              <h3>Test Results</h3>
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Parameter</th><th>Result</th><th>Unit</th>
                    <th>Reference Range</th><th>Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {approveTest.results?.map((result, idx) => (
                    <tr key={idx} className={`flag-${flagKey(flagOf(result))}`}>
                      <td>{result.parameter_name}</td>
                      <td className="result-value">{result.result_value}</td>
                      <td>{result.unit}</td>
                      <td>{result.reference_range}</td>
                      <td><FlagCell result={result} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="verification-notes">
              <label>Approval Notes (Optional):</label>
              <textarea
                value={approveNote}
                onChange={e => setApproveNote(e.target.value)}
                placeholder="Add any notes about this approval…"
                rows="3"
              />
            </div>
            <div className="sign-confirm">
              <label htmlFor="sign-pw">Sign with your login password</label>
              <input id="sign-pw" type="password" autoComplete="current-password" value={signPassword} onChange={e => setSignPassword(e.target.value)} placeholder="Your password" />
              <small>Authorizing applies your electronic signature and registration number to this report.</small>
            </div>
            {needsDsc && (
              <div className="sign-confirm">
                <label htmlFor="dsc-pw">Digital Signature Certificate password</label>
                <input id="dsc-pw" type="password" autoComplete="off" value={dscPassword} onChange={e => setDscPassword(e.target.value)} placeholder={`Password of your DSC (${myDsc.dsc?.common_name || 'certificate'})`} />
                <small>The report is also digitally signed with your certificate{myDsc.dsc?.days_left != null && myDsc.dsc.days_left <= 30 ? ` — it expires in ${myDsc.dsc.days_left} days` : ''}. The password is used once and not stored.</small>
              </div>
            )}
            {myDsc?.agent && (
              <div className="sign-confirm">
                <small>This hospital signs with your USB token. When you press Sign &amp; Approve, the <b>Poxia DSC Agent</b> on this computer will ask for your DSC PIN. Keep your token inserted.</small>
              </div>
            )}
            {myDsc?.active && !needsDsc && !myDsc?.agent && (
              <div className="sign-confirm">
                <small>This report will also be digitally signed automatically with the {myDsc.source === 'Hospital' ? "hospital's" : 'your'} certificate ({myDsc.dsc?.common_name}).</small>
              </div>
            )}
            {myDsc?.required && !myDsc?.active && (
              <div className="sign-confirm"><small style={{ color: '#b91c1c' }}>Your hospital requires a Digital Signature Certificate to authorise reports, and you do not have a valid one. Ask your hospital admin.</small></div>
            )}
            <div className="modal-actions">
              <button className="btn-modal-cancel" onClick={() => { setApproveTest(null); setSignPassword(''); setDscPassword(''); }}>Cancel</button>
              <button
                className="approve-btn"
                style={{ padding: '10px 24px', fontSize: '15px' }}
                disabled={!signReady}
                onClick={handleApprove}
              >
                ✓ Sign & Approve Report
              </button>
            </div>
          </div>
        </div>
      )}

      {agentSign && (
        <div className="modal-overlay">
          <div className="verification-modal" style={{ maxWidth: 480 }}>
            <h2>Signing with your USB token</h2>
            {agentSign.summary && (
              <p style={{ margin: '0 0 8px', color: '#475569' }}>{agentSign.summary.test} · {agentSign.summary.patient} · {agentSign.summary.sample_id}</p>
            )}
            <p style={{ fontWeight: 600 }}>{agentSign.message}</p>
            <p style={{ color: '#64748b', fontSize: 13 }}>The report is approved and released only after the token has signed it.</p>
            <div className="modal-actions">
              <button className="btn-modal-cancel" onClick={() => { agentCancel.current = true; }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Verify Modal ── */}
      {selectedTest && (
        <div className="modal-overlay" onClick={() => setSelectedTest(null)}>
          <div className="verification-modal" onClick={e => e.stopPropagation()}>
            <h2>Verify Test Results</h2>
            <div className="test-details">
              <p><strong>Sample ID:</strong> {selectedTest.sample_id}</p>
              <p><strong>Patient:</strong> {selectedTest.patient_name}</p>
              <p><strong>Test:</strong> {selectedTest.test_name}</p>
              <p><strong>Machine:</strong> {selectedTest.machine_no || 'N/A'}</p>
              <p><strong>Tested At:</strong> {formatDateTime(selectedTest.tested_at)}</p>
            </div>
            <div className="results-section">
              <h3>Test Results</h3>
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Parameter</th><th>Result</th><th>Unit</th>
                    <th>Reference Range</th><th>Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTest.results?.map((result, idx) => (
                    <tr key={idx} className={`flag-${flagKey(flagOf(result))}`}>
                      <td>{result.parameter_name}</td>
                      <td className="result-value">{result.result_value}</td>
                      <td>{result.unit}</td>
                      <td>{result.reference_range}</td>
                      <td><FlagCell result={result} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="verification-notes">
              <label>Verification Notes (Optional):</label>
              <textarea
                value={verificationNote}
                onChange={e => setVerificationNote(e.target.value)}
                placeholder="Add any notes about this verification…"
                rows="3"
              />
            </div>
            <div className="modal-actions">
              <button className="btn-modal-cancel" onClick={() => setSelectedTest(null)}>Cancel</button>
              <button
                className="verify-submit-btn"
                onClick={() => handleVerify(selectedTest.id, selectedTest.sample_id)}
              >
                ✓ Mark as Verified
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Request Rerun Modal ── */}
      {rerunTest && (
        <div className="modal-overlay" onClick={() => setRerunTest(null)}>
          <div className="verification-modal" onClick={e => e.stopPropagation()}>
            <h2>Request Rerun</h2>
            <div className="test-details">
              <p><strong>Sample ID:</strong> {rerunTest.sample_id}</p>
              <p><strong>Patient:</strong> {rerunTest.patient_name}</p>
              <p><strong>Test:</strong> {rerunTest.test_name}</p>
              <p><strong>Machine:</strong> {rerunTest.machine_no || 'N/A'}</p>
            </div>
            <div className="results-section">
              <h3>Test Results</h3>
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Parameter</th><th>Result</th><th>Unit</th>
                    <th>Reference Range</th><th>Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {rerunTest.results?.map((result, idx) => (
                    <tr key={idx} className={`flag-${flagKey(flagOf(result))}`}>
                      <td>{result.parameter_name}</td>
                      <td className="result-value">{result.result_value}</td>
                      <td>{result.unit}</td>
                      <td>{result.reference_range}</td>
                      <td><FlagCell result={result} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="verification-notes">
              <label>Reason for Rerun (required):</label>
              <textarea
                value={rerunReason}
                onChange={e => setRerunReason(e.target.value)}
                placeholder="e.g. Result inconsistent with clinical picture, suspected sample/analyzer error…"
                rows="3"
              />
            </div>
            <div className="modal-actions">
              <button className="btn-modal-cancel" onClick={() => setRerunTest(null)}>Cancel</button>
              <button
                className="reject-btn"
                style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 24px', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}
                onClick={handleRequestRerun}
              >
                ↻ Send Back for Rerun
              </button>
            </div>
          </div>
        </div>
      )}
      {showSignature && <SignatureProfile onClose={() => setShowSignature(false)} />}
      {historyFor && <ResultHistory resultId={historyFor} onClose={() => setHistoryFor(null)} />}
      {reportAction && (
        <div className="modal-overlay" onClick={() => setReportAction(null)}>
          <div className="verification-modal" onClick={e => e.stopPropagation()}>
            <h2>{reportAction.type === 'cancel' ? 'Cancel authorized report' : 'Reissue report'}</h2>
            <div className="test-details">
              <p><strong>Patient:</strong> {reportAction.test.patient_name}</p>
              <p><strong>Test:</strong> {reportAction.test.test_name}</p>
              <p style={{ color: '#92400e' }}>
                {reportAction.type === 'cancel'
                  ? 'The report will be withdrawn from release and its signature revoked. The QR on any printed copy will show it as revoked.'
                  : 'The report goes back through validation and authorization and is issued as a new version.'}
              </p>
            </div>
            <div className="notes-section">
              <label>Reason (required):</label>
              <textarea value={reportReason} onChange={e => setReportReason(e.target.value)} rows="3" placeholder="Why is this being done?" />
            </div>
            {reportAction.type === 'cancel' && (
              <div className="sign-confirm">
                <label htmlFor="cancel-pw">Confirm with your login password</label>
                <input id="cancel-pw" type="password" autoComplete="current-password" value={reportPassword} onChange={e => setReportPassword(e.target.value)} />
              </div>
            )}
            <div className="modal-actions">
              <button className="btn-modal-cancel" onClick={() => setReportAction(null)}>Close</button>
              <button className="approve-btn" style={{ padding: '10px 24px', fontSize: '15px' }}
                disabled={reportReason.trim().length < 5 || (reportAction.type === 'cancel' && !reportPassword)} onClick={submitReportAction}>
                {reportAction.type === 'cancel' ? 'Cancel report' : 'Reissue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LabVerification;
