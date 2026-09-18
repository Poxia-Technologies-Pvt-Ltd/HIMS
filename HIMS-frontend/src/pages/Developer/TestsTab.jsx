import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || '';
const himsHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}` });

const ANALYZERS = [
  'CliniQuant Micro',
  'CelQuant Edge',
  'HDC-Lyte Plus',
  'HDC-LYTE PRO',
  'LAURA Smart',
  'ALTA Hematology',
];

const RESULT_TYPES = ['numeric', 'text', 'calculated', 'options'];

const EMPTY_PARAM = {
  parameter_code: '', parameter_name: '', parameter_unit: '',
  result_type: 'numeric', machine_parameter_code: '',
  min_value: '', max_value: '',
  men_min_value: '', men_max_value: '',
  women_min_value: '', women_max_value: '',
  kids_min_value: '', kids_max_value: '',
  use_demographic_ranges: false,
};

const ANALYZER_COLOR = {
  'CliniQuant Micro': { bg: '#2d1a4a', color: '#a78bfa' },
  'CelQuant Edge':    { bg: '#1a2e4a', color: '#38bdf8' },
  'HDC-Lyte Plus':    { bg: '#1e3a2a', color: '#4ade80' },
  'HDC-LYTE PRO':     { bg: '#1e3a2a', color: '#4ade80' },
  'LAURA Smart':      { bg: '#3a2a1a', color: '#fb923c' },
  'ALTA Hematology':  { bg: '#3a1a1a', color: '#f87171' },
};

// ── Small helpers ─────────────────────────────────────────────────────────
function Badge({ text }) {
  const s = ANALYZER_COLOR[text] || { bg: '#1e293b', color: '#94a3b8' };
  return <span style={{ ...st.badge, background: s.bg, color: s.color }}>{text || '—'}</span>;
}

function Input({ value, onChange, type = 'text', placeholder = '', style = {} }) {
  return (
    <input
      type={type} value={value ?? ''} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...st.input, ...style }}
    />
  );
}

// ── Parameter row (inline editable) ──────────────────────────────────────
function ParamRow({ param, idx, onChange, onDelete, readOnly }) {
  const [open, setOpen] = useState(false);
  const upd = (k, v) => onChange(idx, { ...param, [k]: v });

  return (
    <div style={{ borderBottom: '1px solid #1e293b' }}>
      {/* Main row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 110px 110px 32px 28px', gap: '6px', padding: '8px 10px', alignItems: 'center' }}>
        {readOnly ? (
          <span style={{ color: '#f1f5f9', fontSize: '13px' }}>{param.parameter_name}</span>
        ) : (
          <Input value={param.parameter_name} onChange={v => upd('parameter_name', v)} placeholder="Parameter name *" />
        )}
        {readOnly ? (
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>{param.parameter_unit}</span>
        ) : (
          <Input value={param.parameter_unit} onChange={v => upd('parameter_unit', v)} placeholder="Unit" />
        )}
        {readOnly ? (
          <span style={{ color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>{param.machine_parameter_code || '—'}</span>
        ) : (
          <Input value={param.machine_parameter_code} onChange={v => upd('machine_parameter_code', v)} placeholder="Machine code" />
        )}
        <span style={{ fontSize: '11px', color: '#475569' }}>
          {param.min_value || param.max_value
            ? `${param.min_value ?? '?'} – ${param.max_value ?? '?'}`
            : '—'}
        </span>
        {!readOnly && (
          <button style={{ ...st.iconBtn, color: '#38bdf8', fontSize: '12px' }} onClick={() => setOpen(!open)}>
            {open ? '▲' : '▼'}
          </button>
        )}
        {!readOnly && (
          <button style={{ ...st.iconBtn, color: '#ef4444' }} onClick={() => onDelete(idx)}>✕</button>
        )}
      </div>

      {/* Expanded ranges */}
      {open && !readOnly && (
        <div style={{ padding: '8px 10px 12px', background: '#0f172a' }}>
          <div style={{ fontSize: '11px', color: '#475569', marginBottom: '8px', fontWeight: '600' }}>REFERENCE RANGES</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            {[
              ['General Min', 'min_value'], ['General Max', 'max_value'],
              ['Men Min', 'men_min_value'], ['Men Max', 'men_max_value'],
              ['Women Min', 'women_min_value'], ['Women Max', 'women_max_value'],
              ['Kids Min', 'kids_min_value'], ['Kids Max', 'kids_max_value'],
            ].map(([label, key]) => (
              <div key={key}>
                <div style={{ fontSize: '10px', color: '#475569', marginBottom: '3px' }}>{label}</div>
                <Input value={param[key]} onChange={v => upd(key, v)} type="number" placeholder="—" />
              </div>
            ))}
          </div>
          <div style={{ marginTop: '8px', display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '10px', color: '#475569', marginBottom: '3px' }}>Result Type</div>
              <select style={st.input} value={param.result_type || 'numeric'} onChange={e => upd('result_type', e.target.value)}>
                {RESULT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: '#475569', marginBottom: '3px' }}>Param Code</div>
              <Input value={param.parameter_code} onChange={v => upd('parameter_code', v)} placeholder="e.g. WBC" />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b', marginTop: '12px', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!param.use_demographic_ranges} onChange={e => upd('use_demographic_ranges', e.target.checked)} />
              Use demographic ranges
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Test detail + parameter editor ────────────────────────────────────────
function TestDetail({ test, categories, labs, brands, onSaved, onDeleted }) {
  const [form, setForm]         = useState(null);
  const [params, setParams]     = useState([]);
  const [editing, setEditing]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');

  useEffect(() => {
    if (!test) return;
    axios.get(`${API}/api/lab/tests/${test.id}`, { headers: himsHdr() })
      .then(r => {
        if (r.data.success) {
          setForm({
            test_code: r.data.test.test_code,
            test_name: r.data.test.test_name,
            category_id: r.data.test.category_id || '',
            lab_id: r.data.test.lab_id || '',
            sample_type: r.data.test.sample_type || '',
            tube_color: r.data.test.tube_color || '',
            storage_conditions: r.data.test.storage_conditions || '',
            methodology: r.data.test.methodology || '',
            price: r.data.test.price || '',
            analyzer_name: r.data.test.analyzer_name || '',
          });
          setParams(r.data.parameters.map(p => ({ ...p })));
        }
      })
      .catch(() => {});
    setEditing(false);
    setErr('');
  }, [test]);

  const addParam = () => setParams(p => [...p, { ...EMPTY_PARAM }]);

  const updateParam = (idx, updated) => setParams(p => p.map((x, i) => i === idx ? updated : x));

  const deleteParam = (idx) => setParams(p => p.filter((_, i) => i !== idx));

  const save = async () => {
    if (!form.test_code || !form.test_name || !form.category_id || !form.sample_type) {
      setErr('Test code, name, category and sample type are required');
      return;
    }
    setSaving(true); setErr('');
    try {
      await axios.put(`${API}/api/lab/tests/${test.id}`, { ...form, parameters: params }, { headers: himsHdr() });
      setEditing(false);
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.message || 'Error saving test');
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm(`Delete test "${test.test_name}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`${API}/api/lab/tests/${test.id}`, { headers: himsHdr() });
      onDeleted();
    } catch (e) {
      alert(e.response?.data?.message || 'Cannot delete');
    }
  };

  if (!test || !form) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#334155', fontSize: '14px' }}>
      Select a test to view details
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9' }}>{test.test_name}</span>
            <span style={st.code}>{test.test_code}</span>
            {test.analyzer_name && <Badge text={test.analyzer_name} />}
          </div>
          <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>
            {test.category_name} · {test.sample_type} · {params.length} parameters
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {editing ? (
            <>
              <button style={st.btnSecondary} onClick={() => setEditing(false)}>Cancel</button>
              <button style={st.btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </>
          ) : (
            <>
              <button style={st.btnSecondary} onClick={() => setEditing(true)}>✏️ Edit</button>
              <button style={{ ...st.btnSecondary, color: '#ef4444', borderColor: '#450a0a' }} onClick={del}>🗑️ Delete</button>
            </>
          )}
        </div>
      </div>

      {err && <div style={{ ...st.errMsg, margin: '12px 20px 0' }}>{err}</div>}

      {/* Test metadata */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <div>
            <div style={st.fieldLabel}>Test Code *</div>
            {editing
              ? <Input value={form.test_code} onChange={v => setForm({ ...form, test_code: v })} />
              : <span style={st.readVal}>{form.test_code}</span>}
          </div>
          <div>
            <div style={st.fieldLabel}>Test Name *</div>
            {editing
              ? <Input value={form.test_name} onChange={v => setForm({ ...form, test_name: v })} />
              : <span style={st.readVal}>{form.test_name}</span>}
          </div>
          <div>
            <div style={st.fieldLabel}>Price (₹)</div>
            {editing
              ? <Input value={form.price} onChange={v => setForm({ ...form, price: v })} type="number" />
              : <span style={st.readVal}>{form.price ? `₹${form.price}` : '—'}</span>}
          </div>
          <div>
            <div style={st.fieldLabel}>Category *</div>
            {editing ? (
              <select style={st.input} value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}>
                <option value="">Select…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : <span style={st.readVal}>{test.category_name || '—'}</span>}
          </div>
          <div>
            <div style={st.fieldLabel}>Sample Type *</div>
            {editing
              ? <Input value={form.sample_type} onChange={v => setForm({ ...form, sample_type: v })} />
              : <span style={st.readVal}>{form.sample_type || '—'}</span>}
          </div>
          <div>
            <div style={st.fieldLabel}>Tube Color</div>
            {editing
              ? <Input value={form.tube_color} onChange={v => setForm({ ...form, tube_color: v })} />
              : <span style={st.readVal}>{form.tube_color || '—'}</span>}
          </div>
          <div>
            <div style={st.fieldLabel}>Assigned Lab</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingTop: '2px' }}>
              <span style={st.readVal}>{test.lab_name || '—'}</span>
              <span style={{ fontSize: '10px', color: '#475569', fontStyle: 'italic' }}>(auto from machine)</span>
            </div>
          </div>
          <div>
            <div style={st.fieldLabel}>Machine / Analyzer</div>
            {editing ? (
              <select style={st.input} value={form.analyzer_name} onChange={e => setForm({ ...form, analyzer_name: e.target.value })}>
                <option value="">No machine</option>
                {(brands.length > 0 ? brands.map(b => b.name) : ANALYZERS).map(a => (
                  <option key={a} value={a} style={{ textTransform: 'capitalize' }}>{a}</option>
                ))}
              </select>
            ) : <span style={st.readVal}><Badge text={form.analyzer_name || null} /></span>}
          </div>
          <div>
            <div style={st.fieldLabel}>Methodology</div>
            {editing
              ? <Input value={form.methodology} onChange={v => setForm({ ...form, methodology: v })} />
              : <span style={st.readVal}>{form.methodology || '—'}</span>}
          </div>
        </div>
      </div>

      {/* Parameters */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>
            Parameters ({params.length})
          </div>
          {editing && (
            <button style={st.btnPrimary} onClick={addParam}>+ Add Parameter</button>
          )}
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 110px 110px 32px 28px', gap: '6px', padding: '6px 10px', background: '#0f172a', fontSize: '10px', color: '#475569', fontWeight: '600', textTransform: 'uppercase' }}>
          <span>Parameter Name</span><span>Unit</span><span>Machine Code</span><span>Ref Range</span><span></span><span></span>
        </div>

        {params.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#334155', fontSize: '13px' }}>
            No parameters configured. {editing && 'Click "+ Add Parameter" to begin.'}
          </div>
        ) : (
          params.map((p, i) => (
            <ParamRow
              key={i} param={p} idx={i}
              onChange={updateParam}
              onDelete={deleteParam}
              readOnly={!editing}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Add Test Modal ────────────────────────────────────────────────────────
function AddTestModal({ categories, brands, onClose, onSaved }) {
  const [form, setForm]   = useState({ test_code: '', test_name: '', category_id: '', sample_type: '', tube_color: '', price: '', analyzer_name: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState('');

  const save = async () => {
    if (!form.test_code || !form.test_name || !form.category_id || !form.sample_type) {
      setErr('Test code, name, category and sample type are required'); return;
    }
    setSaving(true); setErr('');
    try {
      await axios.post(`${API}/api/lab/tests`, { ...form, parameters: [] }, { headers: himsHdr() });
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.message || 'Error creating test');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <span style={st.modalTitle}>Add New Test</span>
          <button style={st.modalClose} onClick={onClose}>✕</button>
        </div>
        <div style={st.modalBody}>
          {err && <div style={{ ...st.errMsg, marginBottom: '14px' }}>{err}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><div style={st.fieldLabel}>Test Code *</div><Input value={form.test_code} onChange={v => setForm({ ...form, test_code: v })} /></div>
            <div><div style={st.fieldLabel}>Test Name *</div><Input value={form.test_name} onChange={v => setForm({ ...form, test_name: v })} /></div>
            <div>
              <div style={st.fieldLabel}>Category *</div>
              <select style={st.input} value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}>
                <option value="">Select category…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><div style={st.fieldLabel}>Sample Type *</div><Input value={form.sample_type} onChange={v => setForm({ ...form, sample_type: v })} placeholder="e.g. Whole Blood" /></div>
            <div>
              <div style={st.fieldLabel}>Machine / Analyzer</div>
              <select style={st.input} value={form.analyzer_name} onChange={e => setForm({ ...form, analyzer_name: e.target.value })}>
                <option value="">No machine</option>
                {(brands.length > 0 ? brands.map(b => b.name) : ANALYZERS).map(a => (
                  <option key={a} value={a} style={{ textTransform: 'capitalize' }}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={st.fieldLabel}>Assigned Lab</div>
              <div style={{ fontSize: '12px', color: '#475569', fontStyle: 'italic', paddingTop: '8px' }}>
                Auto-assigned when a machine is added to a lab
              </div>
            </div>
            <div><div style={st.fieldLabel}>Tube Color</div><Input value={form.tube_color} onChange={v => setForm({ ...form, tube_color: v })} placeholder="e.g. Red" /></div>
            <div><div style={st.fieldLabel}>Price (₹)</div><Input value={form.price} onChange={v => setForm({ ...form, price: v })} type="number" /></div>
          </div>
          <button style={{ ...st.btnPrimary, marginTop: '16px', width: '100%' }} onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create Test'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main TestsTab ─────────────────────────────────────────────────────────
export default function TestsTab() {
  const [tests, setTests]           = useState([]);
  const [categories, setCategories] = useState([]);
  const [labs, setLabs]             = useState([]);
  const [brands, setBrands]         = useState([]);
  const [selected, setSelected]     = useState(null);
  const [search, setSearch]         = useState('');
  const [filterAnalyzer, setFilterAnalyzer] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [showAdd, setShowAdd]       = useState(false);
  const [loading, setLoading]       = useState(true);

  const loadTests = useCallback(() => {
    setLoading(true);
    axios.get(`${API}/api/lab/tests`, { headers: himsHdr() })
      .then(r => setTests(r.data.tests || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadTests();
    axios.get(`${API}/api/lab/categories`, { headers: himsHdr() }).then(r => setCategories(r.data.categories || []));
    axios.get(`${API}/api/lab/labs`, { headers: himsHdr() }).then(r => setLabs(r.data.labs || []));
    axios.get(`${API}/api/dev/brands`).then(r => setBrands(r.data.brands || []));
  }, [loadTests]);

  const filtered = tests.filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !q || t.test_name?.toLowerCase().includes(q) || t.test_code?.toLowerCase().includes(q);
    const matchAnalyzer = !filterAnalyzer || t.analyzer_name === filterAnalyzer;
    const matchCategory = !filterCategory || String(t.category_id) === filterCategory;
    return matchSearch && matchAnalyzer && matchCategory;
  });

  const analyzerList = [...new Set(tests.map(t => t.analyzer_name).filter(Boolean))];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '0', height: 'calc(100vh - 140px)', border: '1px solid #1e293b', borderRadius: '12px', overflow: 'hidden' }}>
      {/* Left — Test list */}
      <div style={{ borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', background: '#1e293b' }}>
        {/* Toolbar */}
        <div style={{ padding: '12px', borderBottom: '1px solid #0f172a', flexShrink: 0 }}>
          <input
            style={{ ...st.input, width: '100%', marginBottom: '8px', boxSizing: 'border-box' }}
            placeholder="Search tests…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '6px' }}>
            <select style={{ ...st.input, flex: 1 }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select style={{ ...st.input, flex: 1 }} value={filterAnalyzer} onChange={e => setFilterAnalyzer(e.target.value)}>
              <option value="">All machines</option>
              {analyzerList.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        {/* Add button + count */}
        <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #0f172a' }}>
          <span style={{ fontSize: '12px', color: '#475569' }}>{filtered.length} tests</span>
          <button style={st.btnPrimary} onClick={() => setShowAdd(true)}>+ New Test</button>
        </div>

        {/* Test list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#334155' }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#334155', fontSize: '13px' }}>No tests found</div>
          ) : (
            filtered.map(t => {
              const isActive = selected?.id === t.id;
              const ac = ANALYZER_COLOR[t.analyzer_name] || { bg: '#1e293b', color: '#475569' };
              return (
                <div
                  key={t.id}
                  onClick={() => setSelected(t)}
                  style={{
                    padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #0f172a',
                    background: isActive ? 'rgba(56,189,248,0.08)' : 'transparent',
                    borderLeft: isActive ? '3px solid #38bdf8' : '3px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: '600', color: '#f1f5f9', fontSize: '13px' }}>{t.test_name}</span>
                    <span style={st.code}>{t.test_code}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                    {t.analyzer_name && (
                      <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '20px', background: ac.bg, color: ac.color, fontWeight: '600' }}>
                        {t.analyzer_name}
                      </span>
                    )}
                    {t.category_name && (
                      <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '20px', background: '#0f172a', color: '#475569' }}>
                        {t.category_name}
                      </span>
                    )}
                    {t.price && (
                      <span style={{ fontSize: '10px', color: '#4ade80' }}>₹{t.price}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right — Detail */}
      <div style={{ background: '#1e293b', overflow: 'hidden' }}>
        <TestDetail
          test={selected}
          categories={categories}
          labs={labs}
          brands={brands}
          onSaved={() => { loadTests(); }}
          onDeleted={() => { setSelected(null); loadTests(); }}
        />
      </div>

      {showAdd && (
        <AddTestModal
          categories={categories}
          brands={brands}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); loadTests(); }}
        />
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const st = {
  badge:       { display:'inline-block', padding:'2px 8px', borderRadius:'20px', fontSize:'11px', fontWeight:'600' },
  code:        { background:'#0f172a', color:'#38bdf8', padding:'2px 7px', borderRadius:'4px', fontSize:'11px', fontFamily:'monospace' },
  input:       { background:'#0f172a', border:'1px solid #334155', borderRadius:'6px', color:'#f1f5f9', padding:'7px 10px', fontSize:'13px', outline:'none', fontFamily:'inherit', width:'100%', boxSizing:'border-box' },
  btnPrimary:  { background:'linear-gradient(135deg,#0ea5e9,#2563eb)', color:'#fff', border:'none', borderRadius:'7px', padding:'7px 14px', fontSize:'12px', fontWeight:'600', cursor:'pointer', whiteSpace:'nowrap' },
  btnSecondary:{ background:'#0f172a', color:'#94a3b8', border:'1px solid #334155', borderRadius:'7px', padding:'7px 14px', fontSize:'12px', cursor:'pointer', whiteSpace:'nowrap' },
  iconBtn:     { background:'none', border:'none', cursor:'pointer', fontSize:'14px', padding:'2px 4px', color:'#475569' },
  fieldLabel:  { fontSize:'11px', color:'#64748b', fontWeight:'500', marginBottom:'4px', textTransform:'uppercase' },
  readVal:     { fontSize:'13px', color:'#e2e8f0', display:'block', paddingTop:'2px' },
  errMsg:      { background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', color:'#fca5a5', borderRadius:'7px', padding:'9px 12px', fontSize:'13px' },
  overlay:     { position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 },
  modal:       { background:'#1e293b', border:'1px solid #334155', borderRadius:'12px', width:'100%', maxWidth:'560px', maxHeight:'90vh', overflow:'auto' },
  modalHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'18px 20px', borderBottom:'1px solid #334155' },
  modalTitle:  { fontSize:'16px', fontWeight:'600', color:'#f1f5f9' },
  modalClose:  { background:'none', border:'none', color:'#475569', fontSize:'18px', cursor:'pointer' },
  modalBody:   { padding:'20px' },
};
