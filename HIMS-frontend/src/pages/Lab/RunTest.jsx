import { useState, useEffect } from 'react';
import '../../assets/CSS/LabVerification.css'; // Reuse same styles

const API_BASE = import.meta.env.VITE_API_URL || '';

const RunTest = () => {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTest, setSelectedTest] = useState(null);
  const [selectedMachine, setSelectedMachine] = useState('');
  const [labMachines, setLabMachines] = useState([]);
  const [testResults, setTestResults] = useState(null);

  // Modal states
  const [showMachineModal, setShowMachineModal] = useState(false);
  const [showWaitingModal, setShowWaitingModal] = useState(false);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    fetchAcknowledgedTests();
  }, []);

  // Fetch acknowledged tests (status = 'Acknowledged')
  const fetchAcknowledgedTests = async () => {
    try {
      setLoading(true);
      // Using worklist endpoint with status filter for Acknowledged
      const res = await fetch(`${API_BASE}/api/lab/worklist?status=Acknowledged`);
      const data = await res.json();
      if (data.success) {
        setTests(data.worklist || []);
      }
    } catch (error) {
      console.error('Error fetching acknowledged tests:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch lab machines for the selected test's lab
  const fetchLabMachines = async (labId) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab/machines/${labId}`);
      const data = await res.json();
      if (data.success) {
        setLabMachines(data.machines || []);
      }
    } catch (error) {
      console.error('Error fetching lab machines:', error);
    }
  };

  const handleStartTestClick = async (test) => {
    setSelectedTest(test);
    setSelectedMachine('');
    setTestResults(null);

    // Fetch machines for this lab
    if (test.lab_id) {
      await fetchLabMachines(test.lab_id);
    }

    setShowMachineModal(true);
  };

  const handleStartTest = async () => {
    if (!selectedMachine) return;

    setShowMachineModal(false);
    setShowWaitingModal(true);
    setIsRunning(true);

    // Simulate waiting for machine to complete test
    // In real scenario, this would be a WebSocket or polling mechanism
    setTimeout(async () => {
      await simulateMachineTestComplete();
    }, 3000); // 3 second simulation
  };

  const simulateMachineTestComplete = async () => {
    try {
      // Call the API to save test results (simulating machine sending results)
      const res = await fetch(`${API_BASE}/api/lab/save-test-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sample_id: selectedTest.sample_id,
          bill_item_id: selectedTest.bill_item_id,
          test_id: selectedTest.test_id,
          test_name: selectedTest.test_name,
          machine_no: selectedMachine,
          results: generateMockResults(selectedTest.test_name)
        })
      });

      const data = await res.json();

      if (data.success) {
        setTestResults({
          ...data.data,
          patient_name: selectedTest.patient_name,
          test_name: selectedTest.test_name,
          results: generateMockResults(selectedTest.test_name)
        });
        setShowWaitingModal(false);
        setShowResultsModal(true);
        // Refresh the list
        fetchAcknowledgedTests();
      } else {
        alert(data.message || 'Failed to save test results');
        setShowWaitingModal(false);
      }
    } catch (error) {
      console.error('Error saving test results:', error);
      alert('Error saving test results');
      setShowWaitingModal(false);
    } finally {
      setIsRunning(false);
    }
  };

  // Generate mock results based on test type
  const generateMockResults = (testName) => {
    const commonResults = {
      'CBC': [
        { parameter_name: 'Hemoglobin', result_value: (12 + Math.random() * 4).toFixed(1), unit: 'g/dL', reference_range: '12.0-16.0', result_flag: 'Normal' },
        { parameter_name: 'WBC Count', result_value: Math.floor(4000 + Math.random() * 6000), unit: '/μL', reference_range: '4000-11000', result_flag: 'Normal' },
        { parameter_name: 'RBC Count', result_value: (4 + Math.random() * 1.5).toFixed(2), unit: 'million/μL', reference_range: '4.0-5.5', result_flag: 'Normal' },
        { parameter_name: 'Platelet Count', result_value: Math.floor(150000 + Math.random() * 150000), unit: '/μL', reference_range: '150000-450000', result_flag: 'Normal' },
        { parameter_name: 'Hematocrit', result_value: (36 + Math.random() * 12).toFixed(1), unit: '%', reference_range: '36-48', result_flag: 'Normal' },
        { parameter_name: 'MCV', result_value: Math.floor(80 + Math.random() * 20), unit: 'fL', reference_range: '80-100', result_flag: 'Normal' }
      ],
      'Blood Sugar': [
        { parameter_name: 'Fasting Glucose', result_value: Math.floor(70 + Math.random() * 60), unit: 'mg/dL', reference_range: '70-100', result_flag: 'Normal' },
        { parameter_name: 'HbA1c', result_value: (4 + Math.random() * 4).toFixed(1), unit: '%', reference_range: '4.0-6.0', result_flag: 'Normal' }
      ],
      'Lipid Profile': [
        { parameter_name: 'Total Cholesterol', result_value: Math.floor(150 + Math.random() * 50), unit: 'mg/dL', reference_range: '< 200', result_flag: 'Normal' },
        { parameter_name: 'HDL Cholesterol', result_value: Math.floor(40 + Math.random() * 30), unit: 'mg/dL', reference_range: '> 40', result_flag: 'Normal' },
        { parameter_name: 'LDL Cholesterol', result_value: Math.floor(70 + Math.random() * 50), unit: 'mg/dL', reference_range: '< 100', result_flag: 'Normal' },
        { parameter_name: 'Triglycerides', result_value: Math.floor(80 + Math.random() * 70), unit: 'mg/dL', reference_range: '< 150', result_flag: 'Normal' }
      ],
      'Liver Function': [
        { parameter_name: 'SGOT (AST)', result_value: Math.floor(15 + Math.random() * 25), unit: 'U/L', reference_range: '10-40', result_flag: 'Normal' },
        { parameter_name: 'SGPT (ALT)', result_value: Math.floor(10 + Math.random() * 20), unit: 'U/L', reference_range: '7-56', result_flag: 'Normal' },
        { parameter_name: 'Bilirubin Total', result_value: (0.3 + Math.random() * 0.9).toFixed(2), unit: 'mg/dL', reference_range: '0.1-1.2', result_flag: 'Normal' },
        { parameter_name: 'Alkaline Phosphatase', result_value: Math.floor(44 + Math.random() * 100), unit: 'U/L', reference_range: '44-147', result_flag: 'Normal' }
      ],
      'Kidney Function': [
        { parameter_name: 'Creatinine', result_value: (0.6 + Math.random() * 0.6).toFixed(2), unit: 'mg/dL', reference_range: '0.6-1.2', result_flag: 'Normal' },
        { parameter_name: 'BUN', result_value: Math.floor(7 + Math.random() * 14), unit: 'mg/dL', reference_range: '7-20', result_flag: 'Normal' },
        { parameter_name: 'Uric Acid', result_value: (3 + Math.random() * 3).toFixed(1), unit: 'mg/dL', reference_range: '3.5-7.2', result_flag: 'Normal' }
      ],
      'Thyroid': [
        { parameter_name: 'TSH', result_value: (0.5 + Math.random() * 3.5).toFixed(2), unit: 'μIU/mL', reference_range: '0.4-4.0', result_flag: 'Normal' },
        { parameter_name: 'T3', result_value: (80 + Math.random() * 120).toFixed(1), unit: 'ng/dL', reference_range: '80-200', result_flag: 'Normal' },
        { parameter_name: 'T4', result_value: (5 + Math.random() * 7).toFixed(1), unit: 'μg/dL', reference_range: '5.0-12.0', result_flag: 'Normal' }
      ],
      // ── CDAC single-parameter demo tests — keyed by CDAC's exact
      // hmis_test_name (see cdac_test_code_map), since a test pulled via
      // CDAC gets created with that name verbatim. parameter_name here must
      // match the parameter_name staged in cdac_parameter_map for the
      // CDAC round-trip demo (API31) to find a mapping and actually send
      // the result — a generic "Test Value" fallback would silently break
      // that lookup.
      'Thyroid Stimulating Hormone': [
        { parameter_name: 'Thyroid Stimulating Hormone', result_value: (0.5 + Math.random() * 3.5).toFixed(2), unit: 'μIU/mL', reference_range: '0.4-4.0', result_flag: 'Normal' }
      ],
      'Uric Acid': [
        { parameter_name: 'Uric Acid', result_value: (3.5 + Math.random() * 3.7).toFixed(1), unit: 'mg/dL', reference_range: '3.5-7.2', result_flag: 'Normal' }
      ],
      'Serum Vitamin B12': [
        { parameter_name: 'Serum Vitamin B12', result_value: Math.floor(200 + Math.random() * 700), unit: 'pg/mL', reference_range: '200-900', result_flag: 'Normal' }
      ],
      '25-OH Vitamin D': [
        { parameter_name: '25-OH Vitamin D', result_value: Math.floor(30 + Math.random() * 70), unit: 'ng/mL', reference_range: '30-100', result_flag: 'Normal' }
      ],
      'Serum Alkaline Phosphatase': [
        { parameter_name: 'Serum Alkaline Phosphatase', result_value: Math.floor(44 + Math.random() * 103), unit: 'U/L', reference_range: '44-147', result_flag: 'Normal' }
      ],
      'Serum Amylase': [
        { parameter_name: 'Serum Amylase', result_value: Math.floor(28 + Math.random() * 72), unit: 'U/L', reference_range: '28-100', result_flag: 'Normal' }
      ]
    };

    // Default results for unknown tests
    const defaultResults = [
      { parameter_name: 'Test Value', result_value: (50 + Math.random() * 50).toFixed(2), unit: 'U/L', reference_range: '30-70', result_flag: 'Normal' }
    ];

    return commonResults[testName] || defaultResults;
  };

  const handleCloseResults = () => {
    setShowResultsModal(false);
    setSelectedTest(null);
    setTestResults(null);
    setSelectedMachine('');
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status) => {
    const statusClass = status?.toLowerCase().replace(' ', '-') || 'unknown';
    return <span className={`status-badge ${statusClass}`}>{status}</span>;
  };

  return (
    <div className="lab-verification">
      <div className="verification-header">
        <h2>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          Run Test
        </h2>
        <p>Select acknowledged tests and start running them on machines</p>
      </div>

      {loading ? (
        <div className="loading">Loading tests...</div>
      ) : (
        <div className="tests-table-container">
          <table className="tests-table">
            <thead>
              <tr>
                <th>Sample ID</th>
                <th>Patient Name</th>
                <th>Test Name</th>
                <th>Priority</th>
                <th>Lab</th>
                <th>Acknowledged At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {tests.length === 0 ? (
                <tr>
                  <td colSpan="7" className="no-data">No acknowledged tests waiting to run</td>
                </tr>
              ) : (
                tests.map((test) => (
                  <tr key={test.id} className="status-acknowledged">
                    <td className="sample-id">{test.sample_id}</td>
                    <td>{test.patient_name}</td>
                    <td>{test.test_name}</td>
                    <td>{getStatusBadge(test.priority || 'Normal')}</td>
                    <td>{test.lab_name || 'N/A'}</td>
                    <td>{formatDateTime(test.acknowledged_at || test.created_at)}</td>
                    <td>
                      <button
                        className="start-test-btn"
                        onClick={() => handleStartTestClick(test)}
                        style={{
                          background: '#2563eb',
                          color: '#fff',
                          border: 'none',
                          padding: '6px 16px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        Start Test
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Machine Selection Modal */}
      {showMachineModal && selectedTest && (
        <div className="modal-overlay" onClick={() => setShowMachineModal(false)}>
          <div className="verification-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <h2>Select Machine</h2>

            <div className="test-details">
              <p><strong>Sample ID:</strong> {selectedTest.sample_id}</p>
              <p><strong>Patient:</strong> {selectedTest.patient_name}</p>
              <p><strong>Test:</strong> {selectedTest.test_name}</p>
              <p><strong>Lab:</strong> {selectedTest.lab_name || 'N/A'}</p>
            </div>

            <div style={{ marginTop: '20px' }}>
              <label style={{ display: 'block', marginBottom: '10px', fontWeight: 500, color: '#374151' }}>
                Select Analyser Machine *
              </label>
              {labMachines.length === 0 ? (
                <div style={{ padding: '20px', background: '#fef3c7', borderRadius: '8px', color: '#92400e' }}>
                  No machines registered for this lab. Please add machines in Hospital Infrastructure.
                </div>
              ) : (
                <select
                  value={selectedMachine}
                  onChange={(e) => setSelectedMachine(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                >
                  <option value="">-- Select Machine --</option>
                  {labMachines.map(machine => (
                    <option key={machine.id} value={machine.machine_id}>
                      {machine.name} ({machine.machine_id}) {machine.model ? `- ${machine.model}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
              <button
                className="btn-ghost"
                onClick={() => setShowMachineModal(false)}
                style={{ padding: '8px 16px' }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleStartTest}
                disabled={!selectedMachine || labMachines.length === 0}
                style={{
                  padding: '8px 20px',
                  opacity: (!selectedMachine || labMachines.length === 0) ? 0.6 : 1
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '6px' }}>
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Start Test
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waiting Modal */}
      {showWaitingModal && (
        <div className="modal-overlay">
          <div className="verification-modal" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <div style={{ padding: '30px 20px' }}>
              <div style={{
                width: '60px',
                height: '60px',
                border: '4px solid #e5e7eb',
                borderTop: '4px solid #2563eb',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 20px'
              }} />
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
              <h3 style={{ margin: '0 0 10px 0', color: '#1f2937' }}>Running Test...</h3>
              <p style={{ color: '#6b7280', margin: 0 }}>
                Waiting for machine <strong>{selectedMachine}</strong> to complete the test and send results.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Results Modal */}
      {showResultsModal && testResults && (
        <div className="modal-overlay" onClick={handleCloseResults}>
          <div className="verification-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" style={{ marginRight: '8px', verticalAlign: 'middle' }}>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                Test Completed
              </h2>
              <button
                className="btn-ghost"
                style={{ border: 'none', background: 'transparent', padding: '8px' }}
                onClick={handleCloseResults}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="test-details">
              <p><strong>Sample ID:</strong> {testResults.sample_id}</p>
              <p><strong>Patient:</strong> {testResults.patient_name}</p>
              <p><strong>Test:</strong> {testResults.test_name}</p>
              <p><strong>Machine:</strong> {testResults.machine_no || 'N/A'}</p>
              <p><strong>Tested At:</strong> {formatDateTime(testResults.tested_at)}</p>
              <p><strong>Results ID:</strong> #{testResults.result_id}</p>
            </div>

            <div className="results-section">
              <h3>Test Results</h3>
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
                  {testResults.results?.map((result, idx) => (
                    <tr key={idx} className={`flag-${result.result_flag?.toLowerCase()}`}>
                      <td>{result.parameter_name}</td>
                      <td className="result-value">{result.result_value}</td>
                      <td>{result.unit}</td>
                      <td>{result.reference_range}</td>
                      <td>
                        <span className={`flag-badge ${result.result_flag?.toLowerCase()}`}>
                          {result.result_flag}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'center' }}>
              <button
                className="btn-primary"
                onClick={handleCloseResults}
                style={{ padding: '10px 32px' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Close & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RunTest;
