import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import TestsTab from './TestsTab';
import { useIdleLogout } from '../../hooks/useIdleLogout';
import { clearDeveloperSession, hasDeveloperToken } from '../../utils/session';

const API = import.meta.env.VITE_API_URL || '';
// VAPT #23 (Clipboard Data Stealing Attack): matches Login.jsx/ChangePassword.jsx.
const blockClipboard = (e) => e.preventDefault();

const ROLES = ['Admin', 'Doctor', 'Lab Technician', 'Lab Doctor', 'Lab Head', 'Receptionist', 'Pharmacist', 'Nurse'];
const ROLE_LEVELS = ['Central', 'Sub-Central', 'Branch'];
const BRANCH_LEVELS = ['Central', 'Sub-Central', 'Center'];
const LAB_STATUSES = ['Available', 'Occupied', 'Maintenance'];

// ── Reusable Modal ─────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <span style={S.modalTitle}>{title}</span>
          <button style={S.modalClose} onClick={onClose}>✕</button>
        </div>
        <div style={S.modalBody}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={S.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────
function OverviewTab({ stats }) {
  if (!stats) return <div style={S.loading}>Loading…</div>;
  const cards = [
    { label: 'Hospitals',     value: stats.hospitals,     color: '#38bdf8', icon: '🏥' },
    { label: 'Labs',          value: stats.labs,          color: '#a78bfa', icon: '🧪' },
    { label: 'Total Users',   value: stats.users,         color: '#34d399', icon: '👥' },
    { label: 'Active Users',  value: stats.active_users,  color: '#fbbf24', icon: '✅' },
    { label: 'Districts',     value: stats.districts,     color: '#f472b6', icon: '📍' },
    { label: "Today's Bills", value: stats.bills_today,   color: '#fb923c', icon: '💳' },
    { label: "Today's Tests", value: stats.tests_today,   color: '#4ade80', icon: '🔬' },
  ];
  return (
    <div>
      <div style={S.statsGrid}>
        {cards.map(c => (
          <div key={c.label} style={{ ...S.statCard, borderTop: `3px solid ${c.color}` }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>{c.icon}</div>
            <div style={{ fontSize: '32px', fontWeight: '700', color: c.color }}>{c.value}</div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>{c.label}</div>
          </div>
        ))}
      </div>
      <div style={S.infoBox}>
        <strong style={{ color: '#38bdf8' }}>Developer Session</strong> — You are logged in as the system developer.
        All changes take effect immediately across all hospitals.
      </div>
    </div>
  );
}

// ── Hospitals Tab ─────────────────────────────────────────────────────────
function HospitalsTab() {
  const [hospitals, setHospitals] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [search, setSearch]       = useState('');
  const [modal, setModal]         = useState(null); // null | 'add' | 'edit' | 'district'
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({ branch_name:'', hospital_code:'', category:'General Lab', address:'', contact_number:'', district_id:'', branch_level:'Center', parent_branch_id:'', status:'Active' });
  const [districtForm, setDistrictForm] = useState({ name:'', state:'Karnataka' });
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState('');

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/api/dev/hospitals`);
    setHospitals(data.hospitals || []);
    setDistricts(data.districts || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd  = () => { setEditing(null); setForm({ branch_name:'', hospital_code:'', category:'General Lab', address:'', contact_number:'', district_id:'', branch_level:'Center', parent_branch_id:'', status:'Active' }); setErr(''); setModal('add'); };
  const openEdit = (h) => { setEditing(h); setForm({ branch_name:h.branch_name, hospital_code:h.hospital_code, category:h.category||'General Lab', address:h.address||'', contact_number:h.contact_number||'', district_id:h.district_id, branch_level:h.branch_level||'Center', parent_branch_id:h.parent_branch_id||'', status:h.status||'Active' }); setErr(''); setModal('edit'); };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (modal === 'add') await axios.post(`${API}/api/dev/hospitals`, form);
      else await axios.put(`${API}/api/dev/hospitals/${editing.id}`, form);
      await load(); setModal(null);
    } catch (e) { setErr(e.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Delete this hospital? This cannot be undone.')) return;
    try { await axios.delete(`${API}/api/dev/hospitals/${id}`); await load(); }
    catch (e) { alert(e.response?.data?.message || 'Cannot delete'); }
  };

  const addDistrict = async () => {
    setSaving(true); setErr('');
    try { await axios.post(`${API}/api/dev/districts`, districtForm); await load(); setModal(null); }
    catch (e) { setErr(e.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const filtered = hospitals.filter(h => h.branch_name?.toLowerCase().includes(search.toLowerCase()) || h.hospital_code?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div style={S.toolbar}>
        <input style={S.search} placeholder="Search hospitals…" value={search} onChange={e => setSearch(e.target.value)} />
        <button style={S.btnSecondary} onClick={() => { setDistrictForm({ name:'', state:'Karnataka' }); setErr(''); setModal('district'); }}>+ District</button>
        <button style={S.btnPrimary}   onClick={openAdd}>+ Hospital</button>
      </div>

      <table style={S.table}>
        <thead><tr style={S.thead}>
          {['Name','Code','Level','District','Category','Address','Contact','Status',''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {filtered.map(h => (
            <tr key={h.id} style={S.tr}>
              <td style={S.td}><strong style={{ color: '#f1f5f9' }}>{h.branch_name}</strong></td>
              <td style={S.td}><span style={S.code}>{h.hospital_code}</span></td>
              <td style={S.td}><span style={{ ...S.badge, background: h.branch_level === 'Central' ? '#1e3a5f' : h.branch_level === 'Sub-Central' ? '#1e3a4a' : '#1a2e1a', color: h.branch_level === 'Central' ? '#38bdf8' : h.branch_level === 'Sub-Central' ? '#67e8f9' : '#4ade80' }}>{h.branch_level}</span></td>
              <td style={S.td}>{h.district_name || '—'}</td>
              <td style={S.td}>{h.category}</td>
              <td style={S.td}>{h.address || '—'}</td>
              <td style={S.td}>{h.contact_number || '—'}</td>
              <td style={S.td}><span style={{ ...S.badge, background: h.status === 'Active' ? '#14532d' : '#450a0a', color: h.status === 'Active' ? '#4ade80' : '#f87171' }}>{h.status}</span></td>
              <td style={S.td}>
                <button style={S.iconBtn} onClick={() => openEdit(h)}>✏️</button>
                <button style={S.iconBtn} onClick={() => del(h.id)}>🗑️</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(modal === 'add' || modal === 'edit') && (
        <Modal title={modal === 'add' ? 'Add Hospital' : 'Edit Hospital'} onClose={() => setModal(null)}>
          {err && <div style={S.errMsg}>{err}</div>}
          <Field label="Hospital Name *"><input style={S.input} value={form.branch_name} onChange={e => setForm({...form, branch_name: e.target.value})} /></Field>
          <Field label="Hospital Code *"><input style={S.input} value={form.hospital_code} onChange={e => setForm({...form, hospital_code: e.target.value.toUpperCase()})} placeholder="e.g. H001" /></Field>
          <Field label="District *">
            <select style={S.input} value={form.district_id} onChange={e => setForm({...form, district_id: e.target.value})}>
              <option value="">Select district…</option>
              {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Branch Level">
            <select style={S.input} value={form.branch_level} onChange={e => setForm({...form, branch_level: e.target.value})}>
              {BRANCH_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Category"><input style={S.input} value={form.category} onChange={e => setForm({...form, category: e.target.value})} /></Field>
          <Field label="Address"><input style={S.input} value={form.address} onChange={e => setForm({...form, address: e.target.value})} /></Field>
          <Field label="Contact"><input style={S.input} value={form.contact_number} onChange={e => setForm({...form, contact_number: e.target.value})} /></Field>
          {modal === 'edit' && <Field label="Status"><select style={S.input} value={form.status} onChange={e => setForm({...form, status: e.target.value})}><option>Active</option><option>Inactive</option></select></Field>}
          <button style={S.btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </Modal>
      )}

      {modal === 'district' && (
        <Modal title="Add District" onClose={() => setModal(null)}>
          {err && <div style={S.errMsg}>{err}</div>}
          <Field label="District Name *"><input style={S.input} value={districtForm.name} onChange={e => setDistrictForm({...districtForm, name: e.target.value})} autoFocus /></Field>
          <Field label="State"><input style={S.input} value={districtForm.state} onChange={e => setDistrictForm({...districtForm, state: e.target.value})} /></Field>
          <button style={S.btnPrimary} onClick={addDistrict} disabled={saving}>{saving ? 'Saving…' : 'Create District'}</button>
        </Modal>
      )}
    </div>
  );
}

// ── Labs Tab ──────────────────────────────────────────────────────────────
function LabsTab({ hospitals }) {
  const [labs, setLabs]           = useState([]);
  const [branchFilter, setBranch] = useState('');
  const [modal, setModal]         = useState(null);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({ name:'', branch_id:'', block:'', floor:'', capacity:1, status:'Available' });
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState('');

  const load = useCallback(async () => {
    const params = branchFilter ? `?branch_id=${branchFilter}` : '';
    const { data } = await axios.get(`${API}/api/dev/labs${params}`);
    setLabs(data.labs || []);
  }, [branchFilter]);

  useEffect(() => { load(); }, [load]);

  const openAdd  = () => { setEditing(null); setForm({ name:'', branch_id: branchFilter||'', block:'', floor:'', capacity:1, status:'Available' }); setErr(''); setModal('form'); };
  const openEdit = (l) => { setEditing(l); setForm({ name:l.name, branch_id:l.branch_id, block:l.block||'', floor:l.floor||'', capacity:l.capacity||1, status:l.status||'Available' }); setErr(''); setModal('form'); };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (!editing) await axios.post(`${API}/api/dev/labs`, form);
      else await axios.put(`${API}/api/dev/labs/${editing.id}`, form);
      await load(); setModal(null);
    } catch (e) { setErr(e.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Delete this lab?')) return;
    try { await axios.delete(`${API}/api/dev/labs/${id}`); await load(); }
    catch (e) { alert(e.response?.data?.message || 'Cannot delete'); }
  };

  return (
    <div>
      <div style={S.toolbar}>
        <select style={S.search} value={branchFilter} onChange={e => setBranch(e.target.value)}>
          <option value="">All Hospitals</option>
          {hospitals.map(h => <option key={h.id} value={h.id}>{h.branch_name} ({h.hospital_code})</option>)}
        </select>
        <button style={S.btnPrimary} onClick={openAdd}>+ Lab</button>
      </div>

      <table style={S.table}>
        <thead><tr style={S.thead}>
          {['Lab Name','Hospital','Block','Floor','Capacity','Machines','Status',''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {labs.map(l => (
            <tr key={l.id} style={S.tr}>
              <td style={S.td}><strong style={{ color: '#f1f5f9' }}>{l.name}</strong></td>
              <td style={S.td}>{l.branch_name || '—'} <span style={S.code}>{l.hospital_code}</span></td>
              <td style={S.td}>{l.block || '—'}</td>
              <td style={S.td}>{l.floor || '—'}</td>
              <td style={S.td}>{l.capacity}</td>
              <td style={S.td}>{l.machine_count || 0}</td>
              <td style={S.td}><span style={{ ...S.badge, background: l.status === 'Available' ? '#14532d' : '#450a0a', color: l.status === 'Available' ? '#4ade80' : '#f87171' }}>{l.status}</span></td>
              <td style={S.td}>
                <button style={S.iconBtn} onClick={() => openEdit(l)}>✏️</button>
                <button style={S.iconBtn} onClick={() => del(l.id)}>🗑️</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal === 'form' && (
        <Modal title={editing ? 'Edit Lab' : 'Add Lab'} onClose={() => setModal(null)}>
          {err && <div style={S.errMsg}>{err}</div>}
          <Field label="Lab Name *"><input style={S.input} value={form.name} onChange={e => setForm({...form, name: e.target.value})} autoFocus /></Field>
          <Field label="Hospital *">
            <select style={S.input} value={form.branch_id} onChange={e => setForm({...form, branch_id: e.target.value})}>
              <option value="">Select hospital…</option>
              {hospitals.map(h => <option key={h.id} value={h.id}>{h.branch_name} ({h.hospital_code})</option>)}
            </select>
          </Field>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            <Field label="Block"><input style={S.input} value={form.block} onChange={e => setForm({...form, block: e.target.value})} /></Field>
            <Field label="Floor"><input style={S.input} value={form.floor} onChange={e => setForm({...form, floor: e.target.value})} /></Field>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            <Field label="Capacity"><input style={S.input} type="number" min="1" value={form.capacity} onChange={e => setForm({...form, capacity: e.target.value})} /></Field>
            <Field label="Status">
              <select style={S.input} value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                {LAB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <button style={S.btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </Modal>
      )}
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────
function UsersTab({ hospitals }) {
  const [users, setUsers]         = useState([]);
  const [branchFilter, setBranch] = useState('');
  const [roleFilter, setRole]     = useState('');
  const [search, setSearch]       = useState('');
  const [modal, setModal]         = useState(null);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({ firstName:'', lastName:'', email:'', phone:'', role:'Lab Technician', department:'', staffId:'', password:'', branch_id:'', role_level:'Branch' });
  const [resetForm, setResetForm] = useState({ password:'' });
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (branchFilter) params.append('branch_id', branchFilter);
    if (roleFilter)   params.append('role', roleFilter);
    const { data } = await axios.get(`${API}/api/dev/users?${params}`);
    setUsers(data.users || []);
  }, [branchFilter, roleFilter]);

  useEffect(() => { load(); }, [load]);

  const openAdd  = () => { setEditing(null); setForm({ firstName:'', lastName:'', email:'', phone:'', role:'Lab Technician', department:'', staffId:'', password:'', branch_id: branchFilter||'', role_level:'Branch' }); setErr(''); setModal('form'); };
  const openEdit = (u) => { setEditing(u); setForm({ firstName:u.first_name, lastName:u.last_name||'', email:u.email, phone:u.phone||'', role:u.role, department:u.department||'', staffId:u.staff_id||'', password:'', branch_id:u.branch_id||'', role_level:u.role_level||'Branch' }); setErr(''); setModal('form'); };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (!editing) await axios.post(`${API}/api/dev/users`, form);
      else await axios.put(`${API}/api/dev/users/${editing.id}`, form);
      await load(); setModal(null);
    } catch (e) { setErr(e.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const toggle = async (u) => {
    try { await axios.patch(`${API}/api/dev/users/${u.id}/toggle`, {}); await load(); }
    catch (e) { alert(e.response?.data?.message || 'Error'); }
  };

  const doReset = async () => {
    setSaving(true); setErr('');
    try { await axios.patch(`${API}/api/dev/users/${editing.id}/reset-password`, resetForm); setModal(null); }
    catch (e) { setErr(e.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return !q || u.first_name?.toLowerCase().includes(q) || u.last_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  return (
    <div>
      <div style={S.toolbar}>
        <input style={S.search} placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)} />
        <select style={{ ...S.search, width: '180px' }} value={branchFilter} onChange={e => setBranch(e.target.value)}>
          <option value="">All Hospitals</option>
          {hospitals.map(h => <option key={h.id} value={h.id}>{h.branch_name}</option>)}
        </select>
        <select style={{ ...S.search, width: '160px' }} value={roleFilter} onChange={e => setRole(e.target.value)}>
          <option value="">All Roles</option>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button style={S.btnPrimary} onClick={openAdd}>+ User</button>
      </div>

      <table style={S.table}>
        <thead><tr style={S.thead}>
          {['Name','Email','Role','Department','Hospital','Level','Status',''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {filtered.map(u => (
            <tr key={u.id} style={S.tr}>
              <td style={S.td}><strong style={{ color: '#f1f5f9' }}>{u.first_name} {u.last_name}</strong><br/><span style={{ fontSize:'11px', color:'#475569' }}>{u.staff_id}</span></td>
              <td style={S.td}>{u.email}</td>
              <td style={S.td}><span style={S.roleTag}>{u.role}</span></td>
              <td style={S.td}>{u.department || '—'}</td>
              <td style={S.td}>{u.branch_name || '—'} {u.hospital_code && <span style={S.code}>{u.hospital_code}</span>}</td>
              <td style={S.td}>{u.role_level}</td>
              <td style={S.td}>
                <button style={{ ...S.badge, background: u.is_active ? '#14532d' : '#450a0a', color: u.is_active ? '#4ade80' : '#f87171', border:'none', cursor:'pointer' }} onClick={() => toggle(u)}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </button>
              </td>
              <td style={S.td}>
                <button style={S.iconBtn} onClick={() => openEdit(u)}>✏️</button>
                <button style={S.iconBtn} onClick={() => { setEditing(u); setResetForm({ password:'' }); setErr(''); setModal('reset'); }}>🔑</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal === 'form' && (
        <Modal title={editing ? 'Edit User' : 'Add User'} onClose={() => setModal(null)}>
          {err && <div style={S.errMsg}>{err}</div>}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            <Field label="First Name *"><input style={S.input} value={form.firstName} onChange={e => setForm({...form, firstName: e.target.value})} /></Field>
            <Field label="Last Name"><input style={S.input} value={form.lastName} onChange={e => setForm({...form, lastName: e.target.value})} /></Field>
          </div>
          <Field label="Email *"><input style={S.input} type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} disabled={!!editing} /></Field>
          <Field label="Phone"><input style={S.input} value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></Field>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            <Field label="Role *">
              <select style={S.input} value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Role Level">
              <select style={S.input} value={form.role_level} onChange={e => setForm({...form, role_level: e.target.value})}>
                {ROLE_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Department"><input style={S.input} value={form.department} onChange={e => setForm({...form, department: e.target.value})} /></Field>
          <Field label="Hospital">
            <select style={S.input} value={form.branch_id} onChange={e => setForm({...form, branch_id: e.target.value})}>
              <option value="">No Hospital</option>
              {hospitals.map(h => <option key={h.id} value={h.id}>{h.branch_name} ({h.hospital_code})</option>)}
            </select>
          </Field>
          <Field label="Staff ID"><input style={S.input} value={form.staffId} onChange={e => setForm({...form, staffId: e.target.value})} /></Field>
          {!editing && <Field label="Password *"><input style={S.input} type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} onCopy={blockClipboard} onCut={blockClipboard} onPaste={blockClipboard} autoComplete="new-password" /></Field>}
          <button style={S.btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </Modal>
      )}

      {modal === 'reset' && (
        <Modal title={`Reset Password — ${editing?.first_name}`} onClose={() => setModal(null)}>
          {err && <div style={S.errMsg}>{err}</div>}
          <Field label="New Password (min 6 chars)">
            <input style={S.input} type="password" value={resetForm.password} onChange={e => setResetForm({ password: e.target.value })} onCopy={blockClipboard} onCut={blockClipboard} onPaste={blockClipboard} autoComplete="new-password" autoFocus />
          </Field>
          <button style={S.btnPrimary} onClick={doReset} disabled={saving || resetForm.password.length < 6}>{saving ? 'Resetting…' : 'Reset Password'}</button>
        </Modal>
      )}
    </div>
  );
}

// ── Brands Tab ────────────────────────────────────────────────────────────
function BrandsTab() {
  const [brands, setBrands]       = useState([]);
  const [selected, setSelected]   = useState(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    axios.get(`${API}/api/dev/brands`)
      .then(r => setBrands(r.data.brands || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const PROTOCOL_COLOR = {
    'HL7':      { bg: '#1a2e4a', color: '#38bdf8' },
    'TCP_HL7':  { bg: '#1a2e4a', color: '#38bdf8' },
    'TEXT':     { bg: '#1e3a2a', color: '#4ade80' },
    'Binary':   { bg: '#2d1a4a', color: '#a78bfa' },
  };

  if (loading) return <div style={S.loading}>Loading machine brands…</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '20px', height: '100%' }}>
      {/* Brand list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {brands.map(b => {
          const pc = PROTOCOL_COLOR[b.protocolType] || { bg: '#1e293b', color: '#94a3b8' };
          const isActive = selected?.name === b.name;
          return (
            <div
              key={b.name}
              onClick={() => setSelected(b)}
              style={{
                background: isActive ? 'rgba(56,189,248,0.1)' : '#1e293b',
                border: `1px solid ${isActive ? 'rgba(56,189,248,0.4)' : '#334155'}`,
                borderRadius: '10px', padding: '14px 16px', cursor: 'pointer',
                transition: 'all .15s',
              }}
            >
              <div style={{ fontWeight: '600', color: '#f1f5f9', fontSize: '14px', marginBottom: '6px', textTransform: 'capitalize' }}>
                {b.name}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ ...S.badge, background: pc.bg, color: pc.color }}>{b.protocolType}</span>
                <span style={{ fontSize: '12px', color: '#475569' }}>{b.paramCount} params</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Protocol detail */}
      {selected ? (
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px', overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ fontSize: '18px', fontWeight: '700', color: '#f1f5f9', textTransform: 'capitalize' }}>{selected.name}</div>
            <span style={{ ...S.badge, ...(PROTOCOL_COLOR[selected.protocolType] || { bg:'#1e293b', color:'#94a3b8' }) }}>
              {selected.protocolType}
            </span>
          </div>

          {/* Parameters table */}
          {(selected.protocol.frame_structure?.['2']?.tests || selected.protocol.tests) && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '10px' }}>Parameters</div>
              <table style={S.table}>
                <thead><tr style={S.thead}>
                  {['ID / Code', 'Name / Label', 'Unit', 'Ref Range'].map(h => <th key={h} style={S.th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {(selected.protocol.frame_structure?.['2']?.tests || selected.protocol.tests || []).map((t, i) => (
                    <tr key={i} style={S.tr}>
                      <td style={S.td}><span style={S.code}>{t.id ?? t.name}</span></td>
                      <td style={S.td}>{t.label || t.name}</td>
                      <td style={S.td}>{t.unit || '—'}</td>
                      <td style={S.td}>{t.ref_range || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Units table (binary protocol) */}
          {selected.protocol.frame_structure?.['3']?.units && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '10px' }}>Unit Codes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {selected.protocol.frame_structure['3'].units.map((u, i) => (
                  <span key={i} style={{ background: '#0f172a', color: '#94a3b8', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace' }}>
                    {u.id} → {u.unit}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Raw JSON */}
          <div>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '10px' }}>Raw Protocol JSON</div>
            <pre style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '14px', fontSize: '11px', color: '#94a3b8', overflow: 'auto', maxHeight: '300px' }}>
              {JSON.stringify(selected.protocol, null, 2)}
            </pre>
          </div>
        </div>
      ) : (
        <div style={{ background: '#1e293b', border: '1px dashed #334155', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: '14px' }}>
          Select a machine brand to view its protocol
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────
export default function DeveloperPanel() {
  const navigate                  = useNavigate();
  const [tab, setTab]             = useState('overview');
  const [stats, setStats]         = useState(null);
  const [hospitals, setHospitals] = useState([]);

  // VAPT #7 (Improper Session Time-Out): this panel had no idle logout at
  // all — the 8h dev cookie would otherwise stay usable on an unattended,
  // unlocked machine for the full session lifetime. Matches Layout.jsx's
  // 30-minute staff-side timeout.
  useIdleLogout(clearDeveloperSession, '/developer');

  useEffect(() => {
    // VAPT #9: the dev session is an httpOnly cookie, invisible to JS, so
    // there's nothing in localStorage to gate on up front — just make the
    // call and let a 401/403 redirect to login if there's no valid cookie.
    axios.get(`${API}/api/dev/stats`)
      .then(r => setStats(r.data.stats))
      .catch(err => {
        const status = err.response?.status;
        if (status === 401 || status === 403) {
          clearDeveloperSession();
          navigate('/developer');
        }
        // Any other error (500, network) — stay on the page, show empty stats
      });

    axios.get(`${API}/api/dev/hospitals`)
      .then(r => setHospitals(r.data.hospitals || []))
      .catch(() => {});
  }, [navigate]);

  // VAPT #4/#5 (Direct URL Access / Browser Refresh Attack): a page restored
  // from the browser's bfcache after logout (Back/Forward) would otherwise
  // keep showing this panel's last-rendered state without firing a fresh
  // mount/request — pageshow with persisted:true is the event that fires on
  // that restore, so re-check the (non-sensitive, synchronous) auth flag
  // every time, mirroring Layout.jsx's staff-side check.
  useEffect(() => {
    const onPageShow = (e) => {
      if (e.persisted && !hasDeveloperToken()) {
        navigate('/developer', { replace: true });
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [navigate]);

  const logout = () => {
    clearDeveloperSession();
    navigate('/developer');
  };

  const TABS = [
    { id: 'overview',   label: '📊 Overview' },
    { id: 'hospitals',  label: '🏥 Hospitals' },
    { id: 'labs',       label: '🧪 Labs' },
    { id: 'users',      label: '👥 Users' },
    { id: 'tests',      label: '🧫 Tests Master' },
    { id: 'brands',     label: '🔬 Machine Brands' },
  ];

  return (
    <div style={S.root}>
      {/* Sidebar */}
      <div style={S.sidebar}>
        <div style={S.sidebarTop}>
          <div style={S.brand}>
            <div style={S.brandIcon}>⚙</div>
            <div>
              <div style={{ fontSize:'14px', fontWeight:'700', color:'#f1f5f9' }}>Developer</div>
              <div style={{ fontSize:'11px', color:'#475569' }}>LIMS Admin</div>
            </div>
          </div>
          <nav style={{ marginTop:'8px' }}>
            {TABS.map(t => (
              <button key={t.id} style={{ ...S.navBtn, ...(tab === t.id ? S.navBtnActive : {}) }} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <button style={S.logoutBtn} onClick={logout}>↩ Sign Out</button>
      </div>

      {/* Main content */}
      <div style={S.main}>
        <div style={S.pageHeader}>
          <div>
            <div style={S.pageTitle}>{TABS.find(t => t.id === tab)?.label}</div>
            <div style={S.pageSubtitle}>lims.poxiatechnologies.com/developer</div>
          </div>
        </div>

        <div style={S.content}>
          {tab === 'overview'  && <OverviewTab stats={stats} />}
          {tab === 'hospitals' && <HospitalsTab />}
          {tab === 'labs'      && <LabsTab hospitals={hospitals} />}
          {tab === 'users'     && <UsersTab hospitals={hospitals} />}
          {tab === 'tests'     && <TestsTab />}
          {tab === 'brands'    && <BrandsTab />}
        </div>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const S = {
  root:        { display:'flex', minHeight:'100vh', background:'#0f172a', fontFamily:"'Inter','Segoe UI',sans-serif", color:'#e2e8f0' },
  sidebar:     { width:'220px', background:'#1e293b', borderRight:'1px solid #334155', display:'flex', flexDirection:'column', justifyContent:'space-between', padding:'20px 12px', flexShrink:0 },
  sidebarTop:  {},
  brand:       { display:'flex', alignItems:'center', gap:'10px', padding:'8px', marginBottom:'16px' },
  brandIcon:   { width:'36px', height:'36px', borderRadius:'8px', background:'rgba(56,189,248,0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px' },
  navBtn:      { display:'block', width:'100%', textAlign:'left', padding:'10px 12px', borderRadius:'8px', background:'none', border:'none', color:'#64748b', fontSize:'14px', cursor:'pointer', marginBottom:'2px', fontFamily:'inherit' },
  navBtnActive:{ background:'rgba(56,189,248,0.12)', color:'#38bdf8', fontWeight:'600' },
  logoutBtn:   { background:'none', border:'1px solid #334155', color:'#64748b', borderRadius:'8px', padding:'10px', fontSize:'13px', cursor:'pointer', width:'100%', fontFamily:'inherit' },
  main:        { flex:1, display:'flex', flexDirection:'column', overflow:'auto' },
  pageHeader:  { padding:'24px 28px 0', display:'flex', alignItems:'center', justifyContent:'space-between' },
  pageTitle:   { fontSize:'22px', fontWeight:'700', color:'#f1f5f9' },
  pageSubtitle:{ fontSize:'12px', color:'#334155', marginTop:'2px', fontFamily:'monospace' },
  content:     { padding:'20px 28px', flex:1 },
  loading:     { color:'#475569', padding:'40px', textAlign:'center' },

  statsGrid:   { display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px,1fr))', gap:'16px', marginBottom:'24px' },
  statCard:    { background:'#1e293b', border:'1px solid #1e293b', borderRadius:'12px', padding:'20px 16px', textAlign:'center' },
  infoBox:     { background:'rgba(56,189,248,0.06)', border:'1px solid rgba(56,189,248,0.15)', borderRadius:'8px', padding:'14px 16px', fontSize:'13px', color:'#94a3b8' },

  toolbar:     { display:'flex', gap:'10px', marginBottom:'16px', flexWrap:'wrap', alignItems:'center' },
  search:      { flex:1, minWidth:'180px', background:'#1e293b', border:'1px solid #334155', borderRadius:'8px', color:'#e2e8f0', padding:'9px 12px', fontSize:'13px', outline:'none', fontFamily:'inherit' },
  btnPrimary:  { background:'linear-gradient(135deg,#0ea5e9,#2563eb)', color:'#fff', border:'none', borderRadius:'8px', padding:'9px 18px', fontSize:'13px', fontWeight:'600', cursor:'pointer', whiteSpace:'nowrap' },
  btnSecondary:{ background:'#1e293b', color:'#94a3b8', border:'1px solid #334155', borderRadius:'8px', padding:'9px 18px', fontSize:'13px', cursor:'pointer', whiteSpace:'nowrap' },

  table:       { width:'100%', borderCollapse:'collapse', background:'#1e293b', borderRadius:'10px', overflow:'hidden', fontSize:'13px' },
  thead:       { background:'#0f172a' },
  th:          { padding:'11px 14px', textAlign:'left', color:'#475569', fontWeight:'600', fontSize:'12px', textTransform:'uppercase', letterSpacing:'.05em' },
  tr:          { borderBottom:'1px solid #1e293b' },
  td:          { padding:'12px 14px', color:'#94a3b8', verticalAlign:'middle' },

  badge:       { display:'inline-block', padding:'3px 9px', borderRadius:'20px', fontSize:'11px', fontWeight:'600' },
  code:        { background:'#0f172a', color:'#38bdf8', padding:'2px 7px', borderRadius:'4px', fontSize:'11px', fontFamily:'monospace' },
  roleTag:     { background:'rgba(167,139,250,0.1)', color:'#a78bfa', padding:'3px 9px', borderRadius:'20px', fontSize:'11px', fontWeight:'600' },
  iconBtn:     { background:'none', border:'none', cursor:'pointer', fontSize:'15px', padding:'2px 4px', opacity:0.7 },

  overlay:     { position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 },
  modal:       { background:'#1e293b', border:'1px solid #334155', borderRadius:'12px', width:'100%', maxWidth:'480px', maxHeight:'90vh', overflow:'auto' },
  modalHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'18px 20px', borderBottom:'1px solid #334155' },
  modalTitle:  { fontSize:'16px', fontWeight:'600', color:'#f1f5f9' },
  modalClose:  { background:'none', border:'none', color:'#475569', fontSize:'18px', cursor:'pointer' },
  modalBody:   { padding:'20px' },

  fieldLabel:  { display:'block', fontSize:'12px', color:'#64748b', fontWeight:'500', marginBottom:'6px' },
  input:       { width:'100%', background:'#0f172a', border:'1px solid #334155', borderRadius:'7px', color:'#f1f5f9', padding:'9px 12px', fontSize:'14px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' },
  errMsg:      { background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', color:'#fca5a5', borderRadius:'7px', padding:'9px 12px', fontSize:'13px', marginBottom:'14px' },
};
