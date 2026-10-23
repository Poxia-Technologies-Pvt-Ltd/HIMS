import { useState, useEffect, useCallback } from 'react';
import Select from 'react-select';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/StaffManagement.css';

const facilitySelectStyles = {
  control: (base) => ({
    ...base,
    background: 'var(--bg-input)',
    borderColor: 'var(--border-light)',
    borderRadius: 'var(--radius-sm)',
    padding: '2px',
    fontSize: '14px',
    boxShadow: 'none',
    '&:hover': { borderColor: 'var(--blue-primary)' }
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 })
};

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const hdr = () => ({ Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json' });
// VAPT #23 (Clipboard Data Stealing Attack): matches Login.jsx/ChangePassword.jsx.
const blockClipboard = (e) => e.preventDefault();

const ROLES = ['Doctor', 'Receptionist', 'HR', 'Admin', 'Lab Head', 'Lab Doctor', 'Lab Technician', 'Sample Collector', 'Auditor', 'Programme Officer'];
const ROLE_LEVELS = ['Branch', 'Sub-Central', 'Central'];

const emptyForm = (user) => ({
  firstName: '', lastName: '',
  email: '', phone: '',
  role: 'Doctor', role_level: 'Branch',
  department: '',
  staffId: 'STF-' + Math.floor(1000 + Math.random() * 9000),
  password: 'password123',
  branch_id: user.branch_id || '',
});

function StaffManagement() {
  const { alert, showAlert, hideAlert } = useAlert();
  const user       = JSON.parse(localStorage.getItem('user') || '{}');
  const isCentral  = user.role_level === 'Central';
  const isBranch   = !isCentral;
  // Lab Head can only manage Lab Technician staff
  const isLabHead  = (user.role || '').toLowerCase() === 'lab head';
  const assignableRoles = isLabHead ? ['Lab Technician', 'Sample Collector'] : ROLES;

  const [showPassword, setShowPassword] = useState(false);
  const [stats, setStats]           = useState({});
  const [staff, setStaff]           = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branches, setBranches]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [filterBranch, setFilterBranch] = useState('');

  const [showAddModal, setShowAddModal]   = useState(false);
  const [editingStaff, setEditingStaff]   = useState(null);
  const [formData, setFormData]           = useState(() => emptyForm(user));

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const branchParam = isBranch ? `?branch_id=${user.branch_id}` : (filterBranch ? `?branch_id=${filterBranch}` : '');
      const [statsRes, staffRes, deptRes] = await Promise.all([
        fetch(`${API_BASE}/api/staff/stats`, { headers: hdr() }),
        fetch(`${API_BASE}/api/staff/list${branchParam}`, { headers: hdr() }),
        fetch(`${API_BASE}/api/departments?is_active=true`, { headers: hdr() }),
      ]);
      const [statsD, staffD, deptD] = await Promise.all([statsRes.json(), staffRes.json(), deptRes.json()]);
      if (statsD.success) setStats(statsD.stats || {});
      if (staffD.success) setStaff(staffD.staff || []);
      if (deptD.success) {
        const names = deptD.departments.map(d => d.name);
        setDepartments(names);
        setFormData(prev => ({ ...prev, department: prev.department || names[0] || '' }));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filterBranch, isBranch, user.branch_id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (isCentral) {
      fetch(`${API_BASE}/api/branches`, { headers: hdr() })
        .then(r => r.json())
        .then(d => { if (d.success) setBranches(d.branches || []); })
        .catch(() => {});
    }
  }, [isCentral]);

  const openAdd = () => {
    setEditingStaff(null);
    setFormData({ ...emptyForm(user), role: isLabHead ? 'Lab Technician' : 'Doctor' });
    setShowAddModal(true);
  };

  const openEdit = (s) => {
    setEditingStaff(s);
    setFormData({
      firstName: s.first_name, lastName: s.last_name,
      email: s.email, phone: s.phone || '',
      role: s.role, role_level: s.role_level || 'Branch',
      department: s.department || '',
      staffId: s.staff_id || '',
      password: '',
      branch_id: s.branch_id || user.branch_id || '',
    });
    setShowAddModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isCentral && !formData.branch_id) {
      showAlert('Please select a facility', 'error');
      return;
    }
    const url    = editingStaff ? `${API_BASE}/api/staff/${editingStaff.id}` : `${API_BASE}/api/staff/add`;
    const method = editingStaff ? 'PUT' : 'POST';
    try {
      const res  = await fetch(url, { method, headers: hdr(), body: JSON.stringify(formData) });
      const data = await res.json();
      if (data.success) {
        showAlert(editingStaff ? 'Staff updated' : 'Staff member added successfully!', 'success');
        setShowAddModal(false);
        fetchAll();
      } else {
        showAlert(data.message || 'Error', 'error');
      }
    } catch { showAlert('Network error', 'error'); }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    try {
      const res  = await fetch(`${API_BASE}/api/staff/${id}`, { method: 'DELETE', headers: hdr() });
      const data = await res.json();
      if (data.success) { showAlert('Deleted', 'success'); fetchAll(); }
      else showAlert(data.message || 'Error', 'error');
    } catch { showAlert('Network error', 'error'); }
  };

  const set = (field, value) => setFormData(p => ({ ...p, [field]: value }));

  const filteredStaff = staff.filter(s => {
    if (isLabHead && !['Lab Technician', 'Sample Collector'].includes(s.role)) return false;
    const q = search.toLowerCase();
    return (
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q) ||
      (s.staff_id || '').toLowerCase().includes(q) ||
      (s.branch_name || '').toLowerCase().includes(q)
    );
  });

  const inp = { padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' };

  return (
    <>
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={4000} />}

      <div className="staff-page">
        <div className="staff-header">
          <div>
            <h1>Employee Management</h1>
            <p>
              {isBranch
                ? `Managing staff for ${user.branch_name || 'your facility'}`
                : 'Manage personnel across the health network'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {isCentral && (
              <select
                style={{ ...inp, width: 'auto' }}
                value={filterBranch}
                onChange={e => setFilterBranch(e.target.value)}
              >
                <option value="">All Facilities</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
              </select>
            )}
            <button className="btn-primary" onClick={openAdd}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Employee
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">Total Staff</span>
            <span className="stat-value">{staff.length}</span>
          </div>
          {ROLES.map(r => (
            <div className="stat-card" key={r}>
              <span className="stat-label">{r}s</span>
              <span className="stat-value">{stats[r] || 0}</span>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="staff-table-card">
          <div className="table-toolbar">
            <div className="search-input-wrapper">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="preg-input"
                placeholder="Search by name, email or ID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <table className="staff-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Full Name</th>
                <th>Role</th>
                <th>Department</th>
                <th>Facility</th>
                <th>Email</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: 40 }}>Loading staff records...</td></tr>
              ) : filteredStaff.length > 0 ? (
                filteredStaff.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600, color: 'var(--brand-blue)' }}>{s.staff_id}</td>
                    <td>{s.first_name} {s.last_name}</td>
                    <td>
                      <span className={`role-badge role-${s.role.toLowerCase().replace(' ', '-')}`}>{s.role}</span>
                    </td>
                    <td>{s.department || '—'}</td>
                    <td style={{ fontSize: 12, color: '#64748b' }}>{s.branch_name || '—'}</td>
                    <td>{s.email}</td>
                    <td>{new Date(s.created_at).toLocaleDateString('en-IN')}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => openEdit(s)}
                          style={{ padding: '3px 10px', border: '1px solid #e2e8f0', background: '#fff', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                        >Edit</button>
                        {s.id !== user.id && (
                          <button
                            onClick={() => handleDelete(s.id, `${s.first_name} ${s.last_name}`)}
                            style={{ padding: '3px 10px', border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                          >Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: 40 }}>No staff members found.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add / Edit Modal */}
        {showAddModal && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: 560 }}>
              <div className="modal-header">
                <div className="modal-header-info">
                  <h3>{editingStaff ? 'Edit Staff Member' : 'Create New Employee'}</h3>
                  <p>{editingStaff ? `Editing ${editingStaff.first_name} ${editingStaff.last_name}` : 'Register a new employee in the system'}</p>
                </div>
                <button className="close-btn" onClick={() => setShowAddModal(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="modal-body">

                  {/* Facility assignment — always visible */}
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 9, padding: '12px 14px', marginBottom: 16 }}>
                    {isCentral ? (
                      <div className="preg-field">
                        <label className="preg-label">Assign to Facility</label>
                        <Select
                          options={branches.map(b => ({ value: b.id, label: `${b.branch_name} (${b.hospital_code})` }))}
                          value={
                            formData.branch_id
                              ? {
                                  value: formData.branch_id,
                                  label: (() => {
                                    const b = branches.find(b => b.id === formData.branch_id);
                                    return b ? `${b.branch_name} (${b.hospital_code})` : '';
                                  })()
                                }
                              : null
                          }
                          onChange={selected => set('branch_id', selected ? selected.value : '')}
                          placeholder="Select facility…"
                          isClearable
                          styles={facilitySelectStyles}
                          menuPortalTarget={document.body}
                        />
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>
                        Facility: {user.branch_name || `Branch #${user.branch_id}`}
                        <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 400 }}>Staff will be assigned to your facility automatically</div>
                      </div>
                    )}
                  </div>

                  <div className="form-row">
                    <div className="preg-field">
                      <label className="preg-label">First Name *</label>
                      <input className="preg-input" value={formData.firstName} onChange={e => set('firstName', e.target.value)} placeholder="John" required />
                    </div>
                    <div className="preg-field">
                      <label className="preg-label">Last Name *</label>
                      <input className="preg-input" value={formData.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Doe" required />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="preg-field">
                      <label className="preg-label">Official Email *</label>
                      <input type="email" className="preg-input" value={formData.email} onChange={e => set('email', e.target.value)} placeholder="john@hospital.com" required disabled={!!editingStaff} />
                    </div>
                    <div className="preg-field">
                      <label className="preg-label">Phone</label>
                      <input type="tel" className="preg-input" value={formData.phone} onChange={e => set('phone', e.target.value)} placeholder="9876543210" />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="preg-field">
                      <label className="preg-label">Staff ID</label>
                      <input className="preg-input" value={formData.staffId} onChange={e => set('staffId', e.target.value)} />
                    </div>
                    <div className="preg-field">
                      <label className="preg-label">Department</label>
                      <select className="preg-select" value={formData.department} onChange={e => set('department', e.target.value)}>
                        <option value="">None</option>
                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="preg-field">
                      <label className="preg-label">Role / Designation *</label>
                      <select className="preg-select" value={formData.role} onChange={e => set('role', e.target.value)} disabled={isLabHead}>
                        {assignableRoles.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    {/* role_level only makes sense for Admin — and only Central admins can set it */}
                    {formData.role === 'Admin' && isCentral && (
                      <div className="preg-field">
                        <label className="preg-label">Admin Scope</label>
                        <select className="preg-select" value={formData.role_level} onChange={e => set('role_level', e.target.value)}>
                          {ROLE_LEVELS.map(l => <option key={l} value={l}>{l === 'Branch' ? 'Branch (single facility)' : l === 'Sub-Central' ? 'Sub-Central (district)' : 'Central (all facilities)'}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  {!editingStaff && (
                    <div className="preg-field">
                      <label className="preg-label">Initial Password *</label>
                      <div className="input-with-toggle">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          className="preg-input"
                          value={formData.password}
                          onChange={e => set('password', e.target.value)}
                          onCopy={blockClipboard}
                          onCut={blockClipboard}
                          onPaste={blockClipboard}
                          autoComplete="new-password"
                          required
                        />
                        <button
                          type="button"
                          className="toggle-eye"
                          onClick={() => setShowPassword(v => !v)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                              <line x1="1" y1="1" x2="23" y2="23" />
                            </svg>
                          ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn-ghost" onClick={() => setShowAddModal(false)}>Cancel</button>
                  <button type="submit" className="btn-primary">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" />
                      <line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
                    </svg>
                    {editingStaff ? 'Save Changes' : 'Register Employee'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default StaffManagement;
