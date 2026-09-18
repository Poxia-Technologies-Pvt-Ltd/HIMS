import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import JsBarcode from 'jsbarcode';
import { Search, RefreshCw, Eye, Hourglass, Radio, Satellite, Inbox } from 'lucide-react';
import { API_BASE } from '../apiBase';

const SampleList = () => {
  const [worklist, setWorklist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedBranch, setSelectedBranch] = useState(localStorage.getItem('branch_id') || '1');
  const [printLabel, setPrintLabel] = useState(null);
  const [machines, setMachines] = useState([]);
  const [showAnalyzerPicker, setShowAnalyzerPicker] = useState(false);
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const [currentMachine, setCurrentMachine] = useState(null);
  const [incomingResults, setIncomingResults] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const barcodeRef = useRef(null);

  useEffect(() => {
    fetchWorklist();
    fetchMachines();
    const interval = setInterval(fetchWorklist, 30000);
    return () => clearInterval(interval);
  }, [search, selectedBranch, statusFilter, departmentFilter]);

  useEffect(() => {
    if (printLabel && barcodeRef.current) {
      JsBarcode(barcodeRef.current, printLabel.sampleId, {
        format: 'CODE128', width: 2, height: 50, displayValue: true, fontSize: 14, margin: 10
      });
    }
  }, [printLabel]);

  useEffect(() => {
    const cleanup = window.electronAPI.onTestCompleted((data) => {
      if (showProcessModal) {
        setIncomingResults(prev => [...prev, data]);
      }
    });
    return cleanup;
  }, [showProcessModal]);

  const fetchWorklist = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/lab/worklist`, {
        params: {
          department: departmentFilter,
          branch_id: selectedBranch,
          role_level: 'Branch',
          search: search,
          status: statusFilter !== 'all' ? statusFilter : undefined
        }
      });
      if (res.data.success) setWorklist(res.data.worklist || []);
    } catch (err) { console.error("Error fetching worklist:", err); }
    finally { setLoading(false); }
  };

  const fetchMachines = async () => {
    const configs = await window.electronAPI.getConfig();
    setMachines(Array.isArray(configs) ? configs : []);
  };

  const handleRunTestRequest = (item) => {
    if (machines.length === 0) return alert("Please configure an analyzer first.");
    setActiveItem(item);
    if (machines.length === 1) {
      initiateProcessing(item, machines[0]);
    } else {
      setShowAnalyzerPicker(true);
    }
  };

  const initiateProcessing = async (item, machine) => {
    setCurrentMachine(machine);
    setActiveItem(item);
    setShowAnalyzerPicker(false);
    setShowProcessModal(true);
    setIncomingResults([]);

    try {
      // No protocol pre-fetch, no parameter pre-mapping — just start listening
      // and take whatever the analyzer sends. The main-process parsers
      // (serialManager/tcpManager) already save each result to the backend
      // as it arrives (see syncSession), keyed to this sample/bill item, and
      // merge by parameter_name — so re-running against the same sample_id
      // (e.g. to add a parameter the doctor still needs) just appends.
      await axios.post(`${API_BASE}/api/lab/acknowledge-test`, {
        bill_item_id: item.bill_item_id, sample_id: item.sample_id, status: 'In Progress'
      });
      fetchWorklist();

      await window.electronAPI.startListening({
        port: machine.port,
        baud: machine.baud,
        model: machine.model,
        machineId: machine.unique_id || machine.id,
        sampleId: item.sample_id,
        shortId: item.short_id,
        testId: item.bill_item_id,
      });
    } catch (err) {
      console.error("Error starting analyzer session:", err);
      alert("Failed to start listening for this analyzer.");
      setShowProcessModal(false);
    }
  };

  const handleViewProcess = async (item) => {
    if (machines.length === 0) return alert("No machines configured.");
    initiateProcessing(item, machines[0]);
  };

  const handleCloseProcess = async () => {
    await window.electronAPI.stopListening();
    setShowProcessModal(false);
    setActiveItem(null);
    setCurrentMachine(null);
    setIncomingResults([]);
    fetchWorklist();
  };

  const handlePrint = () => {
    const printContent = document.getElementById('barcode-label');
    const win = window.open('', '', 'width=400,height=400');
    win.document.write('<html><head><title>Print Label</title><style>body{font-family:sans-serif;text-align:center;padding:20px;}</style></head><body>');
    win.document.write(printContent.innerHTML);
    win.document.write('</body></html>');
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); setPrintLabel(null); }, 500);
  };

  const statusBadgeClass = (status) => {
    const map = {
      'Pending': 'badge-warning',
      'Collected': 'badge-info',
      'In Progress': 'badge-warning',
      'Test Done': 'badge-success',
      'Partially Done': 'badge-warning',
      'Completed': 'badge-success'
    };
    return map[status] || 'badge-neutral';
  };

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Sample Master List</h1>
          <p className="page-subtitle">Complete Diagnostic Audit Trail</p>
        </div>
        <div className="page-actions">
          <div className="worklist-search-box">
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Search patient or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="control worklist-select">
            <option value="all">All Status</option>
            <option value="Pending">Pending</option>
            <option value="Collected">Collected</option>
            <option value="In Progress">In Progress</option>
            <option value="Test Done">Partially Done</option>
            <option value="Completed">Completed</option>
          </select>

          <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="control worklist-select">
            <option value="all">All Departments</option>
            <option value="Hematology">Hematology</option>
            <option value="Biochemistry">Biochemistry</option>
            <option value="Serology">Serology</option>
            <option value="Microbiology">Microbiology</option>
          </select>

          <button onClick={fetchWorklist} className="btn btn-secondary"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Sample ID</th>
              <th>Patient</th>
              <th>Test Name</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5}><div className="loading-row"><div className="spinner" /> Loading…</div></td></tr>
            ) : worklist.length === 0 ? (
              <tr><td colSpan={5}>
                <div className="empty-state">
                  <div className="empty-state-icon"><Inbox size={26} /></div>
                  <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>No samples found</div>
                </div>
              </td></tr>
            ) : worklist.map((item) => (
              <tr key={item.bill_item_id}>
                <td>
                  <div style={{ fontWeight: 800 }}>{item.sample_id || '---'}</div>
                  {item.short_id && <div style={{ fontSize: 11, color: 'var(--brand-blue)', fontWeight: 700 }}>Short ID: {item.short_id}</div>}
                </td>
                <td>
                  <div style={{ fontWeight: 700 }}>{item.patient_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.patient_reg_no}</div>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{item.test_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.sample_type}</div>
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className={`badge ${statusBadgeClass((item.status === 'Test Done' && item.pending_params?.length > 0) ? 'Partially Done' : item.status)}`} style={{ width: 'fit-content' }}>
                      {(item.status === 'Test Done' && item.pending_params?.length > 0) ? 'Partially Done' : item.status}
                    </span>
                    {item.pending_params && item.pending_params.length > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600, maxWidth: 120, display: 'flex', gap: 3 }}>
                        <Hourglass size={10} /> Waiting: {item.pending_params.join(', ')}
                      </div>
                    )}
                  </div>
                </td>
                <td>
                  <button onClick={() => handleViewProcess(item)} className="btn btn-sm" style={{ background: 'var(--text-primary)', color: '#fff' }}>
                    <Eye size={14} /> View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Analyzer Selection Modal */}
      {showAnalyzerPicker && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ width: 450, padding: 32 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800 }}>Select Machine</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
              {machines.map(m => (
                <button key={m.id} onClick={() => initiateProcessing(activeItem, m)} className="dash-machine-option">
                  <div style={{ fontWeight: 800 }}>{m.unique_id}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.manufacturer} {m.model}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Process Modal */}
      {showProcessModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ width: 850, padding: 40 }}>
            <div className="flex-between" style={{ marginBottom: 28 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{activeItem?.test_name}</h2>
                <div style={{ color: 'var(--text-muted)' }}>Sample: {activeItem?.sample_id} | Analyzer: {currentMachine?.unique_id}</div>
              </div>
              <span className="badge badge-success"><Radio size={12} /> Intelligent Sync</span>
            </div>

            <div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Live Result Stream</h3>
                <div className="worklist-live-stream">
                  {incomingResults.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '100px 0', opacity: 0.4 }}>
                      <Satellite size={32} style={{ marginBottom: 16 }} />
                      Waiting for data from {currentMachine?.unique_id}...
                    </div>
                  ) : (
                    incomingResults.map((res, i) => (
                      <div key={i} className="worklist-stream-row" style={{
                        background: res.flag === 'H' ? 'rgba(239, 68, 68, 0.05)' : res.flag === 'L' ? 'rgba(59, 130, 246, 0.05)' : 'transparent'
                      }}>
                        <span style={{ color: res.flag === 'H' ? '#ef4444' : res.flag === 'L' ? '#3b82f6' : '#38bdf8' }}>
                          {res.test_name} {res.flag && res.flag !== 'N' ? `(${res.flag})` : ''}
                        </span>
                        <span style={{ color: res.flag === 'H' ? '#ef4444' : res.flag === 'L' ? '#3b82f6' : '#fff', fontWeight: 800 }}>
                          {res.result_value} {res.unit}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <button onClick={handleCloseProcess} className="btn btn-primary" style={{ width: '100%', marginTop: 20, padding: 16 }}>
                  Complete &amp; Close Session
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Modal */}
      {printLabel && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ width: 400, padding: 32, textAlign: 'center' }}>
            <h3>Sample Label</h3>
            <div id="barcode-label" className="worklist-barcode-body">
              <div style={{ fontWeight: 800, marginBottom: 4 }}>{printLabel.patientName}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--brand-blue)', marginBottom: 8 }}>
                ID: {printLabel.shortId}
              </div>
              <svg ref={barcodeRef}></svg>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={handlePrint} className="btn btn-primary" style={{ flex: 1, padding: 12 }}>Print</button>
              <button onClick={() => setPrintLabel(null)} className="btn btn-secondary" style={{ flex: 1, padding: 12 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SampleList;
