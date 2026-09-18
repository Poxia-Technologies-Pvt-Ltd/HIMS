import { useState, useEffect } from 'react';
import { Cpu, Save } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

// Diff Type options are scoped to the selected Department — a Hematology
// Analyzer's diff type means "3-Part/5-Part/...", while a Biochemistry
// Analyzer's means "Semi-Automated/Fully Automated/...". 'N/A' is always
// offered as the unset default regardless of department.
const DEPARTMENT_DIFF_TYPES = {
  'Hematology Analyzers': [
    '3-Part', '5-Part', '6-Part', '7-Part', '9-Part',
    '5-Part with Reticulocyte', '5-Part with ESR',
    'Automated Reticulocyte Analyzer', 'ESR Analyzer',
  ],
  'Clinical Chemistry / Biochemistry Analyzers': [
    'Semi-Automated Biochemistry Analyzer', 'Fully Automated Biochemistry Analyzer',
    'Random Access Biochemistry Analyzer', 'Batch Biochemistry Analyzer',
    'High Throughput Biochemistry Analyzer', 'Integrated Chemistry Analyzer',
  ],
  'Electrolyte Analyzers': [
    'Standalone ISE Analyzer', '3-Electrode ISE Analyzer', '5-Electrode ISE Analyzer',
    'Electrolyte Analyzer with Blood Gas', 'Integrated ISE Analyzer',
  ],
  'Immunoassay Analyzers': [
    'ELISA Analyzer', 'CLIA Analyzer', 'ECLIA Analyzer', 'FIA Analyzer', 'FEIA Analyzer',
    'Chemiluminescence Immunoassay Analyzer', 'Fully Automated Immunoassay Analyzer',
    'Automated Immunoassay Analyzer',
  ],
  'Urinalysis Analyzers': [
    'Urine Strip Analyzer', 'Urine Chemistry Analyzer', 'Urine Sediment Analyzer',
    'Automated Urine Sediment Analyzer', 'Digital Urine Microscopy Analyzer',
    'Flow Cytometry Urine Analyzer', 'Integrated Urine Analyzer',
  ],
  'Coagulation Analyzers': [
    'Semi-Automated Coagulation Analyzer', 'Fully Automated Coagulation Analyzer',
    'Random Access Coagulation Analyzer', 'High Throughput Coagulation Analyzer',
  ],
  'Blood Gas Analyzers': [
    'ABG Analyzer', 'VBG Analyzer', 'Blood Gas Analyzer',
    'Blood Gas and Electrolyte Analyzer', 'Blood Gas and Metabolite Analyzer',
    'Critical Care Analyzer',
  ],
  'HbA1c Analyzers': [
    'HPLC HbA1c Analyzer', 'Immunoassay HbA1c Analyzer', 'Boronate Affinity HbA1c Analyzer',
    'Enzymatic HbA1c Analyzer', 'Point-of-Care HbA1c Analyzer',
  ],
  'Microbiology Analyzers': [
    'Automated Blood Culture Analyzer', 'Microbial Identification Analyzer',
    'Antimicrobial Susceptibility Testing Analyzer', 'Automated Identification and AST Analyzer',
    'MALDI-TOF Analyzer', 'Microbiology Automation System',
  ],
  'Molecular Diagnostics Analyzers': [
    'PCR Analyzer', 'Real-Time PCR Analyzer', 'qPCR Analyzer', 'Multiplex PCR Analyzer',
    'Digital PCR Analyzer', 'Cartridge-Based Molecular Analyzer', 'Fully Automated Molecular Analyzer',
  ],
  'Point-of-Care Testing Analyzers': [
    'Blood Glucose Analyzer', 'POCT Blood Gas Analyzer', 'POCT HbA1c Analyzer',
    'POCT Electrolyte Analyzer', 'POCT Cardiac Marker Analyzer', 'POCT CRP Analyzer',
    'POCT Immunoassay Analyzer', 'POCT Coagulation Analyzer',
  ],
  'Special Chemistry Analyzers': [
    'Protein Analyzer', 'Nephelometer', 'Turbidimeter',
    'Immunoturbidimetric Analyzer', 'Serum Protein Electrophoresis Analyzer',
  ],
  'Pathology Analyzers': [
    'Digital Slide Scanner', 'Digital Pathology Analyzer', 'Histopathology Analyzer',
    'Cytology Analyzer', 'Automated Slide Stainer', 'Automated Tissue Processor',
  ],
  'Cytology Analyzers': [
    'Automated Cytology Analyzer', 'Liquid-Based Cytology Analyzer', 'Cervical Cytology Analyzer',
  ],
  'Genetic / Molecular Analyzers': [
    'DNA Analyzer', 'RNA Analyzer', 'Genetic Analyzer', 'DNA Sequencer',
    'Next Generation Sequencing Analyzer',
  ],
  'POC / Rapid Diagnostic Analyzers': [
    'Lateral Flow Analyzer', 'Fluorescence Immunoassay Reader', 'Rapid Test Reader',
    'Digital Rapid Test Analyzer',
  ],
};
const DEPARTMENTS = Object.keys(DEPARTMENT_DIFF_TYPES);
const diffTypeOptionsFor = (department) => ['N/A', ...(DEPARTMENT_DIFF_TYPES[department] || [])];

const selectStyle = { padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, width: '100%', boxSizing: 'border-box', fontWeight: 600, color: '#334155', background: '#fff' };

// Configures what an analyzer *model* actually is — a Mindray BC-5130 is a
// 3-part differential Hematology machine, a CelQuant 5plus is 5-part, and
// so on — separately from lab_machines (one row per physical box, several
// of which can share the same model). Configured once per model here;
// every machine of that model then inherits it via a manufacturer+model
// join (see labMachineController.js getMachineStats/getAnalyzerLogs),
// which is what powers the Diff Type / Department filters on
// Machine Network and Analyzer Logs. Admin-only.
export default function MachineMaster() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // manufacturer+model key currently saving

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/lab/machine-models`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        setRows((data.machine_models || []).map((r) => ({
          ...r,
          diff_type: r.diff_type || 'N/A',
          department: r.department || '',
        })));
      } else {
        showAlert(data.message || 'Failed to load machine models', 'error');
      }
    } catch (err) {
      console.error(err);
      showAlert('Network error loading machine models.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRows(); /* eslint-disable-next-line */ }, []);

  const rowKey = (r) => `${r.manufacturer}::${r.model}`;

  const updateRow = (key, field, value) => {
    setRows((prev) => prev.map((r) => {
      if (rowKey(r) !== key) return r;
      // Diff Type options depend on Department — changing department resets
      // diff_type unless the current value is still valid under the new one.
      if (field === 'department' && !diffTypeOptionsFor(value).includes(r.diff_type)) {
        return { ...r, department: value, diff_type: 'N/A' };
      }
      return { ...r, [field]: value };
    }));
  };

  const saveRow = async (row) => {
    const key = rowKey(row);
    setSaving(key);
    try {
      const res = await fetch(`${API_BASE}/api/lab/machine-models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          manufacturer: row.manufacturer,
          model: row.model,
          diff_type: row.diff_type,
          department: row.department || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showAlert(`Saved "${row.manufacturer} ${row.model}".`, 'success');
        fetchRows();
      } else {
        showAlert(data.message || 'Save failed.', 'error');
      }
    } catch (err) {
      console.error(err);
      showAlert('Network error saving.', 'error');
    } finally {
      setSaving(null);
    }
  };

  const totalMachines = rows.reduce((sum, r) => sum + Number(r.machine_count || 0), 0);
  const configuredCount = rows.filter((r) => r.config_id).length;
  const unconfiguredCount = rows.length - configuredCount;
  const diffTypeCounts = rows.reduce((acc, r) => {
    if (!r.config_id) return acc;
    acc[r.diff_type] = (acc[r.diff_type] || 0) + Number(r.machine_count || 0);
    return acc;
  }, {});

  return (
    <div style={{ padding: '28px 32px', background: '#f8fafc', minHeight: '100vh' }}>
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={4000} />}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Cpu size={22} color="#1d4ed8" /> Machine Master
          </h1>
          <p style={{ color: '#64748b', margin: '4px 0 0', fontSize: 14 }}>
            Configure what each analyzer model is — differential type and department — once per model,
            applied to every physical machine of that model.
          </p>
        </div>
        <button onClick={fetchRows}
          style={{ padding: '9px 18px', borderRadius: 9, background: '#fff', border: '1px solid #e2e8f0', fontWeight: 700, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      {/* Stat tiles */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Models',        value: loading ? '—' : rows.length,           icon: '🧬', color: '#1d4ed8' },
          { label: 'Machines',      value: loading ? '—' : totalMachines,          icon: '🖥️', color: '#0f172a' },
          { label: 'Configured',    value: loading ? '—' : configuredCount,        icon: '✅', color: '#16a34a' },
          { label: 'Unconfigured',  value: loading ? '—' : unconfiguredCount,      icon: '⚠️', color: '#d97706' },
          { label: '3-Part',        value: loading ? '—' : (diffTypeCounts['3-Part'] || 0), icon: '🩸', color: '#7c3aed' },
          { label: '5-Part',        value: loading ? '—' : (diffTypeCounts['5-Part'] || 0), icon: '🩸', color: '#7c3aed' },
        ].map((c) => (
          <div key={c.label} style={{
            background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
            padding: '16px 20px', flex: 1, minWidth: 120, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: c.color, lineHeight: 1 }}>{c.value}</div>
            </div>
            <div style={{ fontSize: 20, opacity: 0.2 }}>{c.icon}</div>
          </div>
        ))}
      </div>

      {!loading && unconfiguredCount > 0 && (
        <div style={{
          padding: '12px 16px', marginBottom: 16, borderRadius: 10,
          background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 13, fontWeight: 600,
        }}>
          ⚠️ {unconfiguredCount} model{unconfiguredCount === 1 ? '' : 's'} not configured yet — highlighted below.
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Analyzer Models</h3>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{rows.length} models</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Manufacturer', 'Model', 'Machines', 'Department', 'Diff Type', ''].map((h) => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', textAlign: 'left', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading...</td></tr>
              )}
              {!loading && rows.map((row) => {
                const key = rowKey(row);
                return (
                  <tr key={key} style={{ borderBottom: '1px solid #f8fafc', background: !row.config_id ? '#fffcf5' : '#fff' }}>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#475569' }}>{row.manufacturer || 'Unknown'}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 800, color: '#1e40af' }}>{row.model}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{row.machine_count}</td>
                    <td style={{ padding: '11px 14px', width: 260 }}>
                      <select value={row.department} onChange={(e) => updateRow(key, 'department', e.target.value)} style={selectStyle}>
                        <option value="">— Select —</option>
                        {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '11px 14px', width: 230 }}>
                      <select
                        value={row.diff_type}
                        onChange={(e) => updateRow(key, 'diff_type', e.target.value)}
                        disabled={!row.department}
                        style={selectStyle}
                        title={!row.department ? 'Select a Department first' : undefined}
                      >
                        {diffTypeOptionsFor(row.department).map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '11px 14px', width: 100 }}>
                      <button
                        onClick={() => saveRow(row)}
                        disabled={saving === key}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5, background: '#eff6ff', color: '#1d4ed8',
                          border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                          cursor: 'pointer', opacity: saving === key ? 0.6 : 1,
                        }}
                      >
                        <Save size={12} /> {saving === key ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No machines registered yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
