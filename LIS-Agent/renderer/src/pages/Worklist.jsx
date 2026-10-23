import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import JsBarcode from 'jsbarcode';
import {
  FlaskConical, Printer, Clock, Activity, Hourglass, RotateCcw,
  RefreshCw, Search, X, Download, Loader2, Inbox, Play, Eye, Satellite, Radio, Timer, Flame, Keyboard
} from 'lucide-react';
import ManualEntryModal from '../components/ManualEntryModal';
import { useManualReasons, ReasonPicker, reasonComplete } from '../components/ManualReason';
import '../assets/CSS/Worklist.css';
import { API_BASE } from '../apiBase';

// ─── Inline barcode for table rows ────────────────────────────────────────────
const BarcodeImage = ({ value }) => {
  const svgRef = useRef(null);
  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width: 1.5,
          height: 35,
          displayValue: false,
          margin: 0,
          background: 'transparent',
          lineColor: '#0f172a'
        });
      } catch(e) { console.error('Barcode render error', e); }
    }
  }, [value]);
  return <svg ref={svgRef}></svg>;
};

// ─── Self-contained Barcode Popup Modal ───────────────────────────────────────
// Owns its own ref so JsBarcode always targets a fresh mounted <svg>.
const BarcodeModal = ({ printLabel, onClose }) => {
  const barcodeRef = useRef(null);

  useEffect(() => {
    if (barcodeRef.current && (printLabel.shortId || printLabel.sampleId)) {
      try {
        JsBarcode(barcodeRef.current, printLabel.shortId || printLabel.sampleId, {
          format: 'CODE128',
          width: 2,
          height: 60,
          displayValue: true,
          fontSize: 14,
          margin: 10,
          background: '#ffffff',
          lineColor: '#0f172a'
        });
      } catch(e) { console.error('Barcode modal render error', e); }
    }
  }, [printLabel]);

  const handlePrint = () => {
    const printContent = document.getElementById('barcode-label-content');
    const win = window.open('', '', 'width=450,height=500');
    win.document.write(`
      <html>
        <head>
          <title>Print Label</title>
          <style>
            body { font-family: sans-serif; text-align: center; padding: 24px; background: #fff; }
          </style>
        </head>
        <body>${printContent.innerHTML}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); onClose(); }, 500);
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ width: 420 }}>
        <div className="worklist-barcode-header">
          <div>
            <div className="worklist-barcode-eyebrow">Sample Label</div>
            <div className="worklist-barcode-name">{printLabel.patientName}</div>
          </div>
          <button onClick={onClose} className="worklist-barcode-close"><X size={18} /></button>
        </div>

        <div style={{ padding: 28 }}>
          <div id="barcode-label-content" className="worklist-barcode-body">
            <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', marginBottom: 2 }}>
              {printLabel.patientName}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--brand-blue)', marginBottom: 2, fontFamily: 'monospace' }}>
              ID: {printLabel.shortId}
            </div>
            {printLabel.sampleType && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14, fontWeight: 600 }}>
                {printLabel.sampleType}
              </div>
            )}
            <svg ref={barcodeRef} style={{ maxWidth: '100%' }}></svg>
          </div>

          {printLabel.testName && (
            <div className="worklist-barcode-test">
              <FlaskConical size={16} color="var(--brand-blue)" />
              <div>
                <div style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700, letterSpacing: 0.5 }}>TEST</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>{printLabel.testName}</div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handlePrint} className="btn btn-primary" style={{ flex: 1, padding: 14 }}>
              <Printer size={16} /> Print Label
            </button>
            <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1, padding: 14 }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main Worklist Component ───────────────────────────────────────────────────
const fmtMins = (m) => (m == null ? '—' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`);
const STEP_LABELS = ['Ordered', 'Collected', 'Received', 'Processing', 'Resulted'];
const NO_EXTRA = { priority: '', analyzer: '', test_id: '', min_age: '', tat: '' };

const Worklist = () => {
  const [worklist, setWorklist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedBranch, setSelectedBranch] = useState(localStorage.getItem('branch_id') || '1');
  const [printLabel, setPrintLabel] = useState(null);
  // Results typed by hand (tender #33): the test being typed, and the reason
  // required when a captured value is changed by hand.
  const [manualItem, setManualItem] = useState(null);
  const manualReasons = useManualReasons();
  const [editCode, setEditCode] = useState('');
  const [editNote, setEditNote] = useState('');
  const [machines, setMachines] = useState([]);
  const [showAnalyzerPicker, setShowAnalyzerPicker] = useState(false);
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const [currentMachine, setCurrentMachine] = useState(null);
  const [incomingResults, setIncomingResults] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [cdacCrNo, setCdacCrNo] = useState('');
  const [cdacPulling, setCdacPulling] = useState(false);
  const lastCdacPullAttemptRef = useRef('');
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  // Set when the list on screen is the copy saved at the last successful refresh (no network).
  const [offlineCopy, setOfflineCopy] = useState(null);
  const [extra, setExtra] = useState(NO_EXTRA);
  const [summary, setSummary] = useState(null);
  const [labAnalyzers, setLabAnalyzers] = useState([]);
  const [knownTests, setKnownTests] = useState({});
  const versionRef = useRef(null);

  useEffect(() => {
    fetchWorklist();
    fetchMachines();
  }, [search, selectedBranch, statusFilter, departmentFilter, extra]);

  // Near-real-time: the server bumps a per-facility counter whenever a sample
  // is received, run or resulted, or an order/transfer arrives. Checking it is
  // cheap, so poll every 5 s and reload only when it moves; a slower full
  // reload keeps ages and TAT fresh.
  useEffect(() => {
    const check = setInterval(async () => {
      try {
        const r = await axios.get(`${API_BASE}/api/lab/worklist/version`, { params: { branch_id: selectedBranch } });
        if (r.data?.success && versionRef.current && r.data.version !== versionRef.current) fetchWorklist(true);
      } catch { /* next tick */ }
    }, 5000);
    const full = setInterval(() => fetchWorklist(true), 60000);
    return () => { clearInterval(check); clearInterval(full); };
  }, [search, selectedBranch, statusFilter, departmentFilter, extra]);

  useEffect(() => {
    const cleanupTest = window.electronAPI.onTestCompleted((data) => {
      if (showProcessModal) {
        setIncomingResults(prev => [...prev, data]);
      }
    });
    const cleanupPanel = window.electronAPI.onPanelComplete(async (data) => {
      if (showProcessModal) {
        try {
          const res = await axios.get(`${API_BASE}/api/lab/test-results/${data.sampleId}`);
          if (res.data.success) {
            setIncomingResults(res.data.results);
          }
        } catch (err) {
          console.error("Error fetching completed panel results:", err);
        }
      }
    });
    return () => {
      cleanupTest();
      cleanupPanel();
    };
  }, [showProcessModal]);

  useEffect(() => {
    const cleanupDeviceStatus = window.electronAPI.onDeviceStatus((data) => {
      setMachines(prevMachines => prevMachines.map(m => {
        if (m.port === data.port) {
          return { ...m, connectionStatus: data.status };
        }
        return m;
      }));
    });
    return () => {
      cleanupDeviceStatus();
    };
  }, []);

  const fetchWorklist = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await axios.get(`${API_BASE}/api/lab/worklist`, {
        params: {
          department: departmentFilter,
          branch_id: selectedBranch,
          role_level: 'Branch',
          search: search,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          priority: extra.priority || undefined,
          analyzer: extra.analyzer || undefined,
          test_id: extra.test_id || undefined,
          min_age: extra.min_age || undefined,
          tat: extra.tat || undefined,
        }
      });
      if (res.data.success) {
        setWorklist(res.data.worklist || []);
        setSummary(res.data.summary || null);
        setLabAnalyzers(res.data.analyzers || []);
        versionRef.current = res.data.version;
        setKnownTests((prev) => {
          const next = { ...prev };
          (res.data.worklist || []).forEach((w) => { next[w.test_id] = w.test_name; });
          return next;
        });
        setLastUpdated(new Date());
        setOfflineCopy(null);
        // Keep the unfiltered list so the worklist can still be read during an outage.
        if (!search && statusFilter === 'all' && departmentFilter === 'all') {
          try { localStorage.setItem(`worklist_saved_${selectedBranch}`, JSON.stringify({ at: new Date().toISOString(), worklist: res.data.worklist || [], summary: res.data.summary || null })); } catch { /* storage full or blocked */ }
        }
      }
    } catch (err) {
      console.error("Error fetching worklist:", err);
      try {
        const saved = JSON.parse(localStorage.getItem(`worklist_saved_${selectedBranch}`) || 'null');
        if (saved?.worklist) {
          const q = search.trim().toLowerCase();
          setWorklist(q ? saved.worklist.filter((w) => JSON.stringify(w).toLowerCase().includes(q)) : saved.worklist);
          setSummary(saved.summary || null);
          setOfflineCopy(saved.at);
        }
      } catch { /* no saved copy */ }
    }
    finally { setLoading(false); setRefreshing(false); }
  };

  // Pulls a patient's CDAC-ordered investigations (API1, via our backend)
  // and materializes them as a local bill — same call HIMS-frontend's
  // SampleList/LabWorklist make. Only applies to branches configured for
  // CDAC (see branch_hmis_config / the CDAC Mapping settings page).
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
      const res = await axios.post(`${API_BASE}/api/cdac/pull-order`, {
        branch_id: selectedBranch,
        hmis_patCrNo: cdacCrNo.trim()
      });
      const data = res.data;
      let message = data.message || (data.success ? `Pulled ${data.items?.length || 0} test(s) from CDAC` : 'Failed to pull CDAC order');
      if (data.invalidItems?.length) {
        message += '\n\nSkipped (missing data from CDAC): ' + data.invalidItems.map(i => `${i.hmis_test_name || i.hmis_req_dno || 'unknown'} (${i.reason})`).join(', ');
      }
      alert(message);
      if (data.success) {
        setCdacCrNo('');
        fetchWorklist();
      }
    } catch (err) {
      console.error('Error pulling CDAC order:', err);
      alert(err.response?.data?.message || 'Failed to pull CDAC order');
    } finally {
      setCdacPulling(false);
      lastCdacPullAttemptRef.current = '';
    }
  };

  const fetchMachines = async () => {
    const configs = await window.electronAPI.getConfig();
    setMachines(Array.isArray(configs) ? configs : []);
  };

  const handleAcknowledge = async (item) => {
    try {
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
      const resId = await axios.post(`${API_BASE}/api/lab/generate-sample-id`, {
        branch_id: localStorage.getItem('branch_id') || '1',
        department: item.department
      });
      if (resId.data.success) {
        const { sampleId, shortId } = resId.data;
        const resAck = await axios.post(`${API_BASE}/api/lab/acknowledge-test`, {
          bill_item_id: item.bill_item_id,
          sample_id: sampleId,
          short_id: shortId,
          status: 'Collected'
        });
        if (resAck.data.success) {
          setPrintLabel({ sampleId, shortId, patientName: item.patient_name, testName: item.test_name, sampleType: item.sample_type });
          fetchWorklist();
        }
      }
    } catch (err) { console.error("Acknowledge error:", err); }
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
    setEditCode(''); setEditNote('');
    await window.electronAPI.stopListening();
    setShowProcessModal(false);
    setActiveItem(null);
    setCurrentMachine(null);
    setIncomingResults([]);
    setHasUnsavedChanges(false);
    fetchWorklist();
  };

  const handleSaveEdits = async () => {
    if (!activeItem || incomingResults.length === 0) return;
    // Changing a captured value by hand needs a reason (recorded in the audit trail).
    if (!reasonComplete(manualReasons, editCode, editNote)) return alert('Choose a reason for changing the captured value.');
    try {
      const payload = {
        sample_id: activeItem.sample_id,
        machine_no: currentMachine?.unique_id,
        bill_item_id: activeItem.bill_item_id,
        test_id: activeItem.test_id,
        test_name: activeItem.test_name,
        entry_mode: 'edited',
        manual_reason_code: editCode,
        manual_reason: editNote.trim(),
        results: incomingResults.map(r => ({
          parameter_name: r.parameter_name || r.test_name || r.parameter,
          result_value: r.result_value || r.value,
          unit: r.unit || '',
          reference_range: r.reference_range || r.ref_range || '',
          flag: r.flag || ''
        }))
      };
      const res = await axios.post(`${API_BASE}/api/lab/save-test-results`, payload);
      if (res.data.success) {
        setHasUnsavedChanges(false);
        alert("Results updated successfully!");
        handleCloseProcess();
      }
    } catch (err) {
      console.error("Error saving edited results:", err);
      alert(err.response?.data?.message || "Failed to save edited results.");
    }
  };

  const handleResultChange = (index, value) => {
    const newResults = [...incomingResults];
    newResults[index].result_value = value;
    setIncomingResults(newResults);
    setHasUnsavedChanges(true);
  };

  const statusBadgeClass = (status) => {
    const map = {
      'Pending': 'badge-warning',
      'Collected': 'badge-info',
      'In Progress': 'badge-warning',
      'Test Done': 'badge-success',
      'Partially Done': 'badge-warning',
      'Completed': 'badge-success',
      'Rerun Requested': 'badge-warning'
    };
    return map[status] || 'badge-neutral';
  };

  const displayStatus = (item) =>
    (item.status === 'Test Done' && item.pending_params?.length > 0)
      ? 'Partially Done'
      : (item.status === 'Collected' ? 'Pending' : item.status);

  const activeWorklist = worklist.filter(item => {
    const baseFilter = ['Pending', 'Collected', 'In Progress', 'Test Done', 'Rerun Requested'].includes(item.status);
    if (statusFilter !== 'all') {
      if (statusFilter === 'Test Done') {
        return item.status === 'Test Done' && item.pending_params?.length > 0;
      }
      return item.status === statusFilter;
    }
    return baseFilter;
  });

  // Quick-glance workload counts, computed from the unfiltered worklist so the
  // stat cards always reflect the whole queue regardless of the active filter.
  const stats = worklist.reduce((acc, item) => {
    const key = displayStatus(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const STAT_CARDS = [
    { key: 'Pending', label: 'Pending', Icon: Clock, color: '#9a3412', bg: 'var(--color-warning-bg)' },
    { key: 'In Progress', label: 'In Progress', Icon: Activity, color: '#854d0e', bg: '#fef9c3' },
    { key: 'Partially Done', label: 'Partially Done', Icon: Hourglass, color: '#c2410c', bg: 'var(--color-warning-bg)' },
    { key: 'Rerun Requested', label: 'Rerun Requested', Icon: RotateCcw, color: '#b45309', bg: '#fffbeb' },
  ];
  const TAT_CARDS = summary ? [
    { label: 'TAT breached', value: summary.breached, Icon: Timer, color: '#b91c1c', bg: 'var(--color-danger-bg)', apply: { ...NO_EXTRA, tat: 'breached' } },
    { label: 'At risk', value: summary.at_risk, Icon: Timer, color: '#b45309', bg: 'var(--color-warning-bg)', apply: { ...NO_EXTRA, tat: 'at_risk' } },
    { label: 'STAT', value: summary.stat, Icon: Flame, color: '#b91c1c', bg: 'var(--color-danger-bg)', apply: { ...NO_EXTRA, priority: 'STAT' } },
  ] : [];
  const extraCount = Object.values(extra).filter(Boolean).length;

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Lab Worklist</h1>
          <p className="page-subtitle">Smart Diagnostic Command Center</p>
        </div>
        <div className="flex-row gap-12">
          {offlineCopy && (
            <span style={{ fontSize: 12, fontWeight: 700, color: '#92400e', background: '#fef3c7', padding: '4px 10px', borderRadius: 8 }}>
              Offline — showing the list saved at {new Date(offlineCopy).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Results from analyzers are still being captured.
            </span>
          )}
          {lastUpdated && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
              {refreshing ? 'Refreshing…' : `Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            </span>
          )}
          <button onClick={fetchWorklist} disabled={refreshing} className="btn btn-secondary">
            <RefreshCw size={14} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Workload at a glance ── */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 20 }}>
        {STAT_CARDS.map(card => (
          <div key={card.key} className="stat-card" style={{ '--stat-icon-bg': card.bg, '--stat-icon-color': card.color, padding: '14px 18px' }}>
            <div className="stat-icon" style={{ width: 38, height: 38 }}><card.Icon size={18} /></div>
            <div className="stat-body">
              <span className="stat-value" style={{ fontSize: 20 }}>{stats[card.key] || 0}</span>
              <span className="stat-label">{card.label}</span>
            </div>
          </div>
        ))}
        {TAT_CARDS.map(card => (
          <button key={card.label} className="stat-card wl-card-btn" onClick={() => setExtra(card.apply)}
            style={{ '--stat-icon-bg': card.bg, '--stat-icon-color': card.color, padding: '14px 18px' }}>
            <div className="stat-icon" style={{ width: 38, height: 38 }}><card.Icon size={18} /></div>
            <div className="stat-body">
              <span className="stat-value" style={{ fontSize: 20 }}>{card.value}</span>
              <span className="stat-label">{card.label}</span>
            </div>
          </button>
        ))}
      </div>

      {/* ── Toolbar: filters (left) + CDAC pull action (right, visually separated) ── */}
      <div className="card flex-between worklist-toolbar">
        <div className="flex-row gap-12" style={{ flexWrap: 'wrap' }}>
          <div className="worklist-search-box">
            <Search size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search patient or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} title="Clear search" className="worklist-clear-btn"><X size={14} /></button>
            )}
          </div>

          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="control worklist-select">
            <option value="all">All Status</option>
            <option value="Pending">Pending</option>
            <option value="Collected">Collected</option>
            <option value="In Progress">In Progress</option>
            <option value="Test Done">Partially Done</option>
          </select>

          <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="control worklist-select">
            <option value="all">All Departments</option>
            <option value="Hematology">Hematology</option>
            <option value="Biochemistry">Biochemistry</option>
            <option value="Serology">Serology</option>
            <option value="Microbiology">Microbiology</option>
          </select>

          <select value={extra.priority} onChange={(e) => setExtra({ ...extra, priority: e.target.value })} className="control worklist-select">
            <option value="">All Priority</option><option>STAT</option><option>Urgent</option><option>Routine</option>
          </select>
          <select value={extra.analyzer} onChange={(e) => setExtra({ ...extra, analyzer: e.target.value })} className="control worklist-select">
            <option value="">All Analyzers</option>
            {labAnalyzers.map((a) => <option key={a.name} value={a.name}>{a.name} ({a.model})</option>)}
          </select>
          <select value={extra.test_id} onChange={(e) => setExtra({ ...extra, test_id: e.target.value })} className="control worklist-select">
            <option value="">All Tests</option>
            {Object.entries(knownTests).sort((x, y) => x[1].localeCompare(y[1])).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
          <select value={extra.min_age} onChange={(e) => setExtra({ ...extra, min_age: e.target.value })} className="control worklist-select">
            <option value="">Any Age</option><option value="1">Waiting &gt; 1 hour</option><option value="4">Waiting &gt; 4 hours</option><option value="12">Waiting &gt; 12 hours</option><option value="24">Waiting &gt; 1 day</option>
          </select>
          <select value={extra.tat} onChange={(e) => setExtra({ ...extra, tat: e.target.value })} className="control worklist-select">
            <option value="">All Turnaround</option><option value="at_risk">At risk or breached</option><option value="breached">Breached only</option>
          </select>

          {(search || statusFilter !== 'all' || departmentFilter !== 'all' || extraCount > 0) && (
            <button onClick={() => { setSearch(''); setStatusFilter('all'); setDepartmentFilter('all'); setExtra(NO_EXTRA); }} className="btn btn-ghost btn-sm" style={{ color: 'var(--brand-blue)' }}>
              Clear filters
            </button>
          )}
        </div>

        <div className="flex-row gap-12 worklist-cdac">
          <div className="worklist-cdac-box">
            <Download size={14} color="var(--brand-purple)" style={{ flexShrink: 0 }} />
            <input
              type="text"
              placeholder="CDAC CR Number"
              value={cdacCrNo}
              onChange={(e) => setCdacCrNo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePullCdacOrder()}
              onBlur={() => handlePullCdacOrder({ silent: true })}
            />
          </div>
          <button
            onClick={handlePullCdacOrder}
            disabled={cdacPulling}
            className="btn"
            style={{ background: 'var(--brand-purple)', color: '#fff', opacity: cdacPulling ? 0.6 : 1 }}
          >
            {cdacPulling ? 'Fetching...' : 'Fetch CDAC Order'}
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="card" style={{ overflow: 'hidden' }}>
        {!loading && (
          <div style={{ padding: '12px 24px', fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, borderBottom: '1px solid var(--border-subtle)' }}>
            {activeWorklist.length} {activeWorklist.length === 1 ? 'item' : 'items'} in queue
          </div>
        )}
        <div className="table-scroll" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Sample ID</th>
              <th>Barcode</th>
              <th>Patient</th>
              <th>Test Name</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Analyzer</th>
              <th>TAT</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9}>
                <div className="loading-row" style={{ flexDirection: 'column' }}>
                  <Loader2 size={28} style={{ animation: 'spin 0.8s linear infinite' }} />
                  <div>Loading worklist…</div>
                </div>
              </td></tr>
            ) : activeWorklist.length === 0 ? (
              <tr><td colSpan={9}>
                <div className="empty-state">
                  <div className="empty-state-icon"><Inbox size={26} /></div>
                  <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>No matching items</div>
                  <div style={{ fontSize: 13 }}>
                    {search || statusFilter !== 'all' || departmentFilter !== 'all' || extraCount > 0
                      ? 'Try adjusting your search or filters.'
                      : 'The worklist is empty right now.'}
                  </div>
                </div>
              </td></tr>
            ) : activeWorklist
              .map((item) => (
                <tr key={item.bill_item_id}>
                  <td>
                    <div style={{ fontWeight: 800 }}>{item.sample_id || '---'}</div>
                    {item.short_id && <div style={{ fontSize: 11, color: 'var(--brand-blue)', fontWeight: 700 }}>Short ID: {item.short_id}</div>}
                  </td>
                  <td>
                    {item.short_id ? (
                      <div
                        className="worklist-barcode-cell"
                        onClick={() => setPrintLabel({
                          sampleId: item.sample_id,
                          shortId: item.short_id,
                          patientName: item.patient_name,
                          testName: item.test_name,
                          sampleType: item.sample_type
                        })}
                        title="Click to view & print barcode label"
                      >
                        <BarcodeImage value={item.short_id} />
                        <div style={{ fontSize: 10, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-secondary)', marginTop: 2, marginLeft: 2 }}>
                          {item.short_id}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1, marginLeft: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Printer size={9} /> Click to print
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>---</div>
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {item.patient_name}
                      {item.priority === 'STAT' && <span className="badge badge-danger">STAT</span>}
                      {item.priority === 'Urgent' && <span className="badge badge-warning">Urgent</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.reg_no || item.patient_reg_no}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.test_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.sample_type}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span className={`badge ${statusBadgeClass(displayStatus(item))}`} style={{ width: 'fit-content' }}>
                        <span className="badge-dot" />
                        {displayStatus(item)}
                      </span>
                      {(item.has_critical || item.has_invalid || item.has_delta) ? (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {!!item.has_critical && <span className="badge badge-danger">Critical</span>}
                          {!!item.has_invalid && <span className="badge badge-neutral">Invalid</span>}
                          {!!item.has_delta && <span className="badge badge-info">Delta</span>}
                        </div>
                      ) : null}
                      {item.pending_params && item.pending_params.length > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600, maxWidth: 120, display: 'flex', alignItems: 'flex-start', gap: 3 }}>
                          <Hourglass size={10} style={{ marginTop: 1, flexShrink: 0 }} /> Waiting: {item.pending_params.join(', ')}
                        </div>
                      )}
                      {item.status === 'Rerun Requested' && item.rerun_reason && (
                        <div style={{ fontSize: 10, color: '#b45309', fontWeight: 600, maxWidth: 160 }}>
                          Doctor: "{item.rerun_reason}"
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="wl-steps">{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= item.progress_step ? 'on' : ''} />)}</div>
                    <div className="wl-step-label">
                      {STEP_LABELS[item.progress_step - 1]}{item.parameters_total > 0 && ` · ${item.parameters_received}/${item.parameters_total}`}
                    </div>
                    {item.referred_from && <div className="wl-step-label">From {item.referred_from}</div>}
                    {item.recollection_status === 'Recollection Pending' && <div className="wl-step-label bad">Recollect: {item.recollection_reason}</div>}
                  </td>
                  <td>
                    {item.analyzer
                      ? <div className="wl-analyzer"><span className="wl-dot on" />{item.analyzer}</div>
                      : <div className="wl-analyzer"><span className={`wl-dot ${item.analyzer_status === 'Online' ? 'on' : item.analyzer_status === 'Offline' ? 'off' : ''}`} />
                          {item.analyzer_status === 'Not mapped' ? 'None set up' : `${item.analyzers_online}/${item.analyzers_total} online`}</div>}
                    {item.reagent_warnings?.some((r) => r.state === 'Expired') && (
                      <div className="wl-step-label bad" title={item.reagent_warnings.filter((r) => r.state === 'Expired').map((r) => `${r.analyzer}: ${r.reagent} lot ${r.lot} expired`).join('\n')}>Reagent expired</div>
                    )}
                    {item.maintenance_overdue?.length > 0 && (
                      <div className="wl-step-label bad" title={item.maintenance_overdue.map((m) => `${m.analyzer}: ${m.task} (${m.days_overdue}d overdue)`).join('\n')}>Maintenance overdue</div>
                    )}
                    {item.current_lab_name && <div className="wl-step-label">{item.current_lab_name}</div>}
                  </td>
                  <td>
                    <span className={`wl-tat wl-tat-${item.tat_status.toLowerCase().replace(' ', '-')}`}>{item.tat_status}</span>
                    <div className="wl-step-label">
                      {item.is_open ? `${fmtMins(item.age_minutes)} of ${fmtMins(item.tat_minutes)}` : `Took ${fmtMins(item.turnaround_minutes)}`}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {item.status === 'Pending' ? (
                      <button onClick={() => handleAcknowledge(item)} className="btn btn-primary btn-sm">Acknowledge</button>
                    ) : item.status === 'Collected' ? (
                      <button onClick={() => handleRunTestRequest(item)} className="btn btn-sm" style={{ background: 'var(--color-success)', color: '#fff' }}><Play size={14} /> Run Test</button>
                    ) : item.status === 'Rerun Requested' ? (
                      <button onClick={() => handleRunTestRequest(item)} className="btn btn-sm" style={{ background: 'var(--color-warning)', color: '#fff' }}><RotateCcw size={14} /> Rerun Test</button>
                    ) : (
                      <button onClick={() => handleViewProcess(item)} className="btn btn-sm" style={{ background: 'var(--text-primary)', color: '#fff' }}><Eye size={14} /> View</button>
                    )}
                    {['Collected', 'In Progress', 'Rerun Requested'].includes(item.status) && (
                      <button onClick={() => setManualItem(item)} className="btn btn-sm btn-secondary" title="Type the result in by hand (a reason is required)"><Keyboard size={14} /> Type result</button>
                    )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* ── Analyzer Selection Modal ── */}
      {showAnalyzerPicker && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ width: 450, padding: 32 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800 }}>Select Machine</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
              {machines.map(m => (
                <button key={m.id} onClick={() => initiateProcessing(activeItem, m)} className="dash-machine-option flex-between">
                  <div>
                    <div style={{ fontWeight: 800 }}>{m.unique_id}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.manufacturer} {m.model}</div>
                  </div>
                  <span className={`badge ${m.connectionStatus === 'Connected' ? 'badge-success' : m.connectionStatus === 'Disconnected' ? 'badge-danger' : 'badge-warning'}`}>
                    {m.connectionStatus || 'Listening'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Process Modal ── */}
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
              {/* Live Result Stream — whatever the analyzer sends, as it arrives */}
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Live Result Stream</h3>
                <div className="worklist-live-stream">
                  {incomingResults.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '100px 0', opacity: 0.4 }}>
                      <Satellite size={32} style={{ marginBottom: 16 }} />
                      <div>Waiting for data from {currentMachine?.unique_id}...</div>
                    </div>
                  ) : (
                    incomingResults.map((res, i) => (
                      <div key={i} className="worklist-stream-row" style={{
                        background: res.flag === 'H' ? 'rgba(239, 68, 68, 0.05)' : res.flag === 'L' ? 'rgba(59, 130, 246, 0.05)' : 'transparent'
                      }}>
                        <span style={{ color: res.flag === 'H' ? '#ef4444' : res.flag === 'L' ? '#3b82f6' : '#38bdf8' }}>
                          {res.parameter_name || res.test_name} {res.flag && res.flag !== 'N' ? `(${res.flag})` : ''}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="text"
                            value={res.result_value}
                            onChange={(e) => handleResultChange(i, e.target.value)}
                            className="worklist-stream-input"
                            style={{ color: res.flag === 'H' ? '#ef4444' : res.flag === 'L' ? '#3b82f6' : '#fff' }}
                          />
                          <span style={{ color: '#94a3b8' }}>{res.unit}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {hasUnsavedChanges && (
                  <div style={{ marginTop: 16 }}>
                    <ReasonPicker dark reasons={manualReasons} code={editCode} note={editNote} onCode={setEditCode} onNote={setEditNote} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                  {hasUnsavedChanges && (
                    <button onClick={handleSaveEdits} disabled={!reasonComplete(manualReasons, editCode, editNote)} className="btn" style={{ flex: 1, padding: 15, background: 'var(--color-success)', color: '#fff', opacity: reasonComplete(manualReasons, editCode, editNote) ? 1 : 0.5 }}>
                      Save Edits
                    </button>
                  )}
                  <button onClick={handleCloseProcess} className="btn" style={{ flex: 1, padding: 15, background: '#334155', color: '#fff' }}>
                    Close Session
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {manualItem && (
        <ManualEntryModal item={manualItem} onClose={() => setManualItem(null)} onSaved={() => fetchWorklist()} />
      )}

      {/* ── Barcode Popup Modal (self-contained, owns its own ref) ── */}
      {printLabel && (
        <BarcodeModal
          printLabel={printLabel}
          onClose={() => setPrintLabel(null)}
        />
      )}
    </div>
  );
};

export default Worklist;
