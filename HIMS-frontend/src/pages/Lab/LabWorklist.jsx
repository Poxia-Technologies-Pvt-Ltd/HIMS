import { useState, useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import {
  Monitor,
  RefreshCw,
  FlaskConical,
  Beaker,
  Microchip,
  Microscope,
  Activity,
  LayoutGrid,
  Droplets,
  Bug,
  ClipboardList,
  Check,
  PieChart,
  Printer,
  X,
  MapPin,
  Clock,
  Download
} from 'lucide-react';
import '../../assets/CSS/LabWorklist.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

const DEPARTMENTS = [
  { id: 'all', name: 'All Departments', icon: <LayoutGrid size={18} /> },
  { id: 'hematology', name: 'Hematology', icon: <Droplets size={18} /> },
  { id: 'biochemistry', name: 'Biochemistry', icon: <FlaskConical size={18} /> },
  { id: 'serology', name: 'Serology', icon: <Microscope size={18} /> },
  { id: 'microbiology', name: 'Microbiology', icon: <Bug size={18} /> }
];

const STATUS_COLORS = {
  'Pending': '#f59e0b',
  'Collected': '#3b82f6',
  'In Progress': '#8b5cf6',
  'Test Done': '#06b6d4',
  'Completed': '#22c55e',
  'Rerun Requested': '#f59e0b'
};

export default function LabWorklist() {
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [worklist, setWorklist] = useState([]);
  const [loading, setLoading] = useState(false);
  const [printLabel, setPrintLabel] = useState(null);
  const [viewResults, setViewResults] = useState(null);
  const [testResults, setTestResults] = useState([]);
  const [mappingTest, setMappingTest] = useState(null);
  const [mapCRN, setMapCRN] = useState('');
  const [mapLoading, setMapLoading] = useState(false);
  const barcodeRef = useRef(null);
  const printLabelRef = useRef(null);

  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(localStorage.getItem('branch_id') || '1');
  const userRole = localStorage.getItem('role_level') || 'Branch';
  const loggedInUser = JSON.parse(localStorage.getItem('user') || '{}');
  const currentBranchName = branches.find(b => b.branch_id == selectedBranch)?.name || loggedInUser.branch_name || 'Branch';

  // Only CDAC-integrated facilities can pull an order by CR number. Ramgarh
  // and the other CARE sites have no CR numbers at all, so showing the field
  // there invites staff to type something that can never resolve. Matched on
  // `id` (what /api/branches returns) rather than `branch_id`; defaults to
  // hidden until the branch list has loaded, so it never flashes into view on
  // a CARE site.
  const currentBranch = branches.find(b => String(b.id) === String(selectedBranch));
  const isCdacBranch = currentBranch?.cdac_integration_type === 'CDAC';
  // Ramgarh runs on CARE, where a patient may be identified by UHID, ABHA
  // number, phone or CARE patient id rather than anything we issued — so the
  // one-box lookup is offered there and nowhere else, per the rollout scope.
  const isRamgarh = (currentBranch?.district_name || '').trim().toLowerCase() === 'ramgarh';

  const [patientSearch, setPatientSearch] = useState('');
  const [cdacCrNo, setCdacCrNo] = useState('');
  const [cdacPulling, setCdacPulling] = useState(false);
  // Guards against firing the same pull twice (Enter, then blur right after)
  // and against re-firing on every blur while the value hasn't changed.
  const lastCdacPullAttemptRef = useRef('');

  // Fetched for every role, not just Central. Branch-level users get exactly
  // their own branch back (branchController.getBranches scopes on role_level),
  // and the rows carry cdac_integration_type — which is what decides whether
  // the CDAC pull controls below are shown at all.
  useEffect(() => {
    fetch(`${API_BASE}/api/branches`, { headers: authHdr() })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const mapped = (data.branches || []).map(b => ({
            ...b,
            name: b.branch_name
          }));
          setBranches(mapped);
        }
      })
      .catch(console.error);
  }, [userRole]);

  // Fetch worklist when department changes
  useEffect(() => {
    const fetchWorklist = async () => {
      if (!selectedDepartment) return;
      setLoading(true);
      try {
        const role_level = userRole;
        const res = await fetch(`${API_BASE}/api/lab/worklist?department=${selectedDepartment}&branch_id=${selectedBranch}&role_level=${role_level}${patientSearch.trim() ? `&search=${encodeURIComponent(patientSearch.trim())}` : ''}`, { headers: authHdr() });
        const data = await res.json();
        if (data.success) {
          setWorklist(data.worklist || []);
        }
      } catch (error) {
        console.error('Error fetching worklist:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchWorklist();
  }, [selectedDepartment, selectedBranch, patientSearch]);

  // Generate barcode when print label is set
  useEffect(() => {
    if (printLabel && barcodeRef.current) {
      JsBarcode(barcodeRef.current, printLabel.sampleId, {
        format: 'CODE128',
        width: 2,
        height: 50,
        displayValue: true,
        fontSize: 14,
        font: 'monospace',
        margin: 10
      });

      // Auto print after barcode is generated
      setTimeout(() => {
        printLabelRef.current = printLabel;
        handlePrint();
      }, 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printLabel]);

  const refreshWorklist = async () => {
    setLoading(true);
    try {
      const role_level = userRole;
      const res = await fetch(`${API_BASE}/api/lab/worklist?department=${selectedDepartment}&branch_id=${selectedBranch}&role_level=${role_level}${patientSearch.trim() ? `&search=${encodeURIComponent(patientSearch.trim())}` : ''}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        setWorklist(data.worklist || []);
      }
    } catch (error) {
      console.error('Error fetching worklist:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async (item) => {
    try {
      // Generate sample ID: LAB-{YYYYMMDD}-{AUTO_INCREMENT}
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

      // Get next sequence number for today
      const res = await fetch(`${API_BASE}/api/lab/generate-sample-id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ branch_id: localStorage.getItem('branch_id'), department: item.department })
      });
      const data = await res.json();

      if (data.success) {
        const sampleId = data.sampleId;

        // Update status to Collected
        const updateRes = await fetch(`${API_BASE}/api/lab/acknowledge-test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHdr() },
          body: JSON.stringify({
            bill_item_id: item.bill_item_id,
            sample_id: sampleId,
            short_id: data.shortId,
            status: 'Collected',
            collected_by: localStorage.getItem('user_id')
          })
        });

        const updateData = await updateRes.json();
        if (updateData.success) {
          // Set print label data
          setPrintLabel({
            sampleId,
            queueNumber: item.lab_queue_number || '1',
            patientName: item.patient_name,
            testName: item.test_name,
            sampleType: item.sample_type,
            department: item.department
          });

          // Refresh worklist
          refreshWorklist();
        }
      }
    } catch (error) {
      console.error('Error acknowledging test:', error);
      alert('Failed to acknowledge test. Please try again.');
    }
  };

  // Pulls a patient's CDAC-ordered investigations (API1) and materializes
  // them as a local bill, ready for the normal worklist/acknowledge flow.
  // Only applies to branches configured for CDAC (see branch_hmis_config).
  // CDAC is the primary source of tests for CDAC-enabled branches, so this
  // fires automatically the moment a CR number is entered/scanned (Enter key
  // or losing focus) — see onKeyDown/onBlur below — rather than requiring a
  // separate manual "Fetch" click every time.
  const handlePullCdacOrder = async ({ silent = false } = {}) => {
    const crNo = cdacCrNo.trim();
    if (!crNo) {
      if (!silent) alert('Enter a CDAC patient CR number first');
      return;
    }
    if (cdacPulling || crNo === lastCdacPullAttemptRef.current) return;
    lastCdacPullAttemptRef.current = crNo;
    setCdacPulling(true);
    try {
      const res = await fetch(`${API_BASE}/api/cdac/pull-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ branch_id: selectedBranch, hmis_patCrNo: cdacCrNo.trim() })
      });
      const data = await res.json();
      let message = data.message || (data.success ? `Pulled ${data.items?.length || 0} test(s) from CDAC` : 'Failed to pull CDAC order');
      if (data.invalidItems?.length) {
        message += '\n\nSkipped (missing data from CDAC): ' + data.invalidItems.map((i) => `${i.hmis_test_name || i.hmis_req_dno || 'unknown'} (${i.reason})`).join(', ');
      }
      alert(message);
      if (data.success) {
        setCdacCrNo('');
        refreshWorklist();
      }
    } catch (error) {
      console.error('Error pulling CDAC order:', error);
      alert('Failed to pull CDAC order. Please try again.');
    } finally {
      setCdacPulling(false);
      // Cleared unconditionally (not just on success) so an explicit retry
      // (button click, or entering the same CR number again) after a
      // failure is never silently swallowed by the dedupe guard — the guard
      // only exists to stop Enter and a same-tick blur double-firing.
      lastCdacPullAttemptRef.current = '';
    }
  };

  const handleViewResults = async (item) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab/test-results/${item.sample_id}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        setTestResults(data.results || []);
        setViewResults(item);
      } else {
        alert('No results found for this test');
      }
    } catch (error) {
      console.error('Error fetching results:', error);
      alert('Failed to fetch test results');
    }
  };

  const handleCompleteTest = async (item) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab/update-test-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          bill_item_id: item.bill_item_id,
          status: 'Completed'
        })
      });
      const data = await res.json();
      if (data.success) {
        setViewResults(null);
        refreshWorklist();
      }
    } catch (error) {
      console.error('Error acknowledging test:', error);
      alert('Failed to acknowledge test. Please try again.');
    }
  };

  const handleMapPatient = async () => {
    if (!mapCRN) {
      alert("Please enter a CRN to map the patient.");
      return;
    }
    setMapLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/lab/map-unmapped-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          sample_id: mappingTest.sample_id,
          patient_reg_no: mapCRN
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(`Successfully mapped to patient: ${data.patient}`);
        setMappingTest(null);
        setMapCRN('');
        refreshWorklist();
      } else {
        alert(data.message || 'Failed to map patient.');
      }
    } catch (error) {
      console.error('Error mapping patient:', error);
      alert('Error mapping patient. Please check CRN and try again.');
    } finally {
      setMapLoading(false);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print labels');
      return;
    }

    const labelHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sample Label - ${printLabel.sampleId}</title>
        <style>
          @page { size: 80mm 50mm; margin: 0; }
          body { 
            margin: 0; 
            padding: 5mm; 
            font-family: Arial, sans-serif;
            width: 70mm;
          }
          .label-container {
            border: 1px solid #000;
            padding: 3mm;
            text-align: center;
          }
          .sample-id {
            font-size: 10px;
            font-weight: bold;
            margin-bottom: 2mm;
          }
          .barcode svg {
            max-width: 100%;
            height: auto;
          }
          .patient-name {
            font-size: 9px;
            margin-top: 2mm;
            font-weight: bold;
          }
          .test-name {
            font-size: 8px;
            margin-top: 1mm;
            color: #666;
          }
          .dept-info {
            font-size: 7px;
            margin-top: 1mm;
            color: #999;
          }
        </style>
      </head>
      <body>
        <div class="label-container">
          <div class="sample-id">Token: #${printLabel.queueNumber} | ${printLabel.sampleId}</div>
          <div class="barcode">
            <svg id="barcode"></svg>
          </div>
          <div class="patient-name">${printLabel.patientName}</div>
          <div class="test-name">${printLabel.testName}</div>
          <div class="dept-info">${printLabel.department} | ${printLabel.sampleType}</div>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
        <script>
          JsBarcode("#barcode", "${printLabel.sampleId}", {
            format: "CODE128",
            width: 2,
            height: 40,
            displayValue: false,
            margin: 0
          });
          window.onload = function() {
            setTimeout(function() {
              window.print();
              window.close();
            }, 500);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(labelHtml);
    printWindow.document.close();
  };

  const getDepartmentName = (deptId) => {
    const dept = DEPARTMENTS.find(d => d.id === deptId);
    return dept ? dept.name : deptId;
  };

  return (
    <div className="lab-worklist-page">
      {/* Header */}
      <div className="worklist-header">
        <div className="header-title-section">
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <FlaskConical size={28} color="#1d4ed8" />
            Laboratory Worklist
          </h1>
          <p>Real-time sample collection & monitoring</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#e0f2fe', color: '#0369a1', padding: '8px 16px', borderRadius: '12px', fontSize: '14px', fontWeight: '700', border: '1px solid #bae6fd' }}>
          <MapPin size={16} />
          {currentBranchName}
        </div>
      </div>

      {/* Now Serving Banner */}
      {!loading && worklist.length > 0 && (
        <div className="now-serving-banner">
          <div className="serving-content">
            <div className="serving-left">
              <div className="serving-label">Next Patient to Call</div>
              <div className="serving-main">
                <span className="serving-token">
                  Token #{(() => {
                    const firstPending = worklist.find(w => w.status === 'Pending') || worklist[0];
                    return firstPending.lab_queue_number || 1;
                  })()}
                </span>
                <span className="serving-name">
                  {(worklist.find(w => w.status === 'Pending') || worklist[0]).patient_name}
                </span>
              </div>
            </div>
            <div className="serving-right">
              <div className="pending-count-label">Total Pending</div>
              <div className="pending-count-value">
                {worklist.filter(w => w.status === 'Pending').length}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Worklist Table */}
      <div className="worklist-section">
        <div className="worklist-header-bar">
          <h3>
            {getDepartmentName(selectedDepartment)} Worklist
            <span className="count-badge">{worklist.length} pending</span>
          </h3>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {isRamgarh && (
              <input
                type="text"
                placeholder="Search: UHID, ABHA, phone, CARE ID, name…"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', width: '260px' }}
              />
            )}
            {isCdacBranch && (
              <>
                <input
                  type="text"
                  placeholder="CDAC CR Number"
                  value={cdacCrNo}
                  onChange={(e) => setCdacCrNo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePullCdacOrder()}
                  onBlur={() => handlePullCdacOrder({ silent: true })}
                  style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', width: '150px' }}
                />
                <button
                  className="btn-primary"
                  disabled={cdacPulling}
                  onClick={handlePullCdacOrder}
                  style={{ background: '#0369a1', borderColor: '#0369a1', display: 'flex', alignItems: 'center', gap: '8px', opacity: cdacPulling ? 0.6 : 1 }}
                >
                  <Download size={16} /> {cdacPulling ? 'Fetching...' : 'Fetch CDAC Order'}
                </button>
              </>
            )}
            <button
              className="btn-primary"
              style={{ background: '#10b981', borderColor: '#10b981', display: 'flex', alignItems: 'center', gap: '8px' }}
              onClick={() => window.open('/lab-tv', '_blank')}
            >
              <Monitor size={16} /> Open TV Mode
            </button>
            <button className="refresh-btn" onClick={refreshWorklist} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading">Loading worklist...</div>
        ) : worklist.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon"><ClipboardList size={48} /></span>
            <p>No pending tests for {getDepartmentName(selectedDepartment)}</p>
          </div>
        ) : (
          <div className="worklist-table-container">
            <table className="worklist-table">
              <thead>
                <tr>
                  <th>Queue No.</th>
                  <th>Patient</th>
                  <th>CRN No</th>
                  <th>Test Name</th>
                  <th>Sample Type</th>
                  <th>Container</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {worklist
                  .filter(item => ['Pending', 'Collected', 'In Progress', 'Test Done'].includes(item.status))
                  .map((item, index) => (
                    <tr key={index} className={`status-${item.status?.toLowerCase().replace(' ', '-')}`}>
                      <td className="queue-number">
                        <strong>#{item.lab_queue_number || index + 1}</strong>
                      </td>
                      <td>
                        <div className="patient-info">
                          <span className="patient-name">{item.patient_name}</span>
                          <span className="patient-reg">{item.reg_no}</span>
                        </div>
                      </td>
                      <td>{item.patient_id}</td>
                      <td className="test-name-cell">{item.test_name}</td>
                      <td>{item.sample_type}</td>
                      <td>{item.tube_color || 'N/A'}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span
                            className="status-badge"
                            style={{ backgroundColor: STATUS_COLORS[item.status] || '#999' }}
                          >
                            {item.status}
                          </span>
                          {item.pending_params && item.pending_params.length > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#64748b', fontWeight: '600', maxWidth: '120px' }}>
                              <Clock size={10} />
                              Waiting for: {item.pending_params.join(', ')}
                            </div>
                          )}
                          {item.status === 'Rerun Requested' && item.rerun_reason && (
                            <div style={{ fontSize: '10px', color: '#b45309', fontWeight: '600', maxWidth: '160px' }}>
                              Doctor: "{item.rerun_reason}" — redo via LIS Agent
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        {item.reg_no && item.reg_no.startsWith('ANL-') ? (
                          <button
                            className="btn-primary"
                            onClick={() => { setMappingTest(item); }}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: '#eab308', borderColor: '#eab308' }}
                          >
                            Map Patient
                          </button>
                        ) : item.status === 'Pending' ? (
                          <button
                            className="acknowledge-btn"
                            onClick={() => handleAcknowledge(item)}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                          >
                            <Check size={14} />
                            Acknowledge
                          </button>
                        ) : (item.status === 'Test Done' || item.status === 'In Progress') ? (
                          <button
                            className="view-results-btn"
                            onClick={() => handleViewResults(item)}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                          >
                            <PieChart size={14} />
                            View Results
                          </button>
                        ) : (
                          <span className="sample-id-text">{item.sample_id}</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Hidden Barcode for Preview (optional) */}
      {printLabel && (
        <div className="print-preview-overlay" onClick={() => setPrintLabel(null)}>
          <div className="print-preview-modal" onClick={e => e.stopPropagation()}>
            <h3>Sample Label Preview</h3>
            <div className="label-preview">
              <div className="sample-id">Token: #{printLabel.queueNumber} | {printLabel.sampleId}</div>
              <svg ref={barcodeRef}></svg>
              <div className="patient-name">{printLabel.patientName}</div>
              <div className="test-name">{printLabel.testName}</div>
              <div className="dept-info">{printLabel.department} | {printLabel.sampleType}</div>
            </div>
            <div className="preview-actions">
              <button className="print-again-btn" onClick={handlePrint} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Printer size={14} /> Print Again
              </button>
              <button className="close" onClick={() => setPrintLabel(null)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <X size={14} /> Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Results Modal */}
      {viewResults && (
        <div className="print-preview-overlay" onClick={() => setViewResults(null)}>
          <div className="results-modal" onClick={e => e.stopPropagation()}>
            <h3>🧪 Test Results</h3>
            <div className="results-header">
              <p><strong>Patient:</strong> {viewResults.patient_name}</p>
              <p><strong>Test:</strong> {viewResults.test_name}</p>
              <p><strong>Sample ID:</strong> {viewResults.sample_id}</p>
              <p><strong>Barcode:</strong> {viewResults.lab_barcode}</p>
            </div>
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
                {testResults.map((result, idx) => (
                  <tr key={idx} className={`flag-${result.result_flag}`}>
                    <td>{result.parameter_name}</td>
                    <td className="result-value">{result.result_value}</td>
                    <td>{result.unit}</td>
                    <td>{result.reference_range}</td>
                    <td>
                      <span className={`flag-badge ${result.result_flag}`}>
                        {result.result_flag}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="preview-actions">
              <button className="complete-btn" onClick={() => handleCompleteTest(viewResults)}>
                ✓ Mark Complete
              </button>
              <button className="close-btn" onClick={() => setViewResults(null)}>
                ✕ Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Map Patient Modal */}
      {mappingTest && (
        <div className="print-preview-overlay" onClick={() => setMappingTest(null)}>
          <div className="results-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h3>🔗 Map to Patient</h3>
            <div style={{ marginTop: '16px', marginBottom: '24px' }}>
              <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '16px' }}>
                Enter the existing patient's CRN (Registration Number) to link this test result.
              </p>
              <div className="form-group">
                <label className="field-label">Patient CRN</label>
                <input
                  type="text"
                  className="field-input"
                  placeholder="e.g. CRN-2023-001"
                  value={mapCRN}
                  onChange={(e) => setMapCRN(e.target.value)}
                />
              </div>
            </div>
            <div className="preview-actions">
              <button 
                className="btn-primary" 
                onClick={handleMapPatient}
                disabled={mapLoading}
              >
                {mapLoading ? 'Mapping...' : 'Confirm Mapping'}
              </button>
              <button className="close-btn" onClick={() => { setMappingTest(null); setMapCRN(''); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
