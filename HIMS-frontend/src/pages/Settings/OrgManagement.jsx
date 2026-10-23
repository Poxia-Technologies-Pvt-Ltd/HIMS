import { useState, useEffect, useCallback } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';

const API   = import.meta.env.VITE_API_URL || '';
const tok   = () => localStorage.getItem('hims_token');
const hdr   = () => ({ Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json' });
const bId   = () => localStorage.getItem('branch_id');

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
  const [form, setForm]         = useState({ holiday_name:'', holiday_date:'', holiday_type:'National', is_recurring:false });

  const load = async () => {
    const r = await fetch(`${API}/api/org/holidays?branch_id=${bId()}${upcoming?'&upcoming=1':''}`, { headers: hdr() });
    const d = await r.json();
    if (d.success) setHolidays(d.holidays||[]);
  };
  useEffect(() => { load(); }, [upcoming]);

  const open = (h) => {
    setEditing(h||null);
    setForm(h ? { holiday_name:h.holiday_name, holiday_date:h.holiday_date?.split('T')[0]||'', holiday_type:h.holiday_type||'Hospital', is_recurring:!!h.is_recurring } : { holiday_name:'', holiday_date:'', holiday_type:'National', is_recurring:false });
    setModal(true);
  };

  const save = async () => {
    if (!form.holiday_name || !form.holiday_date) return showAlert('Name and date are required','warning');
    const payload = { holiday_name:form.holiday_name, holiday_date:form.holiday_date, holiday_type:form.holiday_type, is_recurring:form.is_recurring, branch_id: null };
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

  const typeColor = { National:'blue', State:'green', Local:'yellow', Hospital:'grey' };
  const rows = holidays;
  const holidayTable = (
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

      {holidayTable}

      {modal && <Modal title={editing?'Edit Holiday':'Add Holiday'} onClose={() => setModal(false)}>
        <Field label="Holiday Name" required><input style={inp} value={form.holiday_name} onChange={e=>setForm(p=>({...p,holiday_name:e.target.value}))} placeholder="e.g. Republic Day" /></Field>
        <Field label="Date" required><input type="date" style={inp} value={form.holiday_date} onChange={e=>setForm(p=>({...p,holiday_date:e.target.value}))} /></Field>
        <Field label="Type">
          <select style={sel} value={form.holiday_type} onChange={e=>setForm(p=>({...p,holiday_type:e.target.value}))}>
            {HOL_TYPES.map(t=><option key={t}>{t}</option>)}
          </select>
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
  { id:'specialties',   label:'Specialties' },
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
          <h1>Hospital Setup</h1>
          <p>Departments, specialties, working hours and holidays. Rooms and beds are managed in Room Management.</p>
        </div>

        <div className="org-tabs">
          {TABS.map(t => (
            <button key={t.id} className={`org-tab ${activeTab===t.id?'active':''}`} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'departments'   && <DepartmentsTab  showAlert={showAlert} />}
        {activeTab === 'specialties'   && <SpecialtiesTab   showAlert={showAlert} />}
        {activeTab === 'working-hours' && <WorkingHoursTab  showAlert={showAlert} />}
        {activeTab === 'holidays'      && <HolidaysTab      showAlert={showAlert} />}
      </div>
    </>
  );
}
