import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, FileText, Trash2, Upload, KeyRound, UserX, Download } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { PageHead, Tabs, Modal, Field, Badge, Stat, Empty } from '../../components/hmis/ui';
import { get, post, put, patch, del, api, openFile, isCentral, hasRole, fmtDate, fullName, todayIST } from '../../utils/hmisApi';

const CATEGORIES = ['Doctor', 'Nurse', 'Paramedical', 'Technician', 'Pharmacist', 'Administrative', 'Support', 'Other'];
const EMPLOYMENT_TYPES = ['Permanent', 'Contract', 'Probation', 'Consultant', 'Intern', 'Trainee'];
const STATUSES = ['Active', 'Suspended', 'Resigned', 'Terminated', 'Retired'];
const DOC_TYPES = ['Appointment Letter', 'Degree Certificate', 'Council Registration', 'ID Proof', 'Address Proof', 'Experience Letter', 'Medical Fitness', 'Other'];
const ADMIN_LOGIN_ROLES = ['Doctor', 'Nurse', 'Receptionist', 'Pharmacist', 'HR Manager', 'Medical Superintendent', 'Nursing Superintendent',
  'Admin', 'Accounts Manager', 'Lab Head', 'Lab Doctor', 'Lab Technician', 'Radiographer', 'Sample Collector', 'Auditor', 'Staff'];
const HR_LOGIN_ROLES = ['Doctor', 'Nurse', 'Receptionist', 'Pharmacist', 'Lab Technician', 'Radiographer', 'Sample Collector', 'Staff'];
const DEFAULT_LOGIN_ROLE = { Doctor: 'Doctor', Nurse: 'Nurse', Pharmacist: 'Pharmacist', Technician: 'Lab Technician', Administrative: 'Receptionist' };

const EMPTY = {
  first_name: '', last_name: '', gender: '', dob: '', blood_group: '', phone: '', email: '', address: '',
  designation: '', department_id: '', staff_category: 'Other', employment_type: 'Contract', date_of_joining: todayIST(),
  reporting_to: '', default_shift_id: '', weekly_off: '', qualification: '', registration_council: '', registration_no: '',
  registration_valid_till: '', experience_years: '', emergency_contact_name: '', emergency_contact_phone: '',
  pan: '', aadhaar_last4: '', uan: '', esi_number: '', bank_name: '', bank_account_no: '', bank_ifsc: '', employee_code: '', branch_id: '',
};

const STATUS_TONE = { Active: 'green', Suspended: 'amber', Resigned: '', Terminated: 'red', Retired: '' };

function EmployeeForm({ initial, lookups, onClose, onSaved, showAlert }) {
  const editing = !!initial?.id;
  const [tab, setTab] = useState('personal');
  const [f, setF] = useState(() => ({ ...EMPTY, ...Object.fromEntries(Object.entries(initial || {}).map(([k, v]) => [k, v ?? ''])) }));
  const [login, setLogin] = useState({ enabled: false, role: '', email: '', password: '' });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const loginRoles = hasRole('hr manager') ? HR_LOGIN_ROLES : ADMIN_LOGIN_ROLES;

  const submit = async () => {
    if (!f.first_name.trim()) { setTab('personal'); return showAlert('First name is required', 'warning'); }
    if (isCentral() && !editing && !f.branch_id) { setTab('employment'); return showAlert('Select the facility', 'warning'); }
    const body = { ...f };
    Object.keys(body).forEach((k) => { if (body[k] === '') body[k] = null; });
    if (!editing && login.enabled) body.login = { ...login, enabled: true, email: login.email || f.email };
    if (editing) { delete body.employee_code; }
    setSaving(true);
    const r = editing ? await put(`/api/employees/${initial.id}`, body) : await post('/api/employees', body);
    setSaving(false);
    if (!r.ok) return showAlert(r.data.message || 'Could not save', 'error');
    showAlert(editing ? 'Employee updated' : `Employee ${r.data.employee_code} created`, 'success');
    onSaved();
  };

  return (
    <Modal wide title={editing ? `${fullName(initial)} · ${initial.employee_code}` : 'New employee'}
      subtitle={editing ? initial.designation || initial.staff_category : 'HR record; a login is optional'}
      onClose={onClose}
      footer={<>
        <button className="hm-btn" onClick={onClose}>Cancel</button>
        <button className="hm-btn primary" disabled={saving} onClick={submit}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create employee'}</button>
      </>}>
      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'personal', label: 'Personal' },
        { id: 'employment', label: 'Employment' },
        { id: 'statutory', label: 'Statutory & Bank' },
        !editing && { id: 'login', label: 'Login' },
        editing && { id: 'documents', label: 'Documents' },
      ]} />

      {tab === 'personal' && (
        <div className="hm-form">
          <Field label="First name *"><input className="hm-input" value={f.first_name} onChange={set('first_name')} /></Field>
          <Field label="Last name"><input className="hm-input" value={f.last_name} onChange={set('last_name')} /></Field>
          <Field label="Gender">
            <select className="hm-select" value={f.gender} onChange={set('gender')}>
              <option value="">—</option>{['Male', 'Female', 'Other'].map((g) => <option key={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Date of birth"><input type="date" className="hm-input" value={f.dob} onChange={set('dob')} max={todayIST()} /></Field>
          <Field label="Blood group">
            <select className="hm-select" value={f.blood_group} onChange={set('blood_group')}>
              <option value="">—</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => <option key={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Mobile"><input className="hm-input" value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
          <Field label="Email"><input className="hm-input" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Address" className="full"><textarea className="hm-textarea" value={f.address} onChange={set('address')} /></Field>
          <div className="hm-section-title">Emergency contact</div>
          <Field label="Name"><input className="hm-input" value={f.emergency_contact_name} onChange={set('emergency_contact_name')} /></Field>
          <Field label="Phone"><input className="hm-input" value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} /></Field>
        </div>
      )}

      {tab === 'employment' && (
        <div className="hm-form">
          {isCentral() && (
            <Field label="Facility *">
              <select className="hm-select" value={f.branch_id} onChange={set('branch_id')}>
                <option value="">Select…</option>
                {lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
              </select>
            </Field>
          )}
          {!editing && <Field label="Employee code" hint="Leave blank to number automatically"><input className="hm-input" value={f.employee_code} onChange={set('employee_code')} /></Field>}
          <Field label="Staff category">
            <select className="hm-select" value={f.staff_category} onChange={set('staff_category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <Field label="Designation"><input className="hm-input" value={f.designation} onChange={set('designation')} placeholder="e.g. Staff Nurse" /></Field>
          <Field label="Department">
            <select className="hm-select" value={f.department_id} onChange={set('department_id')}>
              <option value="">—</option>{lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Employment type">
            <select className="hm-select" value={f.employment_type} onChange={set('employment_type')}>{EMPLOYMENT_TYPES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <Field label="Date of joining"><input type="date" className="hm-input" value={f.date_of_joining} onChange={set('date_of_joining')} /></Field>
          <Field label="Reports to">
            <select className="hm-select" value={f.reporting_to} onChange={set('reporting_to')}>
              <option value="">—</option>
              {lookups.people.filter((p) => p.id !== initial?.id).map((p) => <option key={p.id} value={p.id}>{fullName(p)} · {p.designation || p.staff_category}</option>)}
            </select>
          </Field>
          <Field label="Default shift" hint="Used on days without a roster entry">
            <select className="hm-select" value={f.default_shift_id} onChange={set('default_shift_id')}>
              <option value="">General (09:00–17:00)</option>
              {lookups.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start_time}–{s.end_time})</option>)}
            </select>
          </Field>
          <Field label="Weekly off" hint="Blank = facility default. e.g. Sun or Sat,Sun">
            <input className="hm-input" value={f.weekly_off} onChange={set('weekly_off')} placeholder="Sun" />
          </Field>
          <div className="hm-section-title">Qualification & registration</div>
          <Field label="Qualification"><input className="hm-input" value={f.qualification} onChange={set('qualification')} placeholder="MBBS, MD" /></Field>
          <Field label="Experience (years)"><input type="number" min="0" className="hm-input" value={f.experience_years} onChange={set('experience_years')} /></Field>
          <Field label="Council"><input className="hm-input" value={f.registration_council} onChange={set('registration_council')} placeholder="State Medical / Nursing Council" /></Field>
          <Field label="Registration no."><input className="hm-input" value={f.registration_no} onChange={set('registration_no')} /></Field>
          <Field label="Registration valid till"><input type="date" className="hm-input" value={f.registration_valid_till} onChange={set('registration_valid_till')} /></Field>
        </div>
      )}

      {tab === 'statutory' && (
        <div className="hm-form">
          <Field label="PAN"><input className="hm-input" value={f.pan} onChange={set('pan')} maxLength={10} style={{ textTransform: 'uppercase' }} /></Field>
          <Field label="Aadhaar (last 4 digits)" hint="Only the last four digits are stored"><input className="hm-input" value={f.aadhaar_last4} onChange={set('aadhaar_last4')} maxLength={4} inputMode="numeric" /></Field>
          <Field label="UAN (PF)"><input className="hm-input" value={f.uan} onChange={set('uan')} maxLength={12} /></Field>
          <Field label="ESI number"><input className="hm-input" value={f.esi_number} onChange={set('esi_number')} maxLength={17} /></Field>
          <div className="hm-section-title">Salary account</div>
          <Field label="Bank"><input className="hm-input" value={f.bank_name} onChange={set('bank_name')} /></Field>
          <Field label="Account number"><input className="hm-input" value={f.bank_account_no} onChange={set('bank_account_no')} inputMode="numeric" /></Field>
          <Field label="IFSC"><input className="hm-input" value={f.bank_ifsc} onChange={set('bank_ifsc')} maxLength={11} style={{ textTransform: 'uppercase' }} /></Field>
        </div>
      )}

      {tab === 'login' && (
        <div className="hm-form">
          <label className="hm-check full">
            <input type="checkbox" checked={login.enabled}
              onChange={(e) => setLogin((l) => ({ ...l, enabled: e.target.checked, role: l.role || DEFAULT_LOGIN_ROLE[f.staff_category] || 'Staff' }))} />
            Give this employee a login (needed for self-service attendance and leave, and for doctors taking OP appointments)
          </label>
          {login.enabled && <>
            <Field label="Role">
              <select className="hm-select" value={login.role} onChange={(e) => setLogin((l) => ({ ...l, role: e.target.value }))}>
                {loginRoles.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Login email" hint="Defaults to the employee's email">
              <input className="hm-input" type="email" value={login.email} placeholder={f.email} onChange={(e) => setLogin((l) => ({ ...l, email: e.target.value }))} />
            </Field>
            <Field label="Initial password" hint="8+ characters with upper, lower, digit and symbol. They must change it at first sign-in.">
              <input className="hm-input" type="password" autoComplete="new-password" value={login.password}
                onChange={(e) => setLogin((l) => ({ ...l, password: e.target.value }))} onPaste={(e) => e.preventDefault()} />
            </Field>
          </>}
        </div>
      )}

      {tab === 'documents' && editing && <Documents employeeId={initial.id} showAlert={showAlert} />}
    </Modal>
  );
}

function Documents({ employeeId, showAlert }) {
  const [docs, setDocs] = useState([]);
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [expires, setExpires] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await get(`/api/employees/${employeeId}`);
    if (r.ok) setDocs(r.data.documents || []);
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!file) return showAlert('Choose a file', 'warning');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('doc_type', docType);
    if (expires) fd.append('expires_on', expires);
    setBusy(true);
    const r = await api('POST', `/api/employees/${employeeId}/documents`, fd);
    setBusy(false);
    if (!r.ok) return showAlert(r.data.message || 'Upload failed', 'error');
    setFile(null); setExpires('');
    load();
  };

  const remove = async (d) => {
    if (!window.confirm(`Delete ${d.original_name}?`)) return;
    const r = await del(`/api/employees/documents/${d.id}`);
    if (!r.ok) return showAlert(r.data.message || 'Could not delete', 'error');
    load();
  };

  return (
    <>
      <div className="hm-form">
        <Field label="Document type">
          <select className="hm-select" value={docType} onChange={(e) => setDocType(e.target.value)}>{DOC_TYPES.map((d) => <option key={d}>{d}</option>)}</select>
        </Field>
        <Field label="Expires on" hint="For registrations, licences, fitness certificates"><input type="date" className="hm-input" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
        <Field label="File (PDF or image, up to 10 MB)">
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
        <Field label=" "><button className="hm-btn primary" disabled={busy} onClick={upload}><Upload size={15} /> {busy ? 'Uploading…' : 'Upload'}</button></Field>
      </div>
      <div className="hm-table-wrap">
        <table className="hm-table">
          <thead><tr><th>Type</th><th>File</th><th>Expires</th><th>Uploaded</th><th /></tr></thead>
          <tbody>
            {docs.length === 0 && <tr><td colSpan={5}><Empty>No documents yet.</Empty></td></tr>}
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.doc_type}</td>
                <td>{d.original_name}<span className="sub">{Math.ceil(d.size_bytes / 1024)} KB</span></td>
                <td>{d.expires_on ? <span style={{ color: d.expires_on < todayIST() ? '#b91c1c' : undefined }}>{fmtDate(d.expires_on)}</span> : '—'}</td>
                <td>{fmtDate(String(d.uploaded_at).slice(0, 10))}</td>
                <td><div className="hm-actions">
                  <button className="hm-btn sm" onClick={() => openFile(`/api/employees/documents/${d.id}/download`, d.original_name).catch((e) => showAlert(e.message, 'error'))}><Download size={13} /></button>
                  <button className="hm-btn sm danger" onClick={() => remove(d)}><Trash2 size={13} /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StatusModal({ employee, onClose, onSaved, showAlert }) {
  const [status, setStatus] = useState(employee.status === 'Active' ? 'Resigned' : 'Active');
  const [date, setDate] = useState(todayIST());
  const leaving = ['Resigned', 'Terminated', 'Retired'].includes(status);
  const save = async () => {
    const r = await patch(`/api/employees/${employee.id}/status`, { status, date_of_leaving: leaving ? date : null });
    if (!r.ok) return showAlert(r.data.message || 'Could not update', 'error');
    showAlert('Status updated', 'success');
    onSaved();
  };
  return (
    <Modal title={`Change status · ${fullName(employee)}`} onClose={onClose}
      footer={<><button className="hm-btn" onClick={onClose}>Cancel</button><button className="hm-btn primary" onClick={save}>Update</button></>}>
      <div className="hm-form">
        <Field label="New status">
          <select className="hm-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.filter((s) => s !== employee.status).map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        {leaving && <Field label="Last working day"><input type="date" className="hm-input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
      </div>
      {status !== 'Active' && (
        <div className="hm-note warn">Their login is disabled at once (open sessions included) and their future roster duties are released.</div>
      )}
    </Modal>
  );
}

function LoginModal({ employee, onClose, onSaved, showAlert }) {
  const roles = hasRole('hr manager') ? HR_LOGIN_ROLES : ADMIN_LOGIN_ROLES;
  const [l, setL] = useState({ role: DEFAULT_LOGIN_ROLE[employee.staff_category] || 'Staff', email: employee.email || '', password: '' });
  const save = async () => {
    const r = await post(`/api/employees/${employee.id}/login`, l);
    if (!r.ok) return showAlert(r.data.message || 'Could not create login', 'error');
    showAlert('Login created. They will be asked to change the password at first sign-in.', 'success');
    onSaved();
  };
  return (
    <Modal title={`Create login · ${fullName(employee)}`} onClose={onClose}
      footer={<><button className="hm-btn" onClick={onClose}>Cancel</button><button className="hm-btn primary" onClick={save}>Create login</button></>}>
      <div className="hm-form">
        <Field label="Role"><select className="hm-select" value={l.role} onChange={(e) => setL({ ...l, role: e.target.value })}>{roles.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Login email"><input className="hm-input" type="email" value={l.email} onChange={(e) => setL({ ...l, email: e.target.value })} /></Field>
        <Field label="Initial password" className="full" hint="8+ characters with upper, lower, digit and symbol">
          <input className="hm-input" type="password" autoComplete="new-password" value={l.password} onChange={(e) => setL({ ...l, password: e.target.value })} onPaste={(e) => e.preventDefault()} />
        </Field>
      </div>
    </Modal>
  );
}

export default function EmployeeManagement() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('Active');
  const [category, setCategory] = useState('');
  const [dept, setDept] = useState('');
  const [branch, setBranch] = useState('');
  const [lookups, setLookups] = useState({ departments: [], shifts: [], people: [], branches: [] });
  const [editing, setEditing] = useState(null);
  const [statusFor, setStatusFor] = useState(null);
  const [loginFor, setLoginFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status });
    if (category) params.set('category', category);
    if (dept) params.set('department_id', dept);
    if (branch) params.set('branch_id', branch);
    const [list, st, people] = await Promise.all([
      get(`/api/employees?${params}`),
      get(`/api/employees/stats${branch ? `?branch_id=${branch}` : ''}`),
      get(`/api/employees/lookup${branch ? `?branch_id=${branch}` : ''}`),
    ]);
    setLoading(false);
    if (!list.ok) return showAlert(list.data.message || 'Could not load employees', 'error');
    setRows(list.data.employees || []);
    if (st.ok) setStats(st.data.stats);
    if (people.ok) setLookups((l) => ({ ...l, people: people.data.employees || [] }));
  }, [status, category, dept, branch, showAlert]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      const [d, s, b] = await Promise.all([
        get('/api/departments?is_active=true'), get('/api/roster/shifts'), isCentral() ? get('/api/branches') : Promise.resolve({ ok: false }),
      ]);
      setLookups((l) => ({ ...l, departments: d.data.departments || [], shifts: s.data.shifts || [], branches: b.ok ? b.data.branches || [] : [] }));
    })();
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [fullName(r), r.employee_code, r.phone, r.email, r.designation].some((v) => (v || '').toLowerCase().includes(s)));
  }, [rows, q]);

  const openEdit = async (row) => {
    const r = await get(`/api/employees/${row.id}`);
    if (!r.ok) return showAlert(r.data.message || 'Could not open', 'error');
    setEditing(r.data.employee);
  };

  const saved = () => { setEditing(null); setStatusFor(null); setLoginFor(null); load(); };
  const cat = stats?.by_category || {};

  return (
    <div className="hm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={4000} />}
      <PageHead title="Employee Management" subtitle="Staff records, statutory details, documents and logins">
        <button className="hm-btn primary" onClick={() => setEditing({})}><Plus size={16} /> Add employee</button>
      </PageHead>

      <div className="hm-stats">
        <Stat label="Active staff" value={stats?.active ?? '—'} note={stats ? `${stats.joined_this_month} joined this month` : ''} />
        <Stat label="Doctors" value={cat.Doctor || 0} />
        <Stat label="Nurses" value={cat.Nurse || 0} />
        <Stat label="Paramedical & technicians" value={(cat.Paramedical || 0) + (cat.Technician || 0) + (cat.Pharmacist || 0)} />
        <Stat label="Admin & support" value={(cat.Administrative || 0) + (cat.Support || 0) + (cat.Other || 0)} />
        <Stat label="Registrations expiring" value={stats?.expiring_registrations?.length ?? 0} note="within 60 days" tone={stats?.expiring_registrations?.length ? 'warn' : ''} />
      </div>

      {(stats?.expiring_registrations?.length > 0 || stats?.expiring_documents?.length > 0) && (
        <div className="hm-note warn">
          <strong>Renewals due: </strong>
          {[...stats.expiring_registrations.map((e) => `${fullName(e)} — ${e.registration_council || 'registration'} ${fmtDate(e.registration_valid_till)}`),
            ...stats.expiring_documents.map((d) => `${fullName(d)} — ${d.doc_type} ${fmtDate(d.expires_on)}`)].join(' · ')}
        </div>
      )}

      <div className="hm-card">
        <div className="hm-card-head">
          <div className="hm-toolbar" style={{ flex: 1 }}>
            <div className="grow" style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-soft)' }} />
              <input className="hm-input" style={{ paddingLeft: 32 }} placeholder="Search name, code, phone, designation…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {isCentral() && (
              <select className="hm-select" value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">All facilities</option>{lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
              </select>
            )}
            <select className="hm-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select className="hm-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="hm-select" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>{lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div className="hm-table-wrap">
          <table className="hm-table">
            <thead>
              <tr><th>Code</th><th>Name</th><th>Category</th><th>Department</th><th>Type</th><th>Joined</th><th>Mobile</th><th>Login</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10}><Empty>Loading…</Empty></td></tr>}
              {!loading && shown.length === 0 && <tr><td colSpan={10}><Empty>No employees match these filters.</Empty></td></tr>}
              {!loading && shown.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => openEdit(r)}>
                  <td className="hm-mono" style={{ fontWeight: 600, color: 'var(--blue-primary)' }}>{r.employee_code}</td>
                  <td><strong>{fullName(r)}</strong><span className="sub">{r.designation || '—'}{isCentral() && r.branch_name ? ` · ${r.branch_name}` : ''}</span></td>
                  <td>{r.staff_category}</td>
                  <td>{r.department_name || '—'}</td>
                  <td>{r.employment_type}</td>
                  <td>{fmtDate(r.date_of_joining)}</td>
                  <td>{r.phone || '—'}</td>
                  <td>{r.user_id ? <Badge tone={r.login_active ? 'blue' : ''}>{r.login_role}</Badge> : <span className="hm-muted">—</span>}</td>
                  <td><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="hm-actions">
                      {!r.user_id && r.status === 'Active' && <button className="hm-btn sm" title="Create login" onClick={() => setLoginFor(r)}><KeyRound size={13} /></button>}
                      <button className="hm-btn sm" title="Change status" onClick={() => setStatusFor(r)}><UserX size={13} /></button>
                      <button className="hm-btn sm" title="Documents & details" onClick={() => openEdit(r)}><FileText size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && <EmployeeForm initial={editing.id ? editing : null} lookups={lookups} onClose={() => setEditing(null)} onSaved={saved} showAlert={showAlert} />}
      {statusFor && <StatusModal employee={statusFor} onClose={() => setStatusFor(null)} onSaved={saved} showAlert={showAlert} />}
      {loginFor && <LoginModal employee={loginFor} onClose={() => setLoginFor(null)} onSaved={saved} showAlert={showAlert} />}
    </div>
  );
}
