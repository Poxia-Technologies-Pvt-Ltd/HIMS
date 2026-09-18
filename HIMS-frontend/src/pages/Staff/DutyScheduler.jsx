import React, { useState, useEffect } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { ScheduleDutyModal } from './ScheduleDutyModal';   // ← new modal
import '../../assets/CSS/DutyScheduler.css';
import '../../assets/CSS/ScheduleDutyModal.css';                          // ← new styles

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');

const DutyScheduler = () => {
  const { alert, showAlert, hideAlert } = useAlert();
  const [personnel, setPersonnel] = useState([]);
  const [labs, setLabs] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [filters, setFilters] = useState({
    date: '', roomId: '', doctorId: '', status: '', block: '',
  });

  /* ── Data fetching ── */
  const fetchData = async () => {
    try {
      setLoading(true);
      const userBranchId = localStorage.getItem('branch_id');
      const userRoleLevel = localStorage.getItem('role_level');

      const staffUrl = userRoleLevel === 'Central' ? '/api/staff/list' : `/api/staff/list?branch_id=${userBranchId}`;

      const [staffRes, infraRes, dutyRes] = await Promise.all([
        fetch(`${API_BASE}${staffUrl}`, { headers: { Authorization: `Bearer ${tok()}` } }),
        fetch(`${API_BASE}/api/infra?type=Room`, { headers: { Authorization: `Bearer ${tok()}` } }),
        fetch(`${API_BASE}/api/duty`, { headers: { Authorization: `Bearer ${tok()}` } }),
      ]);
      const staffData = await staffRes.json();
      const infraData = await infraRes.json();
      const dutyData = await dutyRes.json();

      setPersonnel(staffData.staff.filter(s => {
        const matchRole = s.role?.toLowerCase().includes('lab') ||
          s.role?.toLowerCase().includes('technician') ||
          s.department?.toLowerCase().includes('lab') ||
          s.role === 'Doctor';

        // If not central, only show staff from the same branch
        const matchBranch = userRoleLevel === 'Central' || !userBranchId || s.branch_id?.toString() === userBranchId.toString();

        return matchRole && matchBranch;
      }));
      setLabs(infraData.items.filter(i => ['Laboratory', 'Room', 'Lab', 'Ward', 'Operation Theater', 'ICU'].includes(i.type) || i.name.toLowerCase().includes('lab') || i.name.toLowerCase().includes('room')));
      setSchedules(dutyData.schedules);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  /* ── Submit from modal ── */
  const handleModalSubmit = async (formData) => {
    try {
      const res = await fetch(`${API_BASE}/api/duty/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (data.success) {
        showAlert('Duty schedule added successfully!', 'success');
        setShowModal(false);
        fetchData();
      } else {
        showAlert('Error: ' + data.message, 'error');
      }
    } catch {
      showAlert('Failed to connect to server', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this schedule?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/duty/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok()}` } });
      const data = await res.json();
      if (data.success) fetchData();
    } catch (err) { console.error(err); }
  };

  const resetFilters = () => {
    setFilters({ date: '', roomId: '', doctorId: '', status: '', block: '' });
    setSearch('');
    setShowHistory(false);
  };

  /* ── Filter logic ── */
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const filteredSchedules = schedules.filter(s => {
    const personName = `${s.doctor_first_name} ${s.doctor_last_name}`.toLowerCase();
    const matchSearch = !search.trim() ||
      personName.includes(search.toLowerCase()) ||
      s.room_name.toLowerCase().includes(search.toLowerCase()) ||
      s.staff_id?.toLowerCase().includes(search.toLowerCase());

    const matchPerson = !filters.doctorId || s.doctorId?.toString() === filters.doctorId;
    const matchLab = !filters.roomId || s.roomId?.toString() === filters.roomId;
    const matchStatus = !filters.status || s.status?.toLowerCase() === filters.status.toLowerCase();
    const matchDate = !filters.date || s.duty_date === filters.date;
    const matchBlock = !filters.block || s.block === filters.block;

    const schedDate = new Date(s.duty_date); schedDate.setHours(0, 0, 0, 0);
    const isUpcoming = schedDate >= today;
    const hasFilters = !!(search.trim() || filters.date || filters.doctorId || filters.roomId || filters.status || filters.block);
    const visibleByTime = showHistory || hasFilters || isUpcoming;

    return matchSearch && matchPerson && matchLab && matchStatus && matchDate && matchBlock && visibleByTime;
  });

  const blocks = [...new Set(labs.map(r => r.block).filter(Boolean))];

  const todayShifts = schedules.filter(s => { const d = new Date(s.duty_date); d.setHours(0, 0, 0, 0); return d.getTime() === today.getTime(); }).length;
  const upcomingShifts = schedules.filter(s => new Date(s.duty_date) > today).length;
  const uniquePersonnel = new Set(schedules.map(s => s.doctorId)).size;

  return (
    <>
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={4000} />}

      <div className="staff-page">

        {/* Header */}
        <div className="staff-header">
          <div>
            <h1>Staff & Doctor Duty Scheduler</h1>
            <p>Manage and assign weekly duties for Doctors and Staff</p>
          </div>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Schedule New Duty
          </button>
        </div>

        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">Today's Shifts</span>
            <span className="stat-value">{todayShifts}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Upcoming Duties</span>
            <span className="stat-value">{upcomingShifts}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Lab Staff Assigned</span>
            <span className="stat-value">{uniquePersonnel}</span>
          </div>
          <div className="stat-card history-toggle-card">
            <span className="stat-label">Historical View</span>
            <button className={`btn-toggle ${showHistory ? 'active' : ''}`} onClick={() => setShowHistory(h => !h)}>
              {showHistory ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Table card */}
        <div className="staff-table-card">
          <div className="table-toolbar filters-toolbar">
            <div className="search-input-wrapper">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input type="text" className="preg-input" placeholder="Search staff, room or ID…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            <div className="filter-row">
              <div className="filter-item">
                <label>Personnel</label>
                <select className="preg-input filter-input" value={filters.doctorId}
                  onChange={e => setFilters(f => ({ ...f, doctorId: e.target.value }))}>
                  <option value="">All Personnel</option>
                  {personnel.map(d => <option key={d.id} value={d.id}>{d.first_name} {d.last_name} ({d.role})</option>)}
                </select>
              </div>
              <div className="filter-item">
                <label>Block</label>
                <select className="preg-input filter-input" value={filters.block}
                  onChange={e => setFilters(f => ({ ...f, block: e.target.value }))}>
                  <option value="">All Blocks</option>
                  {blocks.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="filter-item">
                <label>Laboratory</label>
                <select className="preg-input filter-input" value={filters.roomId}
                  onChange={e => setFilters(f => ({ ...f, roomId: e.target.value }))}>
                  <option value="">All Labs</option>
                  {labs.filter(r => !filters.block || r.block === filters.block)
                    .map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="filter-item">
                <label>Status</label>
                <select className="preg-input filter-input" value={filters.status}
                  onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                  <option value="">All Statuses</option>
                  {['Scheduled', 'Ongoing', 'Completed', 'Cancelled'].map(s =>
                    <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="filter-item">
                <label>Specific Date</label>
                <input type="date" className="preg-input filter-input" value={filters.date}
                  onChange={e => setFilters(f => ({ ...f, date: e.target.value }))} />
              </div>

              <button className="btn-ghost" onClick={resetFilters} style={{ fontSize: 12, marginTop: '18px' }}>
                Reset All
              </button>
            </div>
          </div>

          <table className="staff-table">
            <thead>
              <tr>
                <th>Personnel</th><th>Room / Facility</th><th>Date</th>
                <th>Time Slot</th><th>Status</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40 }}>Loading lab schedules…</td></tr>
              ) : filteredSchedules.length > 0 ? filteredSchedules.map(s => (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--brand-blue)' }}>{s.doctor_first_name} {s.doctor_last_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.staff_id}</div>
                  </td>
                  <td>
                    <span className="room-badge">{s.room_name}</span>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{s.block || 'Main Laboratory'}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{new Date(s.duty_date).toLocaleDateString()}</div>
                    {new Date(s.duty_date) < today && <span style={{ fontSize: 10, color: '#ef4444' }}>History</span>}
                  </td>
                  <td>{s.start_time.substring(0, 5)} – {s.end_time.substring(0, 5)}</td>
                  <td>
                    <span className={`status-badge status-${s.status?.toLowerCase() || 'scheduled'}`}>
                      {s.status || 'Scheduled'}
                    </span>
                  </td>
                  <td>
                    <button className="btn-icon-delete" onClick={() => handleDelete(s.id)} title="Delete">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40 }}>No duty schedules found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── New portal-based modal ── */}
      {showModal && (
        <ScheduleDutyModal
          doctors={personnel}
          rooms={labs}
          onClose={() => setShowModal(false)}
          onSubmit={handleModalSubmit}
        />
      )}
    </>
  );
};

export default DutyScheduler;