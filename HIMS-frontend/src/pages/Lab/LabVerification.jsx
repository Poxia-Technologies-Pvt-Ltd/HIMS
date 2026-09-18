import { useState, useEffect } from 'react';
import '../../assets/CSS/LabVerification.css';

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
  const [bulkProgress, setBulkProgress] = useState(null); // { done, total, type }

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

  const verifiableTests = filteredTests.filter(
    t => t.status === 'Test Done' || t.status === 'Completed'
  );
  const approvableTests = filteredTests.filter(t => t.status === 'Verified');

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
          verified_by: getDoctorId(),
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
        alert('Failed to verify test');
      }
    } catch (error) {
      console.error('Error verifying test:', error);
      alert('Error verifying test');
    }
  };

  const handleApprove = async () => {
    if (!approveTest) return;
    try {
      const res = await fetch(`${API_BASE}/api/lab/verify-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          test_result_id: approveTest.id,
          sample_id: approveTest.sample_id,
          verified_by: getDoctorId(),
          status: 'Approved',
          notes: approveNote
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Test approved successfully!');
        setApproveTest(null);
        setApproveNote('');
        fetchPendingVerifications();
      } else {
        alert('Approval failed: ' + (data.message || 'Unknown error'));
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
    const doctorId = getDoctorId();
    for (let i = 0; i < verifiableTests.length; i++) {
      const t = verifiableTests[i];
      try {
        await fetch(`${API_BASE}/api/lab/verify-test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHdr() },
          body: JSON.stringify({
            test_result_id: t.id,
            sample_id: t.sample_id,
            verified_by: doctorId,
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
    const doctorId = getDoctorId();
    for (let i = 0; i < approvableTests.length; i++) {
      const t = approvableTests[i];
      try {
        await fetch(`${API_BASE}/api/lab/verify-test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHdr() },
          body: JSON.stringify({
            test_result_id: t.id,
            sample_id: t.sample_id,
            verified_by: doctorId,
            status: 'Approved',
            notes: ''
          })
        });
      } catch { /* continue on error */ }
      setBulkProgress({ done: i + 1, total, type: 'approve' });
    }
    setBulkProgress(null);
    fetchPendingVerifications();
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
        <button className="refresh-btn" onClick={fetchPendingVerifications}>↻ Refresh</button>
      </div>

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
                  Approve {approvableTests.length} tests?
                  <button className="btn-confirm-yes approve" onClick={handleApproveAll}>Yes, Approve All</button>
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
                    <td>{test.test_name}</td>
                    <td>{test.machine_no || 'N/A'}</td>
                    <td>{formatDateTime(test.tested_at)}</td>
                    <td>{getStatusBadge(test.status)}</td>
                    <td style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {(test.status === 'Test Done' || test.status === 'Completed') && (
                        <button className="verify-btn" onClick={() => setSelectedTest(test)}>
                          ✓ Verify
                        </button>
                      )}
                      {test.status === 'Verified' && (
                        <button
                          className="approve-btn"
                          onClick={() => { setApproveTest(test); setApproveNote(''); }}
                        >
                          ✓ Approve
                        </button>
                      )}
                      {test.status === 'Approved' && (
                        <span className="approved-text">Approved ✓</span>
                      )}
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
                    <tr key={idx} className={`flag-${result.result_flag}`}>
                      <td>{result.parameter_name}</td>
                      <td className="result-value">{result.result_value}</td>
                      <td>{result.unit}</td>
                      <td>{result.reference_range}</td>
                      <td><span className={`flag-badge ${result.result_flag}`}>{result.result_flag}</span></td>
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
            <div className="modal-actions">
              <button className="btn-modal-cancel" onClick={() => setApproveTest(null)}>Cancel</button>
              <button
                className="approve-btn"
                style={{ padding: '10px 24px', fontSize: '15px' }}
                onClick={handleApprove}
              >
                ✓ Approve & Release Report
              </button>
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
                    <tr key={idx} className={`flag-${result.result_flag}`}>
                      <td>{result.parameter_name}</td>
                      <td className="result-value">{result.result_value}</td>
                      <td>{result.unit}</td>
                      <td>{result.reference_range}</td>
                      <td><span className={`flag-badge ${result.result_flag}`}>{result.result_flag}</span></td>
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
                    <tr key={idx} className={`flag-${result.result_flag}`}>
                      <td>{result.parameter_name}</td>
                      <td className="result-value">{result.result_value}</td>
                      <td>{result.unit}</td>
                      <td>{result.reference_range}</td>
                      <td><span className={`flag-badge ${result.result_flag}`}>{result.result_flag}</span></td>
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
    </div>
  );
};

export default LabVerification;
