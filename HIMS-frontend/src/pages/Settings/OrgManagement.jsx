import { useState, useEffect, useCallback } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';

const API   = import.meta.env.VITE_API_URL || '';
const tok   = () => localStorage.getItem('hims_token');
const hdr   = () => ({ Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json' });
const bId   = () => localStorage.getItem('branch_id');
const role  = () => localStorage.getItem('role_level') || 'Branch';

const DAYS  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const BED_TYPES   = ['General','Semi-Private','Private','ICU','HDU','NICU','PICU','Day Care'];
const BED_STATUSES = ['Available','Occupied','Under Maintenance','Reserved'];
const HOL_TYPES   = ['National','State','Local','Hospital'];

function Badge({ label, color }) {
  const map = { green:'#dcfce7:#166534', red:'#fee2e2:#991b1b', blue:'#dbeafe:#1e40af', grey:'#f1f5f9:#475569', yellow:'#fef9c3:#854d0e' };
  const [bg, text] = (map[color] || map.grey).split(':');
  return <span style={{ display:'inline-block', padding:'2px 10px', borderRadius:12, fontSize:11, fontWeight:600, background:bg, color:text }}>{label}</span>;
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', borderRadius:14, width:480, maxWidth:'95vw', maxHeight:'90vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,.2)' }}>
        <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center' }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:700, color:'#1e293b' }}>{title}</h3>
          <button onClick={onClose} style={{ marginLeft:'auto', border:'none', background:'none', fontSize:20, cursor:'pointer', color:'#94a3b8' }}>✕</button>
        </div>
        <div style={{ padding:'20px' }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, required }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#475569', marginBottom:5 }}>{label}{required && ' *'}</label>
      {children}
    </div>
  );
}

const inp = { width:'100%', padding:'8px 10px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:13, outline:'none', boxSizing:'border-box' };
const sel = { ...inp, background:'#fff' };

// ── Departments Tab ───────────────────────────────────────────────────────────
function DepartmentsTab({ showAlert }) {
  const [depts, setDepts]     = useState([]);
  const [modal, setModal]     = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState({ name:'', code:'', description:'', is_active: true });

  const load = useCallback(async () => {
    const r = await fetch(`${API}/api/departments?branch_id=${bId()}`, { headers: hdr() });
    const d = await r.json();
    if (d.success) setDepts(d.departments || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = (dept) => {
    setEditing(dept || null);
    setForm(dept ? { name: dept.name, code: dept.code||'', description: dept.description||'', is_active: dept.isActive ?? dept.is_active ?? true } : { name:'', code:'', description:'', is_active: true });
    setModal(true);
  };

  const save = async () => {
    if (!form.name) return showAlert('Name is required', 'warning');
    const url    = editing ? `${API}/api/departments/${editing.id}` : `${API}/api/departments`;
    const method = editing ? 'PUT' : 'POST';
    const r = await fetch(url, { method, headers: hdr(), body: JSON.stringify({ ...form, branch_id: bId() }) });
    const d = await r.json();
    if (d.success) { setModal(false); load(); showAlert(editing ? 'Department updated' : 'Department created', 'success'); }
    else showAlert(d.message || 'Error', 'error');
  };

  const del = async (id) => {
    if (!window.confirm('Delete this department?')) return;
    const r = await fetch(`${API}/api/departments/${id}`, { method:'DELETE', headers: hdr() });
    const d = await r.json();
    if (d.success) { load(); showAlert('Deleted', 'success'); }
    else showAlert(d.message || 'Error', 'error');
  };

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h3 style={{ margin:0, fontSize:16, fontWeight:700, color:'#1e293b' }}>Departments</h3>
        <button onClick={() => open(null)} style={{ padding:'8px 16px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>+ Add Department</button>
      </div>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr style={{ background:'#f8fafc' }}>
          {['Name','Code','Description','Status','Created',''].map(h => <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', borderBottom:'1.5px solid #e2e8f0' }}>{h}</th>)}
        </tr></thead>
        <tbody>{depts.map(d => (
          <tr key={d.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
            <td style={{ padding:'10px 12px', fontWeight:600, color:'#1e293b' }}>{d.name}</td>
            <td style={{ padding:'10px 12px', fontSize:12, color:'#64748b', fontFamily:'monospace' }}>{d.code||'—'}</td>
            <td style={{ padding:'10px 12px', fontSize:12, color:'#64748b', maxWidth:200 }}>{d.description||'—'}</td>
            <td style={{ padding:'10px 12px' }}><Badge label={(d.isActive || d.is_active) ? 'Active':'Inactive'} color={(d.isActive || d.is_active) ? 'green':'grey'} /></td>
            <td style={{ padding:'10px 12px', fontSize:12, color:'#94a3b8' }}>{d.created_at ? new Date(d.created_at).toLocaleDateString('en-IN') : '—'}</td>
            <td style={{ padding:'10px 12px' }}>
              <button onClick={() => open(d)} style={{ marginRight:6, padding:'4px 10px', border:'1px solid #e2e8f0', background:'#fff', borderRadius:6, fontSize:12, cursor:'pointer' }}>Edit</button>
              <button onClick={() => del(d.id)} style={{ padding:'4px 10px', border:'1px solid #fca5a5', background:'#fff', color:'#dc2626', borderRadius:6, fontSize:12, cursor:'pointer' }}>Delete</button>
            </td>
          </tr>
        ))}</tbody>
      </table>
      {depts.length === 0 && <div style={{ textAlign:'center', padding:40, color:'#94a3b8', fontSize:13 }}>No departments found. Add your first department.</div>}

      {modal && <Modal title={editing ? 'Edit Department' : 'Add Department'} onClose={() => setModal(false)}>
        <Field label="Department Name" required><input style={inp} value={form.name} onChange={e => setForm(p => ({...p, name:e.target.value}))} placeholder="e.g. Cardiology" /></Field>
        <Field label="Short Code"><input style={inp} value={form.code} onChange={e => setForm(p => ({...p, code:e.target.value.toUpperCase()}))} placeholder="e.g. CARD" maxLength={20} /></Field>
        <Field label="Description"><textarea style={{...inp, height:70, resize:'vertical'}} value={form.description} onChange={e => setForm(p => ({...p, description:e.target.value}))} /></Field>
        <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
          <input type="checkbox" checked={!!form.is_active} onChange={e => setForm(p => ({...p, is_active: e.target.checked}))} />
          Active
        </label>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:20 }}>
          <button onClick={() => setModal(false)} style={{ padding:'8px 16px', border:'1.5px solid #e2e8f0', background:'none', borderRadius:7, fontSize:13, cursor:'pointer' }}>Cancel</button>
          <button onClick={save} style={{ padding:'8px 20px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>Save</button>
        </div>
      </Modal>}
    </div>
  );
}

// ── District Manager (used inside StatesTab) ──────────────────────────────────
function DistrictManager({ state, allDistricts, onRefresh, showAlert }) {
  const districts = allDistricts.filter(d => String(d.state_id) === String(state.id));
  const [editingDist, setEditingDist] = useState(null);
  const [distForm, setDistForm]       = useState({ name:'' });
  const [showForm, setShowForm]       = useState(false);

  const openAdd = () => { setEditingDist(null); setDistForm({ name:'' }); setShowForm(true); };
  const openEdit = (d) => { setEditingDist(d); setDistForm({ name: d.name }); setShowForm(true); };
  const cancel = () => { setShowForm(false); setEditingDist(null); };

  const save = async () => {
    if (!distForm.name.trim()) return showAlert('District name is required', 'warning');
    const url    = editingDist ? `${API}/api/branches/district/${editingDist.id}` : `${API}/api/branches/district`;
    const method = editingDist ? 'PUT' : 'POST';
    const r = await fetch(url, {
      method, headers: hdr(),
      body: JSON.stringify({ name: distForm.name.trim(), state_id: state.id, state: state.name })
    });
    const d = await r.json();
    if (d.success) { cancel(); onRefresh(); showAlert(editingDist ? 'District updated' : 'District added', 'success'); }
    else showAlert(d.message || 'Error', 'error');
  };

  const del = async (dist) => {
    if (!window.confirm(`Delete district "${dist.name}"?`)) return;
    const r = await fetch(`${API}/api/branches/district/${dist.id}`, { method:'DELETE', headers: hdr() });
    const d = await r.json();
    if (d.success) { onRefresh(); showAlert('District deleted', 'success'); }
    else showAlert(d.message || 'Error', 'error');
  };

  return (
    <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'14px 16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <span style={{ fontSize:12, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.5px' }}>
          Districts in {state.name}
        </span>
        <button onClick={openAdd} style={{ padding:'4px 12px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}>+ Add District</button>
      </div>

      {showForm && (
        <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', background:'#fff', border:'1px solid #c7d2fe', borderRadius:8, padding:'10px 12px' }}>
          <input
            style={{ ...inp, flex:1, marginBottom:0 }}
            value={distForm.name}
            onChange={e => setDistForm({ name: e.target.value })}
            placeholder="District name…"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          />
          <button onClick={save} style={{ padding:'7px 14px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
            {editingDist ? 'Update' : 'Add'}
          </button>
          <button onClick={cancel} style={{ padding:'7px 10px', border:'1px solid #e2e8f0', background:'#fff', borderRadius:6, fontSize:12, cursor:'pointer' }}>✕</button>
        </div>
      )}

      {districts.length === 0 && !showForm && (
        <div style={{ textAlign:'center', padding:'16px 0', color:'#94a3b8', fontSize:12 }}>No districts yet. Click "+ Add District" to create one.</div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {districts.map(d => (
          <div key={d.id} style={{ display:'flex', alignItems:'center', background:'#fff', border:'1px solid #e2e8f0', borderRadius:7, padding:'8px 12px' }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:'#a5b4fc', marginRight:10, flexShrink:0 }} />
            <span style={{ flex:1, fontSize:13, fontWeight:500, color:'#1e293b' }}>{d.name}</span>
            <button onClick={() => openEdit(d)} style={{ marginRight:6, padding:'3px 10px', border:'1px solid #e2e8f0', background:'#fff', borderRadius:5, fontSize:11, cursor:'pointer' }}>Edit</button>
            <button onClick={() => del(d)} style={{ padding:'3px 10px', border:'1px solid #fca5a5', background:'#fff', color:'#dc2626', borderRadius:5, fontSize:11, cursor:'pointer' }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── States Tab ────────────────────────────────────────────────────────────────
function StatesTab({ showAlert }) {
  const [states, setStates]       = useState([]);
  const [allDistricts, setAllDistricts] = useState([]);
  const [modal, setModal]         = useState(false);
  const [editing, setEditing]     = useState(null);
  const [expandedState, setExpandedState] = useState(null);
  const [form, setForm]           = useState({ name:'', code:'' });

  if (role() !== 'Central') return (
    <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>
      <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
      <p style={{ fontSize:14 }}>Only Central admins can manage states.</p>
    </div>
  );

  const load = async () => {
    const [sr, br] = await Promise.all([
      fetch(`${API}/api/org/states`, { headers: hdr() }).then(r=>r.json()),
      fetch(`${API}/api/branches`, { headers: hdr() }).then(r=>r.json()),
    ]);
    if (sr.success) setStates(sr.states || []);
    if (br.success) setAllDistricts(br.districts || []);
  };

  useEffect(() => { load(); }, []);

  const distCount = (stateId) => allDistricts.filter(d => String(d.state_id) === String(stateId)).length;

  const open = (s) => {
    setEditing(s || null);
    setForm(s ? { name:s.name, code:s.code } : { name:'', code:'' });
    setModal(true);
  };

  const save = async () => {
    if (!form.name || !form.code) return showAlert('Name and code are required', 'warning');
    const url = editing ? `${API}/api/org/states/${editing.id}` : `${API}/api/org/states`;
    const r = await fetch(url, { method: editing ? 'PUT':'POST', headers: hdr(), body: JSON.stringify(form) });
    const d = await r.json();
    if (d.success) { setModal(false); load(); showAlert('Saved', 'success'); }
    else showAlert(d.message || 'Error', 'error');
  };

  const del = async (id) => {
    if (!window.confirm('Delete this state?')) return;
    const r = await fetch(`${API}/api/org/states/${id}`, { method:'DELETE', headers: hdr() });
    const d = await r.json();
    if (d.success) { if (expandedState === id) setExpandedState(null); load(); showAlert('Deleted', 'success'); }
    else showAlert(d.message || 'Error', 'error');
  };

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h3 style={{ margin:0, fontSize:16, fontWeight:700 }}>States & Districts</h3>
        <button onClick={() => open(null)} style={{ padding:'8px 16px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>+ Add State</button>
      </div>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr style={{ background:'#f8fafc' }}>
          {['State Name','Code','Districts','Status',''].map(h => <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', borderBottom:'1.5px solid #e2e8f0' }}>{h}</th>)}
        </tr></thead>
        <tbody>{states.map(s => (
          <>
            <tr key={s.id} style={{ borderBottom: expandedState === s.id ? 'none' : '1px solid #f1f5f9', background: expandedState === s.id ? '#fafbff' : '' }}>
              <td style={{ padding:'10px 12px', fontWeight:600 }}>{s.name}</td>
              <td style={{ padding:'10px 12px', fontFamily:'monospace', fontSize:13 }}>{s.code}</td>
              <td style={{ padding:'10px 12px' }}>
                <button
                  onClick={() => setExpandedState(expandedState === s.id ? null : s.id)}
                  style={{ padding:'3px 10px', border:'1px solid #c7d2fe', background: expandedState===s.id ? '#eef2ff':'#fff', color:'#4f46e5', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}
                >
                  {distCount(s.id)} Districts {expandedState === s.id ? '▲' : '▼'}
                </button>
              </td>
              <td style={{ padding:'10px 12px' }}><Badge label={s.is_active ? 'Active':'Inactive'} color={s.is_active ? 'green':'grey'} /></td>
              <td style={{ padding:'10px 12px' }}>
                <button onClick={() => open(s)} style={{ marginRight:6, padding:'4px 10px', border:'1px solid #e2e8f0', background:'#fff', borderRadius:6, fontSize:12, cursor:'pointer' }}>Edit</button>
                <button onClick={() => del(s.id)} style={{ padding:'4px 10px', border:'1px solid #fca5a5', background:'#fff', color:'#dc2626', borderRadius:6, fontSize:12, cursor:'pointer' }}>Delete</button>
              </td>
            </tr>
            {expandedState === s.id && (
              <tr key={`${s.id}-districts`}>
                <td colSpan={5} style={{ padding:'0 16px 16px', background:'#fafbff', borderBottom:'1px solid #e2e8f0' }}>
                  <DistrictManager
                    state={s}
                    allDistricts={allDistricts}
                    onRefresh={load}
                    showAlert={showAlert}
                  />
                </td>
              </tr>
            )}
          </>
        ))}</tbody>
      </table>
      {states.length === 0 && <div style={{ textAlign:'center', padding:40, color:'#94a3b8', fontSize:13 }}>No states found.</div>}

      {modal && <Modal title={editing ? 'Edit State':'Add State'} onClose={() => setModal(false)}>
        <Field label="State Name" required><input style={inp} value={form.name} onChange={e => setForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Jharkhand" /></Field>
        <Field label="State Code (2–3 letters)" required><input style={inp} value={form.code} onChange={e => setForm(p=>({...p,code:e.target.value.toUpperCase()}))} placeholder="e.g. JH" maxLength={10} /></Field>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:20 }}>
          <button onClick={() => setModal(false)} style={{ padding:'8px 16px', border:'1.5px solid #e2e8f0', background:'none', borderRadius:7, fontSize:13, cursor:'pointer' }}>Cancel</button>
          <button onClick={save} style={{ padding:'8px 20px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>Save</button>
        </div>
      </Modal>}
    </div>
  );
}

// ── Facility Manager (used inside BlocksTab) ──────────────────────────────────
function FacilityManager({ block, allBranches, onRefresh, showAlert }) {
  const assigned   = allBranches.filter(b => b.block_id == block.id);
  const unassigned = allBranches.filter(b => !b.block_id);
  const [selBranch, setSelBranch] = useState('');

  const assign = async () => {
    if (!selBranch) return;
    const r = await fetch(`${API}/api/branches/center/${selBranch}/block`, {
      method: 'PATCH', headers: hdr(),
      body: JSON.stringify({ block_id: block.id })
    });
    const d = await r.json();
    if (d.success) { setSelBranch(''); onRefresh(); showAlert('Facility assigned to block', 'success'); }
    else showAlert(d.message || 'Error', 'error');
  };

  const unassign = async (branchId, branchName) => {
    if (!window.confirm(`Remove "${branchName}" from this block?`)) return;
    const r = await fetch(`${API}/api/branches/center/${branchId}/block`, {
      method: 'PATCH', headers: hdr(),
      body: JSON.stringify({ block_id: null })
    });
    const d = await r.json();
    if (d.success) { onRefresh(); showAlert('Facility removed from block', 'success'); }
    else showAlert(d.message || 'Error', 'error');
  };

  const typeColor = { PHC:'#dbeafe', CHC:'#dcfce7', UPHC:'#fef9c3', SDH:'#f3e8ff', DHH:'#ffedd5', Hospital:'#f1f5f9' };

  return (
    <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'14px 16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <span style={{ fontSize:12, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.5px' }}>
          Facilities in {block.name}
        </span>
        <span style={{ fontSize:11, color:'#94a3b8' }}>{assigned.length} assigned</span>
      </div>

      {/* Assign row */}
      <div style={{ display:'flex', gap:8, marginBottom:12, alignItems:'center' }}>
        <select
          style={{ ...sel, flex:1 }}
          value={selBranch}
          onChange={e => setSelBranch(e.target.value)}
        >
          <option value="">Assign an unassigned facility…</option>
          {unassigned.map(b => (
            <option key={b.id} value={b.id}>{b.branch_name} ({b.hospital_code})</option>
          ))}
        </select>
        <button
          onClick={assign}
          disabled={!selBranch}
          style={{ padding:'7px 16px', background: selBranch ? '#4f46e5':'#e2e8f0', color: selBranch ? '#fff':'#94a3b8', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor: selBranch ? 'pointer':'default', whiteSpace:'nowrap' }}
        >
          Assign
        </button>
      </div>

      {assigned.length === 0 && (
        <div style={{ textAlign:'center', padding:'14px 0', color:'#94a3b8', fontSize:12 }}>
          No facilities assigned yet. Use the dropdown above to assign one.
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {assigned.map(b => (
          <div key={b.id} style={{ display:'flex', alignItems:'center', background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, padding:'9px 12px', gap:10 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:'#6ee7b7', flexShrink:0 }} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:600, fontSize:13, color:'#1e293b', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{b.branch_name}</div>
              <div style={{ fontSize:11, color:'#94a3b8', marginTop:1 }}>{b.hospital_code} · {b.address || 'No address'}</div>
            </div>
            {b.facility_type && (
              <span style={{ padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:700, background: typeColor[b.facility_type] || '#f1f5f9', color:'#475569', flexShrink:0 }}>{b.facility_type}</span>
            )}
            <span style={{ padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:600, background: b.status==='Active'?'#dcfce7':'#fee2e2', color: b.status==='Active'?'#166534':'#991b1b', flexShrink:0 }}>{b.status}</span>
            <button onClick={() => unassign(b.id, b.branch_name)} style={{ padding:'4px 10px', border:'1px solid #fca5a5', background:'#fff', color:'#dc2626', borderRadius:6, fontSize:11, cursor:'pointer', flexShrink:0 }}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Blocks Tab ────────────────────────────────────────────────────────────────
function BlocksTab({ showAlert }) {
  const [blocks, setBlocks]         = useState([]);
  const [districts, setDistricts]   = useState([]);
  const [states, setStates]         = useState([]);
  const [branches, setBranches]     = useState([]);
  const [filterState, setFilterState] = useState('');
  const [filterDist, setFilterDist]   = useState('');
  const [expandedBlock, setExpandedBlock] = useState(null);
  const [modal, setModal]           = useState(false);
  const [editing, setEditing]       = useState(null);
  const [form, setForm]             = useState({ name:'', state_id:'', district_id:'' });

  const load = async () => {
    const [br, bl, st] = await Promise.all([
      fetch(`${API}/api/branches`, { headers: hdr() }).then(r=>r.json()),
      fetch(`${API}/api/org/blocks`, { headers: hdr() }).then(r=>r.json()),
      fetch(`${API}/api/org/states`, { headers: hdr() }).then(r=>r.json()),
    ]);
    if (br.success) {
      setDistricts(br.districts || []);
      setBranches(br.branches || []);
    }
    if (bl.success) setBlocks(bl.blocks || []);
    if (st.success) setStates(st.states || []);
  };
  useEffect(() => { load(); }, []);

  const stateOfDistrict = (districtId) => {
    const dist = districts.find(d => d.id == districtId);
    if (!dist || !dist.state_id) return null;
    return states.find(s => s.id == dist.state_id) || null;
  };

  const facilityCount = (blockId) => branches.filter(b => b.block_id == blockId).length;

  const open = (b) => {
    const stateId = b ? (stateOfDistrict(b.district_id)?.id || '') : '';
    setEditing(b || null);
    setForm(b ? { name:b.name, state_id: String(stateId), district_id: String(b.district_id) } : { name:'', state_id:'', district_id:'' });
    setModal(true);
  };

  const districtsByState = form.state_id
    ? districts.filter(d => String(d.state_id) === String(form.state_id))
    : districts;

  const save = async () => {
    if (!form.name || !form.district_id) return showAlert('Name and district are required', 'warning');
    const url = editing ? `${API}/api/org/blocks/${editing.id}` : `${API}/api/org/blocks`;
    const r = await fetch(url, { method: editing?'PUT':'POST', headers: hdr(), body: JSON.stringify({ name: form.name, district_id: form.district_id }) });
    const d = await r.json();
    if (d.success) { setModal(false); load(); showAlert('Saved', 'success'); }
    else showAlert(d.message||'Error', 'error');
  };

  const del = async (id) => {
    if (!window.confirm('Delete this block?')) return;
    const r = await fetch(`${API}/api/org/blocks/${id}`, { method:'DELETE', headers: hdr() });
    const d = await r.json();
    if (d.success) { if (expandedBlock === id) setExpandedBlock(null); load(); showAlert('Deleted','success'); }
    else showAlert(d.message||'Error','error');
  };

  const filteredDistsForTable = filterState ? districts.filter(d => String(d.state_id) === filterState) : districts;
  const filteredDistIds = filteredDistsForTable.map(d => d.id);
  const filtered = blocks.filter(b => {
    if (filterState && !filteredDistIds.includes(b.district_id)) return false;
    if (filterDist && b.district_id != filterDist) return false;
    return true;
  });

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:700 }}>Blocks</h3>
          <select style={{ ...sel, width:'auto' }} value={filterState} onChange={e => { setFilterState(e.target.value); setFilterDist(''); }}>
            <option value="">All States</option>
            {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select style={{ ...sel, width:'auto' }} value={filterDist} onChange={e => setFilterDist(e.target.value)}>
            <option value="">All Districts</option>
            {(filterState ? districts.filter(d => String(d.state_id) === filterState) : districts).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <button onClick={() => open(null)} style={{ padding:'8px 16px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>+ Add Block</button>
      </div>

      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr style={{ background:'#f8fafc' }}>
          {['Block Name','State','District','Facilities',''].map(h => <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', borderBottom:'1.5px solid #e2e8f0' }}>{h}</th>)}
        </tr></thead>
        <tbody>{filtered.map(b => {
          const st = stateOfDistrict(b.district_id);
          const isOpen = expandedBlock === b.id;
          return (
            <>
              <tr key={b.id} style={{ borderBottom: isOpen ? 'none':'1px solid #f1f5f9', background: isOpen ? '#fafbff':'' }}>
                <td style={{ padding:'10px 12px', fontWeight:600 }}>{b.name}</td>
                <td style={{ padding:'10px 12px', color:'#64748b' }}>{st ? st.name : '—'}</td>
                <td style={{ padding:'10px 12px', color:'#64748b' }}>{b.district_name}</td>
                <td style={{ padding:'10px 12px' }}>
                  <button
                    onClick={() => setExpandedBlock(isOpen ? null : b.id)}
                    style={{ padding:'3px 10px', border:'1px solid #a7f3d0', background: isOpen ? '#ecfdf5':'#fff', color:'#059669', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}
                  >
                    {facilityCount(b.id)} Facilities {isOpen ? '▲':'▼'}
                  </button>
                </td>
                <td style={{ padding:'10px 12px' }}>
                  <button onClick={() => open(b)} style={{ marginRight:6, padding:'4px 10px', border:'1px solid #e2e8f0', background:'#fff', borderRadius:6, fontSize:12, cursor:'pointer' }}>Edit</button>
                  <button onClick={() => del(b.id)} style={{ padding:'4px 10px', border:'1px solid #fca5a5', background:'#fff', color:'#dc2626', borderRadius:6, fontSize:12, cursor:'pointer' }}>Delete</button>
                </td>
              </tr>
              {isOpen && (
                <tr key={`${b.id}-facilities`}>
                  <td colSpan={5} style={{ padding:'0 16px 16px', background:'#fafbff', borderBottom:'1px solid #e2e8f0' }}>
                    <FacilityManager
                      block={b}
                      allBranches={branches}
                      onRefresh={load}
                      showAlert={showAlert}
                    />
                  </td>
                </tr>
              )}
            </>
          );
        })}</tbody>
      </table>
      {filtered.length === 0 && <div style={{ textAlign:'center', padding:40, color:'#94a3b8', fontSize:13 }}>No blocks found.</div>}

      {modal && <Modal title={editing?'Edit Block':'Add Block'} onClose={() => setModal(false)}>
        <Field label="Block Name" required><input style={inp} value={form.name} onChange={e => setForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Ranchi Block" /></Field>
        <Field label="State" required>
          <select style={sel} value={form.state_id} onChange={e => setForm(p=>({...p, state_id:e.target.value, district_id:''}))}>
            <option value="">Select state…</option>
            {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="District" required>
          <select style={sel} value={form.district_id} onChange={e => setForm(p=>({...p,district_id:e.target.value}))} disabled={!form.state_id}>
            <option value="">{form.state_id ? 'Select district…' : 'Select a state first'}</option>
            {districtsByState.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:20 }}>
          <button onClick={() => setModal(false)} style={{ padding:'8px 16px', border:'1.5px solid #e2e8f0', background:'none', borderRadius:7, fontSize:13, cursor:'pointer' }}>Cancel</button>
          <button onClick={save} style={{ padding:'8px 20px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>Save</button>
        </div>
      </Modal>}
    </div>
  );
}

// ── Specialties Tab ───────────────────────────────────────────────────────────
function SpecialtiesTab({ showAlert }) {
  const [specs, setSpecs]     = useState([]);
  const [modal, setModal]     = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState({ name:'', code:'', description:'', branch_specific: false });

  const load = async () => {
    const r = await fetch(`${API}/api/org/specialties?branch_id=${bId()}`, { headers: hdr() });
    const d = await r.json();
    if (d.success) setSpecs(d.specialties || []);
  };
  useEffect(() => { load(); }, []);

  const open = (s) => {
    setEditing(s||null);
    setForm(s ? { name:s.name, code:s.code||'', description:s.description||'', branch_specific:!!s.branch_id } : { name:'', code:'', description:'', branch_specific:false });
    setModal(true);
  };

  const save = async () => {
    if (!form.name) return showAlert('Name is required', 'warning');
    const payload = { name:form.name, code:form.code||null, description:form.description||null, branch_id: form.branch_specific ? bId() : null };
    const url = editing ? `${API}/api/org/specialties/${editing.id}` : `${API}/api/org/specialties`;
    const r = await fetch(url, { method: editing?'PUT':'POST', headers: hdr(), body: JSON.stringify(payload) });
    const d = await r.json();
    if (d.success) { setModal(false); load(); showAlert('Saved','success'); } else showAlert(d.message||'Error','error');
  };

  const del = async (id) => {
    if (!window.confirm('Delete this specialty?')) return;
    const r = await fetch(`${API}/api/org/specialties/${id}`, { method:'DELETE', headers: hdr() });
    const d = await r.json();
    if (d.success) { load(); showAlert('Deleted','success'); } else showAlert(d.message||'Error','error');
  };

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h3 style={{ margin:0, fontSize:16, fontWeight:700 }}>Clinical Specialties</h3>
        <button onClick={() => open(null)} style={{ padding:'8px 16px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>+ Add Specialty</button>
      </div>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr style={{ background:'#f8fafc' }}>
          {['Specialty','Code','Description','Scope','Status',''].map(h => <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', borderBottom:'1.5px solid #e2e8f0' }}>{h}</th>)}
        </tr></thead>
        <tbody>{specs.map(s => (
          <tr key={s.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
            <td style={{ padding:'10px 12px', fontWeight:600 }}>{s.name}</td>
            <td style={{ padding:'10px 12px', fontFamily:'monospace', fontSize:12 }}>{s.code||'—'}</td>
            <td style={{ padding:'10px 12px', fontSize:12, color:'#64748b', maxWidth:180 }}>{s.description||'—'}</td>
            <td style={{ padding:'10px 12px' }}><Badge label={s.branch_id ? 'Local':'Global'} color={s.branch_id ? 'blue':'grey'} /></td>
            <td style={{ padding:'10px 12px' }}><Badge label={s.is_active ? 'Active':'Inactive'} color={s.is_active ? 'green':'grey'} /></td>
            <td style={{ padding:'10px 12px' }}>
              <button onClick={() => open(s)} style={{ marginRight:6, padding:'4px 10px', border:'1px solid #e2e8f0', background:'#fff', borderRadius:6, fontSize:12, cursor:'pointer' }}>Edit</button>
              {s.branch_id && <button onClick={() => del(s.id)} style={{ padding:'4px 10px', border:'1px solid #fca5a5', background:'#fff', color:'#dc2626', borderRadius:6, fontSize:12, cursor:'pointer' }}>Delete</button>}
            </td>
          </tr>
        ))}</tbody>
      </table>
      {modal && <Modal title={editing?'Edit Specialty':'Add Specialty'} onClose={() => setModal(false)}>
        <Field label="Name" required><input style={inp} value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Cardiology" /></Field>
        <Field label="Code"><input style={inp} value={form.code} onChange={e=>setForm(p=>({...p,code:e.target.value.toUpperCase()}))} placeholder="e.g. CARD" maxLength={20} /></Field>
        <Field label="Description"><textarea style={{...inp,height:60,resize:'vertical'}} value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} /></Field>
        <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer', marginTop:4 }}>
          <input type="checkbox" checked={form.branch_specific} onChange={e=>setForm(p=>({...p,branch_specific:e.target.checked}))} />
          Branch-specific (only visible to this facility)
        </label>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:20 }}>
          <button onClick={() => setModal(false)} style={{ padding:'8px 16px', border:'1.5px solid #e2e8f0', background:'none', borderRadius:7, fontSize:13, cursor:'pointer' }}>Cancel</button>
          <button onClick={save} style={{ padding:'8px 20px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>Save</button>
        </div>
      </Modal>}
    </div>
  );
}

// ── Beds Tab ──────────────────────────────────────────────────────────────────
function BedsTab({ showAlert }) {
  const [wards, setWards]       = useState([]);
  const [selWard, setSelWard]   = useState('');
  const [beds, setBeds]         = useState([]);
  const [summary, setSummary]   = useState({});
  const [modal, setModal]       = useState(false);
  const [bulkModal, setBulkModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState({ bed_number:'', ward_id:'', bed_type:'General', status:'Available' });
  const [bulk, setBulk]         = useState({ ward_id:'', bed_type:'General', prefix:'', start_number:1, count:10 });

  const loadWards = async () => {
    const [w, i] = await Promise.all([
      fetch(`${API}/api/infra?type=Ward&branch_id=${bId()}`, { headers: hdr() }).then(r=>r.json()),
      fetch(`${API}/api/infra?type=ICU&branch_id=${bId()}`, { headers: hdr() }).then(r=>r.json()),
    ]);
    setWards([...(w.items||[]), ...(i.items||[])]);
  };

  const loadBeds = async (wardId) => {
    if (!wardId) return;
    const r = await fetch(`${API}/api/org/beds?branch_id=${bId()}&ward_id=${wardId}`, { headers: hdr() });
    const d = await r.json();
    if (d.success) { setBeds(d.beds||[]); setSummary(d.summary||{}); }
  };

  useEffect(() => { loadWards(); }, []);
  useEffect(() => { loadBeds(selWard); }, [selWard]);

  const changeStatus = async (bed) => {
    const next = { Available:'Occupied', Occupied:'Under Maintenance', 'Under Maintenance':'Reserved', Reserved:'Available' };
    const r = await fetch(`${API}/api/org/beds/${bed.id}/status`, { method:'PATCH', headers: hdr(), body: JSON.stringify({ status: next[bed.status] }) });
    const d = await r.json();
    if (d.success) loadBeds(selWard);
  };

  const saveBed = async () => {
    if (!form.bed_number || !form.ward_id) return showAlert('Bed number and ward are required', 'warning');
    const url = editing ? `${API}/api/org/beds/${editing.id}` : `${API}/api/org/beds`;
    const r = await fetch(url, { method: editing?'PUT':'POST', headers: hdr(), body: JSON.stringify({ ...form, branch_id: bId() }) });
    const d = await r.json();
    if (d.success) { setModal(false); loadBeds(selWard); showAlert('Saved','success'); } else showAlert(d.message||'Error','error');
  };

  const saveBulk = async () => {
    if (!bulk.ward_id || !bulk.count) return showAlert('Ward and count are required', 'warning');
    const r = await fetch(`${API}/api/org/beds/bulk`, { method:'POST', headers: hdr(), body: JSON.stringify({ ...bulk, branch_id: bId() }) });
    const d = await r.json();
    if (d.success) { setBulkModal(false); loadBeds(selWard); showAlert(`${d.created} beds created`, 'success'); } else showAlert(d.message||'Error','error');
  };

  const delBed = async (id) => {
    if (!window.confirm('Delete this bed?')) return;
    const r = await fetch(`${API}/api/org/beds/${id}?branch_id=${bId()}`, { method:'DELETE', headers: hdr() });
    const d = await r.json();
    if (d.success) { loadBeds(selWard); showAlert('Deleted','success'); }
  };

  const statusColor = { Available:'#22c55e', Occupied:'#ef4444', 'Under Maintenance':'#f59e0b', Reserved:'#8b5cf6' };

  const previewBulk = () => {
    const start = parseInt(bulk.start_number)||1;
    const count = Math.min(parseInt(bulk.count)||10, 100);
    const first = (bulk.prefix||'') + String(start).padStart(2,'0');
    const last  = (bulk.prefix||'') + String(start+count-1).padStart(2,'0');
    return `${first} → ${last} (${count} beds)`;
  };

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:700 }}>Bed Management</h3>
          <select style={{ ...sel, width:'auto' }} value={selWard} onChange={e => setSelWard(e.target.value)}>
            <option value="">Select a ward / ICU…</option>
            {wards.map(w => <option key={w.id} value={w.id}>{w.name} ({w.type})</option>)}
          </select>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => { setEditing(null); setForm({ bed_number:'', ward_id:selWard||'', bed_type:'General', status:'Available' }); setModal(true); }} style={{ padding:'8px 14px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>+ Add Bed</button>
          <button onClick={() => { setBulk(p=>({...p, ward_id:selWard||''})); setBulkModal(true); }} style={{ padding:'8px 14px', background:'#059669', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>Bulk Add</button>
        </div>
      </div>

      {selWard && summary.total > 0 && (
        <div style={{ display:'flex', gap:10, marginBottom:18 }}>
          {[['Total', summary.total, '#4f46e5'], ['Available', summary.available, '#22c55e'], ['Occupied', summary.occupied, '#ef4444'], ['Maintenance', summary.maintenance, '#f59e0b'], ['Reserved', summary.reserved, '#8b5cf6']].map(([l,v,c]) => (
            <div key={l} style={{ flex:1, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'12px', textAlign:'center' }}>
              <div style={{ fontSize:22, fontWeight:700, color:c }}>{v||0}</div>
              <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{l}</div>
            </div>
          ))}
        </div>
      )}

      {!selWard && <div style={{ textAlign:'center', padding:60, color:'#94a3b8', fontSize:13 }}>Select a ward or ICU above to manage its beds.</div>}

      {selWard && beds.length === 0 && <div style={{ textAlign:'center', padding:40, color:'#94a3b8', fontSize:13 }}>No beds in this ward. Add some using the buttons above.</div>}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(110px, 1fr))', gap:10 }}>
        {beds.map(b => (
          <div key={b.id} style={{ border:`2.5px solid ${statusColor[b.status]||'#e2e8f0'}`, borderRadius:10, padding:'12px 8px', textAlign:'center', background:'#fff', position:'relative' }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#1e293b', marginBottom:3 }}>{b.bed_number}</div>
            <div style={{ fontSize:10, color:'#64748b', marginBottom:6 }}>{b.bed_type}</div>
            <div style={{ fontSize:10, fontWeight:600, color: statusColor[b.status], marginBottom:8 }}>{b.status}</div>
            <div style={{ display:'flex', gap:4, justifyContent:'center' }}>
              <button onClick={() => changeStatus(b)} title="Cycle status" style={{ padding:'2px 6px', border:'1px solid #e2e8f0', background:'#f8fafc', borderRadius:4, fontSize:10, cursor:'pointer' }}>↻</button>
              <button onClick={() => { setEditing(b); setForm({ bed_number:b.bed_number, ward_id:b.ward_id, bed_type:b.bed_type, status:b.status }); setModal(true); }} style={{ padding:'2px 6px', border:'1px solid #e2e8f0', background:'#f8fafc', borderRadius:4, fontSize:10, cursor:'pointer' }}>✎</button>
              <button onClick={() => delBed(b.id)} style={{ padding:'2px 6px', border:'1px solid #fca5a5', background:'#fff', color:'#dc2626', borderRadius:4, fontSize:10, cursor:'pointer' }}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {modal && <Modal title={editing?'Edit Bed':'Add Bed'} onClose={() => setModal(false)}>
        <Field label="Bed Number" required><input style={inp} value={form.bed_number} onChange={e=>setForm(p=>({...p,bed_number:e.target.value}))} placeholder="e.g. W1-01" /></Field>
        <Field label="Ward / ICU" required>
          <select style={sel} value={form.ward_id} onChange={e=>setForm(p=>({...p,ward_id:e.target.value}))}>
            <option value="">Select…</option>
            {wards.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Bed Type">
          <select style={sel} value={form.bed_type} onChange={e=>setForm(p=>({...p,bed_type:e.target.value}))}>
            {BED_TYPES.map(t=><option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select style={sel} value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))}>
            {BED_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
        </Field>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:20 }}>
          <button onClick={()=>setModal(false)} style={{ padding:'8px 16px', border:'1.5px solid #e2e8f0', background:'none', borderRadius:7, fontSize:13, cursor:'pointer' }}>Cancel</button>
          <button onClick={saveBed} style={{ padding:'8px 20px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>Save</button>
        </div>
      </Modal>}

      {bulkModal && <Modal title="Bulk Add Beds" onClose={()=>setBulkModal(false)}>
        <Field label="Ward / ICU" required>
          <select style={sel} value={bulk.ward_id} onChange={e=>setBulk(p=>({...p,ward_id:e.target.value}))}>
            <option value="">Select…</option>
            {wards.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Bed Type">
          <select style={sel} value={bulk.bed_type} onChange={e=>setBulk(p=>({...p,bed_type:e.target.value}))}>
            {BED_TYPES.map(t=><option key={t}>{t}</option>)}
          </select>
        </Field>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
          <Field label="Prefix"><input style={inp} value={bulk.prefix} onChange={e=>setBulk(p=>({...p,prefix:e.target.value}))} placeholder="e.g. W1-" /></Field>
          <Field label="Start No."><input style={inp} type="number" min={1} value={bulk.start_number} onChange={e=>setBulk(p=>({...p,start_number:e.target.value}))} /></Field>
          <Field label="Count"><input style={inp} type="number" min={1} max={100} value={bulk.count} onChange={e=>setBulk(p=>({...p,count:e.target.value}))} /></Field>
        </div>
        <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#166534', marginBottom:4 }}>
          Preview: <strong>{previewBulk()}</strong>
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
          <button onClick={()=>setBulkModal(false)} style={{ padding:'8px 16px', border:'1.5px solid #e2e8f0', background:'none', borderRadius:7, fontSize:13, cursor:'pointer' }}>Cancel</button>
          <button onClick={saveBulk} style={{ padding:'8px 20px', background:'#059669', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>Create Beds</button>
        </div>
      </Modal>}
    </div>
  );
}

// ── Working Hours Tab ─────────────────────────────────────────────────────────
function WorkingHoursTab({ showAlert }) {
  const [depts, setDepts]     = useState([]);
  const [scope, setScope]     = useState('facility');
  const [deptId, setDeptId]   = useState('');
  const [schedule, setSchedule] = useState(
    DAYS.map((_, i) => ({ day_of_week:i, open_time:'09:00', close_time:'17:00', is_closed: i===0 }))
  );

  const loadDepts = async () => {
    const r = await fetch(`${API}/api/departments?branch_id=${bId()}`, { headers: hdr() });
    const d = await r.json();
    if (d.success) setDepts(d.departments||[]);
  };

  const loadHours = async (dId) => {
    const r = await fetch(`${API}/api/org/working-hours?branch_id=${bId()}`, { headers: hdr() });
    const d = await r.json();
    if (!d.success) return;
    const rows = (d.working_hours||[]).filter(h => (dId ? h.department_id == dId : !h.department_id));
    if (rows.length) {
      const sched = DAYS.map((_, i) => {
        const row = rows.find(r => r.day_of_week === i);
        return row ? { day_of_week:i, open_time: row.open_time?.slice(0,5)||'09:00', close_time: row.close_time?.slice(0,5)||'17:00', is_closed: !!row.is_closed } : { day_of_week:i, open_time:'09:00', close_time:'17:00', is_closed: i===0 };
      });
      setSchedule(sched);
    }
  };

  useEffect(() => { loadDepts(); loadHours(''); }, []);
  useEffect(() => { loadHours(scope==='facility' ? '' : deptId); }, [scope, deptId]);

  const upd = (i, field, val) => setSchedule(p => p.map((s,idx) => idx===i ? {...s, [field]:val} : s));

  const save = async () => {
    const r = await fetch(`${API}/api/org/working-hours`, {
      method:'POST', headers: hdr(),
      body: JSON.stringify({ branch_id: bId(), department_id: scope==='facility' ? null : deptId||null, schedule })
    });
    const d = await r.json();
    if (d.success) showAlert('Working hours saved','success'); else showAlert(d.message||'Error','error');
  };

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h3 style={{ margin:0, fontSize:16, fontWeight:700 }}>Working Hours</h3>
        <button onClick={save} style={{ padding:'8px 20px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>Save Schedule</button>
      </div>
      <div style={{ display:'flex', gap:12, marginBottom:20, alignItems:'center' }}>
        <label style={{ fontSize:13, fontWeight:600, color:'#475569' }}>Schedule for:</label>
        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
          <input type="radio" checked={scope==='facility'} onChange={() => setScope('facility')} /> Whole Facility
        </label>
        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
          <input type="radio" checked={scope==='dept'} onChange={() => setScope('dept')} /> By Department
        </label>
        {scope==='dept' && (
          <select style={{ ...sel, width:'auto' }} value={deptId} onChange={e => setDeptId(e.target.value)}>
            <option value="">Select department…</option>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
      </div>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr style={{ background:'#f8fafc' }}>
          {['Day','Closed','Open Time','Close Time'].map(h => <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', borderBottom:'1.5px solid #e2e8f0' }}>{h}</th>)}
        </tr></thead>
        <tbody>{schedule.map((s, i) => (
          <tr key={i} style={{ borderBottom:'1px solid #f1f5f9', background: s.is_closed ? '#fef9f9':'' }}>
            <td style={{ padding:'10px 12px', fontWeight:600, color:'#1e293b' }}>{DAYS[i]}</td>
            <td style={{ padding:'10px 12px' }}>
              <input type="checkbox" checked={s.is_closed} onChange={e => upd(i,'is_closed',e.target.checked)} style={{ width:16, height:16 }} />
            </td>
            <td style={{ padding:'10px 12px' }}>
              <input type="time" value={s.open_time} disabled={s.is_closed} onChange={e => upd(i,'open_time',e.target.value)} style={{ ...inp, width:'auto', opacity: s.is_closed?0.4:1 }} />
            </td>
            <td style={{ padding:'10px 12px' }}>
              <input type="time" value={s.close_time} disabled={s.is_closed} onChange={e => upd(i,'close_time',e.target.value)} style={{ ...inp, width:'auto', opacity: s.is_closed?0.4:1 }} />
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ── Holidays Tab ──────────────────────────────────────────────────────────────
function HolidaysTab({ showAlert }) {
  const [holidays, setHolidays] = useState([]);
  const [upcoming, setUpcoming] = useState(false);
  const [modal, setModal]       = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState({ holiday_name:'', holiday_date:'', holiday_type:'National', is_recurring:false, scope:'network' });

  const load = async () => {
    const r = await fetch(`${API}/api/org/holidays?branch_id=${bId()}${upcoming?'&upcoming=1':''}`, { headers: hdr() });
    const d = await r.json();
    if (d.success) setHolidays(d.holidays||[]);
  };
  useEffect(() => { load(); }, [upcoming]);

  const open = (h) => {
    setEditing(h||null);
    setForm(h ? { holiday_name:h.holiday_name, holiday_date:h.holiday_date?.split('T')[0]||'', holiday_type:h.holiday_type||'Hospital', is_recurring:!!h.is_recurring, scope: h.branch_id ? 'local':'network' } : { holiday_name:'', holiday_date:'', holiday_type:'National', is_recurring:false, scope:'network' });
    setModal(true);
  };

  const save = async () => {
    if (!form.holiday_name || !form.holiday_date) return showAlert('Name and date are required','warning');
    const payload = { holiday_name:form.holiday_name, holiday_date:form.holiday_date, holiday_type:form.holiday_type, is_recurring:form.is_recurring, branch_id: form.scope==='local' ? bId() : null };
    const url = editing ? `${API}/api/org/holidays/${editing.id}` : `${API}/api/org/holidays`;
    const r = await fetch(url, { method: editing?'PUT':'POST', headers: hdr(), body: JSON.stringify(payload) });
    const d = await r.json();
    if (d.success) { setModal(false); load(); showAlert('Saved','success'); } else showAlert(d.message||'Error','error');
  };

  const del = async (id) => {
    if (!window.confirm('Delete this holiday?')) return;
    const r = await fetch(`${API}/api/org/holidays/${id}`, { method:'DELETE', headers: hdr() });
    const d = await r.json();
    if (d.success) { load(); showAlert('Deleted','success'); }
  };

  const network = holidays.filter(h => !h.branch_id);
  const local   = holidays.filter(h => h.branch_id);
  const typeColor = { National:'blue', State:'green', Local:'yellow', Hospital:'grey' };

  const HolidayTable = ({ rows }) => (
    <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:24 }}>
      <thead><tr style={{ background:'#f8fafc' }}>
        {['Holiday','Date','Type','Recurring',''].map(h => <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', borderBottom:'1.5px solid #e2e8f0' }}>{h}</th>)}
      </tr></thead>
      <tbody>{rows.map(h => (
        <tr key={h.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
          <td style={{ padding:'10px 12px', fontWeight:600 }}>{h.holiday_name}</td>
          <td style={{ padding:'10px 12px', color:'#64748b' }}>{new Date(h.holiday_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td>
          <td style={{ padding:'10px 12px' }}><Badge label={h.holiday_type} color={typeColor[h.holiday_type]||'grey'} /></td>
          <td style={{ padding:'10px 12px', fontSize:13 }}>{h.is_recurring ? '✅ Every year':'—'}</td>
          <td style={{ padding:'10px 12px' }}>
            <button onClick={() => open(h)} style={{ marginRight:6, padding:'4px 10px', border:'1px solid #e2e8f0', background:'#fff', borderRadius:6, fontSize:12, cursor:'pointer' }}>Edit</button>
            <button onClick={() => del(h.id)} style={{ padding:'4px 10px', border:'1px solid #fca5a5', background:'#fff', color:'#dc2626', borderRadius:6, fontSize:12, cursor:'pointer' }}>Delete</button>
          </td>
        </tr>
      ))}{rows.length===0 && <tr><td colSpan={5} style={{ padding:24, textAlign:'center', color:'#94a3b8', fontSize:13 }}>None found</td></tr>}</tbody>
    </table>
  );

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:700 }}>Holidays</h3>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
            <input type="checkbox" checked={upcoming} onChange={e=>setUpcoming(e.target.checked)} /> Upcoming only
          </label>
        </div>
        <button onClick={() => open(null)} style={{ padding:'8px 16px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>+ Add Holiday</button>
      </div>

      <h4 style={{ fontSize:13, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.6px', margin:'0 0 8px' }}>Network-wide Holidays</h4>
      <HolidayTable rows={network} />

      <h4 style={{ fontSize:13, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.6px', margin:'0 0 8px' }}>This Facility Holidays</h4>
      <HolidayTable rows={local} />

      {modal && <Modal title={editing?'Edit Holiday':'Add Holiday'} onClose={() => setModal(false)}>
        <Field label="Holiday Name" required><input style={inp} value={form.holiday_name} onChange={e=>setForm(p=>({...p,holiday_name:e.target.value}))} placeholder="e.g. Republic Day" /></Field>
        <Field label="Date" required><input type="date" style={inp} value={form.holiday_date} onChange={e=>setForm(p=>({...p,holiday_date:e.target.value}))} /></Field>
        <Field label="Type">
          <select style={sel} value={form.holiday_type} onChange={e=>setForm(p=>({...p,holiday_type:e.target.value}))}>
            {HOL_TYPES.map(t=><option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Apply to">
          <div style={{ display:'flex', gap:16 }}>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}><input type="radio" checked={form.scope==='network'} onChange={() => setForm(p=>({...p,scope:'network'}))} /> Network-wide</label>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}><input type="radio" checked={form.scope==='local'} onChange={() => setForm(p=>({...p,scope:'local'}))} /> This facility only</label>
          </div>
        </Field>
        <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer', marginTop:4 }}>
          <input type="checkbox" checked={form.is_recurring} onChange={e=>setForm(p=>({...p,is_recurring:e.target.checked}))} />
          Repeat every year on same date
        </label>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:20 }}>
          <button onClick={() => setModal(false)} style={{ padding:'8px 16px', border:'1.5px solid #e2e8f0', background:'none', borderRadius:7, fontSize:13, cursor:'pointer' }}>Cancel</button>
          <button onClick={save} style={{ padding:'8px 20px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>Save</button>
        </div>
      </Modal>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const TABS = [
  { id:'departments',   label:'Departments' },
  { id:'states',        label:'States' },
  { id:'blocks',        label:'Blocks' },
  { id:'specialties',   label:'Specialties' },
  { id:'beds',          label:'Bed Management' },
  { id:'working-hours', label:'Working Hours' },
  { id:'holidays',      label:'Holidays' },
];

export default function OrgManagement() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [activeTab, setActiveTab] = useState('departments');

  return (
    <>
      <style>{`
        .org-page { padding:24px; max-width:1400px; margin:0 auto; }
        .org-header { margin-bottom:24px; }
        .org-header h1 { font-size:22px; font-weight:800; color:#1e293b; margin:0 0 4px; }
        .org-header p { font-size:13px; color:#94a3b8; margin:0; }
        .org-tabs { display:flex; gap:2px; border-bottom:2px solid #e2e8f0; margin-bottom:24px; overflow-x:auto; }
        .org-tab { padding:10px 18px; border:none; background:none; font-size:13px; font-weight:600; color:#64748b; cursor:pointer; border-bottom:2.5px solid transparent; white-space:nowrap; }
        .org-tab.active { color:#4f46e5; border-bottom-color:#4f46e5; }
        .org-tab:hover:not(.active) { color:#334155; background:#f8fafc; }
      `}</style>

      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={3000} />}

      <div className="org-page">
        <div className="org-header">
          <h1>Organization Management</h1>
          <p>Manage the health network hierarchy — departments, specialties, beds, working hours and holidays</p>
        </div>

        <div className="org-tabs">
          {TABS.map(t => (
            <button key={t.id} className={`org-tab ${activeTab===t.id?'active':''}`} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'departments'   && <DepartmentsTab  showAlert={showAlert} />}
        {activeTab === 'states'        && <StatesTab        showAlert={showAlert} />}
        {activeTab === 'blocks'        && <BlocksTab        showAlert={showAlert} />}
        {activeTab === 'specialties'   && <SpecialtiesTab   showAlert={showAlert} />}
        {activeTab === 'beds'          && <BedsTab          showAlert={showAlert} />}
        {activeTab === 'working-hours' && <WorkingHoursTab  showAlert={showAlert} />}
        {activeTab === 'holidays'      && <HolidaysTab      showAlert={showAlert} />}
      </div>
    </>
  );
}
