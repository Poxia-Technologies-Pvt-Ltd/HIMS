import { useState, useEffect } from 'react';
import { Wand2, Upload, Check, MapPin, RefreshCw, ChevronRight } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

const STATUS_COLORS = { Mapped: '#22c55e', Placeholder: '#f59e0b', Unmapped: '#ef4444' };

// Minimal CSV parser — handles quoted fields with embedded commas, good enough
// for a flat code-mapping export (test_code, parameter_name, parameter_code, ...).
function parseCsv(text) {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];

  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else cur += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    return row;
  });
}

const thStyle = { textAlign: 'left', padding: '10px 12px', fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' };
const tdStyle = { padding: '10px 12px', fontSize: '13px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' };
const badgeStyle = (status) => ({
  display: 'inline-block', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700,
  color: '#fff', background: STATUS_COLORS[status] || '#94a3b8',
});
const btnStyle = { padding: '8px 16px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' };
const inputStyle = { padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', width: '120px' };

export default function CdacMapping() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [activeTab, setActiveTab] = useState('tests'); // 'tests' | 'parameters'

  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(localStorage.getItem('branch_id') || '1');

  // Branch config
  const [branchConfig, setBranchConfigState] = useState(null);
  const [branchConfigDraft, setBranchConfigDraft] = useState({ integration_type: 'CDAC', hmis_hosp_mapping_code: '', is_active: true });
  const [savingBranchConfig, setSavingBranchConfig] = useState(false);

  // Test mapping
  const [testMappings, setTestMappings] = useState([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [autoMapping, setAutoMapping] = useState(false);
  const [autoMapResult, setAutoMapResult] = useState(null);
  const [allLabTests, setAllLabTests] = useState([]);
  const [overrideChoice, setOverrideChoice] = useState({});

  // Parameter mapping
  const [paramOverview, setParamOverview] = useState([]);
  const [loadingParams, setLoadingParams] = useState(false);
  const [selectedTestCode, setSelectedTestCode] = useState(null);
  const [testParameters, setTestParameters] = useState([]);
  const [paramEdits, setParamEdits] = useState({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/branches`, { headers: authHdr() })
      .then((res) => res.json())
      .then((data) => { if (data.success) setBranches((data.branches || []).map((b) => ({ ...b, name: b.branch_name }))); })
      .catch(console.error);
  }, []);

  const loadTestMappings = async () => {
    setLoadingTests(true);
    try {
      const res = await fetch(`${API_BASE}/api/cdac/test-mappings?branch_id=${selectedBranch}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) setTestMappings(data.data || []);
      else showAlert(data.message || 'Failed to load test mappings', 'error');
    } catch {
      showAlert('Failed to load test mappings', 'error');
    } finally {
      setLoadingTests(false);
    }
  };

  const loadAllLabTests = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/lab/tests`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) setAllLabTests(data.tests || []);
    } catch (e) { console.error(e); }
  };

  const loadParamOverview = async () => {
    setLoadingParams(true);
    try {
      const res = await fetch(`${API_BASE}/api/cdac/parameter-mappings?branch_id=${selectedBranch}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) setParamOverview(data.data || []);
      else showAlert(data.message || 'Failed to load parameter mappings', 'error');
    } catch {
      showAlert('Failed to load parameter mappings', 'error');
    } finally {
      setLoadingParams(false);
    }
  };

  const loadBranchConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cdac/branch-config?branch_id=${selectedBranch}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        setBranchConfigState(data.data);
        setBranchConfigDraft({
          integration_type: data.data.integration_type || 'CDAC',
          hmis_hosp_mapping_code: data.data.hmis_hosp_mapping_code || '',
          is_active: !!data.data.is_active,
        });
      }
    } catch {
      showAlert('Failed to load branch config', 'error');
    }
  };

  const saveBranchConfig = async () => {
    setSavingBranchConfig(true);
    try {
      const res = await fetch(`${API_BASE}/api/cdac/branch-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ branch_id: selectedBranch, ...branchConfigDraft }),
      });
      const data = await res.json();
      if (data.success) {
        showAlert('Branch config saved', 'success');
        loadBranchConfig();
      } else {
        showAlert(data.message || 'Failed to save branch config', 'error');
      }
    } catch {
      showAlert('Failed to save branch config', 'error');
    } finally {
      setSavingBranchConfig(false);
    }
  };

  useEffect(() => {
    setAutoMapResult(null);
    setImportResult(null);
    setSelectedTestCode(null);
    loadBranchConfig();
    if (activeTab === 'tests') { loadTestMappings(); loadAllLabTests(); }
    else { loadParamOverview(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedBranch]);

  const handleAutoMap = async () => {
    setAutoMapping(true);
    setAutoMapResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/cdac/test-mappings/auto-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ branch_id: selectedBranch }),
      });
      const data = await res.json();
      if (data.success) {
        setAutoMapResult(data);
        showAlert(`Auto-mapped ${data.autoMapped.length} test(s) exactly, ${data.suggestions.length} suggestion(s) to review`, 'success');
        loadTestMappings();
      } else {
        showAlert(data.message || 'Auto-map failed', 'error');
      }
    } catch {
      showAlert('Auto-map failed', 'error');
    } finally {
      setAutoMapping(false);
    }
  };

  const confirmMapping = async (id, labTestId) => {
    if (!labTestId) { showAlert('Pick a test first', 'error'); return; }
    try {
      const res = await fetch(`${API_BASE}/api/cdac/test-mappings/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ lab_test_id: labTestId }),
      });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message, 'success');
        loadTestMappings();
        setAutoMapResult((prev) => (prev ? { ...prev, suggestions: prev.suggestions.filter((s) => s.id !== id) } : prev));
      } else {
        showAlert(data.message || 'Failed to confirm mapping', 'error');
      }
    } catch {
      showAlert('Failed to confirm mapping', 'error');
    }
  };

  const openTestParameters = async (testCode) => {
    setSelectedTestCode(testCode);
    setParamEdits({});
    try {
      const res = await fetch(`${API_BASE}/api/cdac/parameter-mappings?branch_id=${selectedBranch}&hmis_test_code=${encodeURIComponent(testCode)}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) setTestParameters(data.data || []);
    } catch {
      showAlert('Failed to load parameters', 'error');
    }
  };

  const saveParameterMapping = async (param) => {
    const edit = paramEdits[param.parameter_name] || {};
    try {
      const res = await fetch(`${API_BASE}/api/cdac/parameter-mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          branch_id: selectedBranch,
          hmis_test_code: selectedTestCode,
          parameter_name: param.parameter_name,
          hmis_parameter_code: edit.code ?? param.hmis_parameter_code,
          hmis_parent_parameter_code: edit.parent ?? param.hmis_parent_parameter_code,
          hmis_str_uom: edit.uom ?? param.hmis_str_uom,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showAlert('Parameter mapping saved', 'success');
        openTestParameters(selectedTestCode);
        loadParamOverview();
      } else {
        showAlert(data.message || 'Failed to save', 'error');
      }
    } catch {
      showAlert('Failed to save parameter mapping', 'error');
    }
  };

  const [newParam, setNewParam] = useState({ name: '', code: '', parent: '', uom: '' });

  const addNewParameter = async () => {
    if (!newParam.name.trim()) { showAlert('Enter a parameter name first', 'error'); return; }
    try {
      const res = await fetch(`${API_BASE}/api/cdac/parameter-mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          branch_id: selectedBranch,
          hmis_test_code: selectedTestCode,
          parameter_name: newParam.name.trim(),
          hmis_parameter_code: newParam.code,
          hmis_parent_parameter_code: newParam.parent,
          hmis_str_uom: newParam.uom,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showAlert('Parameter added', 'success');
        setNewParam({ name: '', code: '', parent: '', uom: '' });
        openTestParameters(selectedTestCode);
        loadParamOverview();
      } else {
        showAlert(data.message || 'Failed to add parameter', 'error');
      }
    } catch {
      showAlert('Failed to add parameter', 'error');
    }
  };

  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const res = await fetch(`${API_BASE}/api/cdac/parameter-mappings/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ branch_id: selectedBranch, rows }),
      });
      const data = await res.json();
      if (data.success) {
        setImportResult(data);
        showAlert(`Imported: ${data.mapped} parameter(s) mapped, ${data.skippedNoTest} skipped (test not mapped yet)`, 'success');
        loadParamOverview();
      } else {
        showAlert(data.message || 'Import failed', 'error');
      }
    } catch {
      showAlert('Failed to parse/import CSV', 'error');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const unmappedCount = testMappings.filter((m) => m.mapping_status !== 'Mapped').length;

  return (
    <div style={{ padding: '24px' }}>
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0, fontSize: '22px' }}>
            CDAC Mapping
          </h1>
          <p style={{ color: '#64748b', margin: '4px 0 0' }}>
            One-time, shared setup — mapping a test or parameter here applies to <strong>every branch</strong>, not just the
            one selected below (your test catalog and CDAC's codes aren't branch-specific, so there's no need to redo this
            per hospital). The branch selector only matters for triggering a live sync/pull against CDAC's servers.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MapPin size={16} color="#0369a1" />
          <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} style={{ ...inputStyle, width: '200px' }}>
            {branches.length ? branches.map((b) => (
              <option key={b.branch_id} value={b.branch_id}>{b.name}</option>
            )) : <option value={selectedBranch}>Branch {selectedBranch}</option>}
          </select>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
        <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}>Branch Routing</div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Integration</div>
            <select
              value={branchConfigDraft.integration_type}
              onChange={(e) => setBranchConfigDraft((p) => ({ ...p, integration_type: e.target.value }))}
              style={{ ...inputStyle, width: '110px' }}
            >
              <option value="CDAC">CDAC</option>
              <option value="CARE">CARE</option>
              <option value="NONE">NONE</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>hmis_hosp_mapping_code (from CDAC)</div>
            <input
              value={branchConfigDraft.hmis_hosp_mapping_code}
              onChange={(e) => setBranchConfigDraft((p) => ({ ...p, hmis_hosp_mapping_code: e.target.value }))}
              placeholder="e.g. 10000"
              style={{ ...inputStyle, width: '160px' }}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', paddingBottom: '6px' }}>
            <input
              type="checkbox"
              checked={branchConfigDraft.is_active}
              onChange={(e) => setBranchConfigDraft((p) => ({ ...p, is_active: e.target.checked }))}
            />
            Active
          </label>
          <button onClick={saveBranchConfig} disabled={savingBranchConfig} style={{ ...btnStyle, background: '#0369a1', color: '#fff', opacity: savingBranchConfig ? 0.6 : 1 }}>
            <Check size={14} /> {savingBranchConfig ? 'Saving...' : 'Save'}
          </button>
          {branchConfig && !branchConfig.hmis_hosp_mapping_code && branchConfig.integration_type === 'CDAC' && (
            <span style={{ fontSize: '12px', color: '#dc2626' }}>No hospital code set yet — Fetch Order will fail until this is filled in.</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid #e2e8f0' }}>
        {[{ id: 'tests', label: 'Test Mapping' }, { id: 'parameters', label: 'Parameter Mapping' }].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 700,
              color: activeTab === t.id ? '#0369a1' : '#64748b',
              borderBottom: activeTab === t.id ? '3px solid #0369a1' : '3px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'tests' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              {testMappings.length} CDAC test code(s) cached &middot; {unmappedCount} need mapping
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={loadTestMappings} style={{ ...btnStyle, background: '#f1f5f9', color: '#334155' }}>
                <RefreshCw size={14} /> Refresh
              </button>
              <button onClick={handleAutoMap} disabled={autoMapping} style={{ ...btnStyle, background: '#0369a1', color: '#fff', opacity: autoMapping ? 0.6 : 1 }}>
                <Wand2 size={14} /> {autoMapping ? 'Auto-Mapping...' : 'Run Auto-Map'}
              </button>
            </div>
          </div>

          {autoMapResult && autoMapResult.suggestions.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px', color: '#92400e' }}>
                {autoMapResult.suggestions.length} suggestion(s) need confirmation (not applied automatically)
              </div>
              {autoMapResult.suggestions.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', fontSize: '13px' }}>
                  <span style={{ flex: 1 }}>
                    <strong>{s.hmis_test_name}</strong> ({s.hmis_test_code}) &rarr; <em>{s.suggestedTestName}</em>{' '}
                    <span style={{ color: '#94a3b8' }}>({Math.round(s.score * 100)}% match)</span>
                  </span>
                  <button onClick={() => confirmMapping(s.id, s.suggestedLabTestId)} style={{ ...btnStyle, background: '#22c55e', color: '#fff', padding: '5px 12px' }}>
                    <Check size={12} /> Confirm
                  </button>
                </div>
              ))}
            </div>
          )}

          {loadingTests ? (
            <div>Loading...</div>
          ) : (
            <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>CDAC Test Code</th>
                    <th style={thStyle}>CDAC Test Name</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Mapped To</th>
                    <th style={thStyle}>Manual Override</th>
                  </tr>
                </thead>
                <tbody>
                  {testMappings.map((m) => (
                    <tr key={m.id}>
                      <td style={tdStyle}>{m.hmis_test_code}</td>
                      <td style={tdStyle}>{m.hmis_test_name}</td>
                      <td style={tdStyle}><span style={badgeStyle(m.mapping_status)}>{m.mapping_status}</span></td>
                      <td style={tdStyle}>{m.mapped_test_name || <span style={{ color: '#cbd5e1' }}>&mdash;</span>}</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <select
                            value={overrideChoice[m.id] || ''}
                            onChange={(e) => setOverrideChoice((prev) => ({ ...prev, [m.id]: e.target.value }))}
                            style={{ ...inputStyle, width: '220px' }}
                          >
                            <option value="">-- select test --</option>
                            {allLabTests.map((t) => (
                              <option key={t.id} value={t.id}>{t.test_name} ({t.test_code})</option>
                            ))}
                          </select>
                          <button onClick={() => confirmMapping(m.id, overrideChoice[m.id])} style={{ ...btnStyle, background: '#f1f5f9', color: '#334155', padding: '6px 12px' }}>
                            Set
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'parameters' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              Only tests already mapped (Test Mapping tab) can have their parameters mapped.
            </div>
            <label style={{ ...btnStyle, background: '#0369a1', color: '#fff', opacity: importing ? 0.6 : 1 }}>
              <Upload size={14} /> {importing ? 'Importing...' : 'Import CDAC Parameter CSV'}
              <input type="file" accept=".csv" onChange={handleCsvUpload} disabled={importing} style={{ display: 'none' }} />
            </label>
          </div>

          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px' }}>
            Expected CSV columns: <code>hmis_test_code, parameter_name, hmis_parameter_code, hmis_parent_parameter_code, hmis_str_uom, hmis_lab_code, hmis_sample_code</code>.
            <code>parameter_name</code> is matched against your existing parameter names automatically.
          </div>

          {importResult && (
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', padding: '14px', marginBottom: '16px', fontSize: '13px' }}>
              Import result: <strong>{importResult.mapped}</strong> auto-matched, <strong>{importResult.unmatched}</strong> unmatched (need manual mapping below),{' '}
              <strong>{importResult.skippedNoTest}</strong> skipped (test code not mapped yet — do that in the Test Mapping tab first)
              {importResult.errors?.length > 0 && <div style={{ color: '#dc2626', marginTop: '6px' }}>{importResult.errors.length} row error(s) — check your CSV formatting.</div>}
            </div>
          )}

          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ flex: selectedTestCode ? '0 0 40%' : '1', overflowX: 'auto', background: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              {loadingParams ? (
                <div style={{ padding: '16px' }}>Loading...</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Test</th>
                      <th style={thStyle}>CDAC Codes On File</th>
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paramOverview.map((t) => (
                      <tr
                        key={t.hmis_test_code}
                        onClick={() => openTestParameters(t.hmis_test_code)}
                        style={{ cursor: 'pointer', background: selectedTestCode === t.hmis_test_code ? '#f0f9ff' : 'transparent' }}
                      >
                        <td style={tdStyle}>{t.test_name}<div style={{ fontSize: '11px', color: '#94a3b8' }}>{t.hmis_test_code}</div></td>
                        <td style={tdStyle}>
                          <span style={badgeStyle(Number(t.mapped_parameters) > 0 ? 'Mapped' : 'Unmapped')}>
                            {t.mapped_parameters || 0} parameter(s)
                          </span>
                        </td>
                        <td style={tdStyle}><ChevronRight size={14} color="#94a3b8" /></td>
                      </tr>
                    ))}
                    {!loadingParams && paramOverview.length === 0 && (
                      <tr><td style={tdStyle} colSpan={3}>No mapped tests yet — map some test codes first.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {selectedTestCode && (
              <div style={{ flex: 1, overflowX: 'auto', background: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ padding: '10px 12px', fontSize: '12px', color: '#94a3b8', borderBottom: '1px solid #f1f5f9' }}>
                  Whatever a parameter is called here is matched against the analyzer's own result name at push time — it
                  doesn't need to exist in your test catalog. Add exactly the parameters this test actually reports (e.g.
                  just "Platelet" if that's all a CBC order ends up running).
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Parameter</th>
                      <th style={thStyle}>CDAC Code</th>
                      <th style={thStyle}>Parent Code</th>
                      <th style={thStyle}>UOM Code</th>
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {testParameters.map((p) => (
                      <tr key={p.parameter_name}>
                        <td style={tdStyle}>{p.parameter_name}</td>
                        <td style={tdStyle}>
                          <input
                            style={inputStyle}
                            defaultValue={p.hmis_parameter_code || ''}
                            onChange={(e) => setParamEdits((prev) => ({ ...prev, [p.parameter_name]: { ...prev[p.parameter_name], code: e.target.value } }))}
                          />
                        </td>
                        <td style={tdStyle}>
                          <input
                            style={inputStyle}
                            defaultValue={p.hmis_parent_parameter_code || ''}
                            onChange={(e) => setParamEdits((prev) => ({ ...prev, [p.parameter_name]: { ...prev[p.parameter_name], parent: e.target.value } }))}
                          />
                        </td>
                        <td style={tdStyle}>
                          <input
                            style={{ ...inputStyle, width: '80px' }}
                            defaultValue={p.hmis_str_uom || ''}
                            onChange={(e) => setParamEdits((prev) => ({ ...prev, [p.parameter_name]: { ...prev[p.parameter_name], uom: e.target.value } }))}
                          />
                        </td>
                        <td style={tdStyle}>
                          <button onClick={() => saveParameterMapping(p)} style={{ ...btnStyle, background: '#22c55e', color: '#fff', padding: '5px 12px' }}>
                            <Check size={12} /> Save
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr style={{ background: '#f8fafc' }}>
                      <td style={tdStyle}>
                        <input style={inputStyle} placeholder="New parameter name" value={newParam.name} onChange={(e) => setNewParam((p) => ({ ...p, name: e.target.value }))} />
                      </td>
                      <td style={tdStyle}>
                        <input style={inputStyle} placeholder="Code" value={newParam.code} onChange={(e) => setNewParam((p) => ({ ...p, code: e.target.value }))} />
                      </td>
                      <td style={tdStyle}>
                        <input style={inputStyle} placeholder="Parent code" value={newParam.parent} onChange={(e) => setNewParam((p) => ({ ...p, parent: e.target.value }))} />
                      </td>
                      <td style={tdStyle}>
                        <input style={{ ...inputStyle, width: '80px' }} placeholder="UOM" value={newParam.uom} onChange={(e) => setNewParam((p) => ({ ...p, uom: e.target.value }))} />
                      </td>
                      <td style={tdStyle}>
                        <button onClick={addNewParameter} style={{ ...btnStyle, background: '#0369a1', color: '#fff', padding: '5px 12px' }}>
                          + Add
                        </button>
                      </td>
                    </tr>
                    {testParameters.length === 0 && (
                      <tr><td style={{ ...tdStyle, color: '#94a3b8' }} colSpan={5}>No parameters mapped for this test yet — add one above, or import a CSV.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
