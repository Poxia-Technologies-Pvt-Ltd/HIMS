//appointmentBooking.jsx
import { useState, useEffect } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/PatientRegistration.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');

function AppointmentBooking({ regNo, onSaveSuccess }) {
  const { alert, showAlert, hideAlert } = useAlert();
  const [departments, setDepartments] = useState([]);
  const [doctorMap, setDoctorMap] = useState({});
  const [doctorsData, setDoctorsData] = useState([]); // Store full doctor objects with prices
  const [loading, setLoading] = useState(true);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  const getLocalDate = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
  };

  const [searchFilters, setSearchFilters] = useState({
    date: getLocalDate(),
    time: '10:00',
    department: ''
  });

  const [data, setData] = useState({
    department: '',
    doctor: '',
    apptDate: getLocalDate(),
    apptTime: '10:00',
    priority: 'Routine',
    reason: '',
    price: 0
  });

  // Time slot picker state
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [hasDuty, setHasDuty] = useState(null); // null=not fetched, true/false

  const fetchSlots = async (doctorId, date) => {
    if (!doctorId || !date) return;
    setSlotsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/duty/slots?doctor_id=${doctorId}&date=${date}`,
        { headers: { Authorization: `Bearer ${tok()}` } }
      );
      const d = await res.json();
      if (d.success) {
        setSlots(d.slots);
        setHasDuty(d.hasDuty);
        // Auto-select first future free slot
        const now = new Date();
        const curMin = now.getHours() * 60 + now.getMinutes();
        const isToday = date === getLocalDate();
        const future = d.slots.filter(s => {
          if (!isToday) return true;
          const [h, m] = s.time.split(':').map(Number);
          return h * 60 + m >= curMin;
        });
        const times = future.map(s => s.time);
        if (!times.includes(data.apptTime) && times.length > 0) {
          const firstFree = future.find(s => s.booked === 0) || future[0];
          setData(p => ({ ...p, apptTime: firstFree.time }));
        }
      }
    } catch { /* silent */ }
    setSlotsLoading(false);
  };

  // Lab test booking state
  const [services, setServices] = useState({ laboratory: [], appointments: [] });
  const [selectedLabTests, setSelectedLabTests] = useState([]);
  const [labLoading, setLabLoading] = useState(false);
  const [labSearchQuery, setLabSearchQuery] = useState('');
  // This deployment only ever does lab billing — no OPD/doctor consultation
  // flow — so bookingMode is fixed to 'lab' and the selector that used to
  // let someone switch it is hidden below rather than removed outright
  // (keeps 'doctor'/'both' working for anyone who re-enables the selector).
  const [bookingMode, setBookingMode] = useState('lab'); // 'doctor', 'lab', or 'both'

  // Fetch departments from backend
  const fetchDepartments = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/departments?is_active=true`, { headers: { Authorization: `Bearer ${tok()}` } });
      const data = await res.json();
      if (data.success) {
        setDepartments(data.departments.map(d => d.name));
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  // Fetch all departments from backend on mount
  useEffect(() => {
    fetchDepartments();
  }, []);

  useEffect(() => {
    if (data.apptDate && data.apptTime) {
      fetchAvailableDoctors(data.apptDate, data.apptTime);
    }
  }, [data.apptDate, data.apptTime]);

  useEffect(() => {
    if (data.doctor_id && data.apptDate) {
      fetchSlots(data.doctor_id, data.apptDate);
    } else {
      setSlots([]);
      setHasDuty(null);
    }
  }, [data.doctor_id, data.apptDate]);

  const fetchAvailableDoctors = async (date, time) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/duty/available?date=${date}&time=${time}`, { headers: { Authorization: `Bearer ${tok()}` } });
      const result = await res.json();

      if (result.success) {
        const map = {};
        const depts = new Set();

        result.doctors.forEach(doc => {
          const dept = doc.department;
          depts.add(dept);
          if (!map[dept]) map[dept] = [];
          map[dept].push(`Dr. ${doc.first_name} ${doc.last_name}`);
        });

        setDoctorMap(map);
        setDoctorsData(result.doctors); // Full objects including price
        setDepartments(Array.from(depts).sort());

        // Clear doctor if they are no longer in the list
        if (data.department) {
          const availableDoctors = map[data.department] || [];
          if (!availableDoctors.includes(data.doctor)) {
            setData(p => ({ ...p, doctor: '', price: 0 }));
          }
        }
      }
      setLoading(false);
    } catch (err) {
      console.error('Error fetching available doctors:', err);
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    try {
      setIsSearching(true);
      const { date, time, department } = searchFilters;
      let url = `${API_BASE}/api/duty/available?date=${date}&time=${time}`;
      if (department) url += `&department=${encodeURIComponent(department)}`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${tok()}` } });
      const result = await res.json();

      if (result.success) {
        setSearchResults(result.doctors);
      }
      setIsSearching(false);
    } catch (error) {
      console.error('Error searching doctors:', error);
      setIsSearching(false);
    }
  };

  // ── FIX: Look up price from doctorsData when doctor is selected from dropdown ──
  const ch = (e) => {
    const { name, value } = e.target;

    if (name === 'department') {
      // Changing department resets doctor and price
      setData(p => ({ ...p, department: value, doctor: '', price: 0 }));
      return;
    }

    if (name === 'doctor') {
      // Look up matching doctor in doctorsData to get their price and ID
      const matched = doctorsData.find(
        d =>
          `Dr. ${d.first_name} ${d.last_name}` === value &&
          d.department === data.department
      );
      setData(p => ({ ...p, doctor: value, doctor_id: matched?.id ?? null, price: matched?.price ?? 0 }));
      return;
    }

    setData(p => ({ ...p, [name]: value }));
  };

  const doctorList = doctorMap[data.department] || [];

  // ── FIX: handleSelectDoctor now reads price directly from the search result row ──
  const handleSelectDoctor = (doc) => {
    const fullName = `Dr. ${doc.first_name} ${doc.last_name}`;
    setData(p => ({
      ...p,
      department: doc.department,
      doctor: fullName,
      doctor_id: doc.id,
      apptDate: searchFilters.date,
      apptTime: searchFilters.time,
      price: doc.price ?? 0   // price comes directly from the API row
    }));
    setShowSearchModal(false);
  };

  const handleBook = () => {
    // Validate based on booking mode
    if (bookingMode === 'doctor' && !data.doctor) {
      showAlert('Please select a doctor to proceed', 'warning');
      return;
    }
    if (bookingMode === 'lab' && selectedLabTests.length === 0) {
      showAlert('Please select at least one lab test', 'warning');
      return;
    }
    if (bookingMode === 'both') {
      if (!data.doctor) {
        showAlert('Please select a doctor to proceed', 'warning');
        return;
      }
      if (selectedLabTests.length === 0) {
        showAlert('Please select at least one lab test', 'warning');
        return;
      }
    }

    // Collect booking data to pass to billing (not stored yet)
    const bookingData = {
      regNo,
      mode: bookingMode,
      appointment: (bookingMode === 'doctor' || bookingMode === 'both') && data.doctor ? {
        ...data
      } : null,
      labTests: (bookingMode === 'lab' || bookingMode === 'both') && selectedLabTests.length > 0
        ? selectedLabTests.map(t => ({
          id: t.id,
          name: t.name,
          price: t.price || 0,
          category: 'Laboratory'
        }))
        : []
    };

    const msg = bookingMode === 'both'
      ? 'Doctor appointment and lab tests ready for billing'
      : bookingMode === 'doctor'
        ? 'Doctor appointment ready for billing'
        : 'Lab tests ready for billing';
    showAlert(msg, 'success');

    // Pass collected data to parent for billing step
    onSaveSuccess(bookingData);
  };

  const priorityColor = { Routine: '#059669', Urgent: '#d97706', Emergency: '#dc2626' };

  // Fetch available services (same as Billings)
  const fetchServices = async () => {
    try {
      setLabLoading(true);
      const res = await fetch(`${API_BASE}/api/billing/services/available`, { headers: { Authorization: `Bearer ${tok()}` } });
      const result = await res.json();
      if (result.success) {
        setServices(result.data || { laboratory: [], appointments: [] });
      }
    } catch (err) {
      console.error('Error fetching services:', err);
    } finally {
      setLabLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, []);

  const toggleLabTest = (test) => {
    setSelectedLabTests(prev => {
      const exists = prev.find(t => t.id === test.id);
      if (exists) {
        return prev.filter(t => t.id !== test.id);
      }
      return [...prev, test];
    });
  };

  // Filter lab tests based on search query
  const filteredLabTests = services.laboratory.filter(test =>
    labSearchQuery === '' ||
    test.name.toLowerCase().includes(labSearchQuery.toLowerCase()) ||
    (test.code && test.code.toLowerCase().includes(labSearchQuery.toLowerCase()))
  );

  return (
    <>
      {alert && (
        <Alert
          message={alert.message}
          type={alert.type}
          onClose={hideAlert}
          duration={4000}
        />
      )}
      <main className="preg-body">
        {/* ── Booking Mode Selector — hidden: this deployment is lab-only,
             bookingMode is fixed to 'lab' above. Set to true to bring the
             OPD/Doctor-Consultation and Both options back. ── */}
        {false && (
        <div className="preg-card" style={{ marginBottom: '20px' }}>
          <div className="preg-card-header">
            <span className="preg-card-title">Booking Type</span>
          </div>
          <div className="preg-card-body">
            <div className="booking-mode-selector" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <label className={`mode-option ${bookingMode === 'doctor' ? 'active' : ''}`} style={{
                padding: '12px 20px',
                border: `2px solid ${bookingMode === 'doctor' ? '#2563eb' : '#e5e7eb'}`,
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: bookingMode === 'doctor' ? '#eff6ff' : '#fff'
              }}>
                <input
                  type="radio"
                  name="bookingMode"
                  value="doctor"
                  checked={bookingMode === 'doctor'}
                  onChange={(e) => setBookingMode(e.target.value)}
                  style={{ cursor: 'pointer' }}
                />
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
                Doctor Consultation
              </label>
              <label className={`mode-option ${bookingMode === 'lab' ? 'active' : ''}`} style={{
                padding: '12px 20px',
                border: `2px solid ${bookingMode === 'lab' ? '#2563eb' : '#e5e7eb'}`,
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: bookingMode === 'lab' ? '#eff6ff' : '#fff'
              }}>
                <input
                  type="radio"
                  name="bookingMode"
                  value="lab"
                  checked={bookingMode === 'lab'}
                  onChange={(e) => setBookingMode(e.target.value)}
                  style={{ cursor: 'pointer' }}
                />
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 3v18M15 3v18M3 9h18M3 15h18" /><circle cx="12" cy="12" r="3" />
                </svg>
                Lab Tests Only
              </label>
              <label className={`mode-option ${bookingMode === 'both' ? 'active' : ''}`} style={{
                padding: '12px 20px',
                border: `2px solid ${bookingMode === 'both' ? '#2563eb' : '#e5e7eb'}`,
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: bookingMode === 'both' ? '#eff6ff' : '#fff'
              }}>
                <input
                  type="radio"
                  name="bookingMode"
                  value="both"
                  checked={bookingMode === 'both'}
                  onChange={(e) => setBookingMode(e.target.value)}
                  style={{ cursor: 'pointer' }}
                />
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
                Doctor + Lab
              </label>
            </div>
          </div>
        </div>
        )}

        {/* ── Clinical Request ── */}
        {(bookingMode === 'doctor' || bookingMode === 'both') && (
          <div className="preg-card">
            <div className="preg-card-header">
              <span className="preg-card-title">Clinical Request</span>
            </div>
            <div className="preg-card-body">
              <div className="preg-grid preg-grid-3">

                <div className="preg-field">
                  <label className="preg-label">Department *</label>
                  <select
                    className="preg-select"
                    name="department"
                    value={data.department}
                    onChange={ch}
                    disabled={loading || departments.length === 0}
                  >
                    <option value="">{loading ? 'Checking availability...' : departments.length > 0 ? 'Select Department' : 'No doctors available'}</option>
                    {departments.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>

                <div className="preg-field">
                  <label className="preg-label">Assigned Doctor</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      className="preg-select"
                      name="doctor"
                      value={data.doctor}
                      onChange={ch}
                      disabled={!data.department || loading}
                      style={{ flex: 1 }}
                    >
                      <option value="">{data.department ? 'Select Doctor' : '— select dept first —'}</option>
                      {doctorList.map(d => <option key={d}>{d}</option>)}
                    </select>
                    <button
                      type="button"
                      className="preg-back-btn"
                      style={{ background: 'var(--sys-bg)', borderColor: 'var(--border-light)', color: 'var(--brand-blue)', height: '32px', width: 'auto' }}
                      onClick={() => {
                        setSearchFilters({ date: data.apptDate, time: data.apptTime, department: data.department });
                        setShowSearchModal(true);
                        handleSearch();
                      }}
                      title="Search Doctors with Advanced Filters"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                      </svg>
                      Search
                    </button>
                  </div>
                </div>

                <div className="preg-field">
                  <label className="preg-label">Priority</label>
                  <select
                    className="preg-select"
                    name="priority"
                    value={data.priority}
                    onChange={ch}
                    style={{ color: priorityColor[data.priority], fontWeight: 600 }}
                  >
                    <option value="Routine">Routine</option>
                    <option value="Urgent">Urgent</option>
                    <option value="Emergency">Emergency</option>
                  </select>
                </div>

                <div className="preg-field">
                  <label className="preg-label">Consultation Fee</label>
                  <div className="preg-input" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: data.price > 0 ? '#f0fdf4' : '#f3f4f6',
                    color: data.price > 0 ? '#166534' : '#6b7280',
                    fontWeight: 600,
                    borderColor: data.price > 0 ? '#86efac' : '#e5e7eb'
                  }}>
                    <span style={{ fontSize: '16px' }}>₹</span>
                    {data.price > 0 ? Number(data.price).toFixed(2) : 'Select doctor'}
                  </div>
                </div>

                <div className="preg-field">
                  <label className="preg-label">Appointment Date *</label>
                  <input className="preg-input" type="date" name="apptDate" value={data.apptDate} onChange={ch} min={getLocalDate()} />
                </div>

                <div className="preg-field preg-col-span-2" style={{ gridColumn: '1 / -1' }}>
                  <label className="preg-label">
                    Time Slot
                    {hasDuty === false && <span style={{ color: '#f59e0b', fontWeight: 400, marginLeft: 8, fontSize: 11 }}>⚠ No duty scheduled — showing default hours</span>}
                    {data.apptTime && <span style={{ color: '#2563eb', fontWeight: 600, marginLeft: 8, fontSize: 12 }}>Selected: {data.apptTime}</span>}
                  </label>
                  {!data.doctor_id ? (
                    <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 0' }}>Select a doctor above to see available slots</p>
                  ) : slotsLoading ? (
                    <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 0' }}>Loading slots…</p>
                  ) : slots.length === 0 ? (
                    <p style={{ fontSize: 12, color: '#ef4444', margin: '6px 0 0' }}>No slots available for this date</p>
                  ) : (() => {
                    const now = new Date();
                    const curMin = now.getHours() * 60 + now.getMinutes();
                    const isToday = data.apptDate === getLocalDate();
                    const visibleSlots = isToday
                      ? slots.filter(s => {
                          const [h, m] = s.time.split(':').map(Number);
                          return h * 60 + m >= curMin;
                        })
                      : slots;
                    if (visibleSlots.length === 0) return (
                      <p style={{ fontSize: 12, color: '#ef4444', margin: '6px 0 0' }}>All slots for today have passed</p>
                    );
                    return (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                      gap: '6px',
                      marginTop: '8px',
                      maxHeight: '180px',
                      overflowY: 'auto',
                      padding: '4px 2px'
                    }}>
                      {visibleSlots.map(slot => {
                        const isSelected = data.apptTime === slot.time;
                        const load = slot.booked === 0 ? 'free' : slot.booked <= 2 ? 'busy' : 'full';
                        const colors = {
                          free: { bg: '#f0fdf4', border: '#86efac', text: '#166534', badge: '#dcfce7', badgeText: '#15803d' },
                          busy: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', badge: '#fef3c7', badgeText: '#b45309' },
                          full: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', badge: '#fee2e2', badgeText: '#b91c1c' },
                        }[load];
                        return (
                          <button
                            key={slot.time}
                            type="button"
                            onClick={() => setData(p => ({ ...p, apptTime: slot.time }))}
                            style={{
                              padding: '6px 4px',
                              borderRadius: '8px',
                              border: `2px solid ${isSelected ? '#2563eb' : colors.border}`,
                              background: isSelected ? '#2563eb' : colors.bg,
                              color: isSelected ? '#fff' : colors.text,
                              cursor: 'pointer',
                              fontSize: '11px',
                              fontWeight: 600,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '3px',
                              transition: 'all 0.15s',
                              outline: isSelected ? '2px solid #93c5fd' : 'none',
                              outlineOffset: '1px',
                            }}
                          >
                            <span style={{ fontSize: '12px', letterSpacing: '0.5px' }}>{slot.time}</span>
                            <span style={{
                              fontSize: '9px',
                              padding: '1px 5px',
                              borderRadius: '10px',
                              background: isSelected ? 'rgba(255,255,255,0.25)' : colors.badge,
                              color: isSelected ? '#fff' : colors.badgeText,
                              fontWeight: 500,
                            }}>
                              {slot.booked === 0 ? 'Free' : `${slot.booked} booked`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    );
                  })()}
                </div>

                <div className="preg-field preg-col-span-3">
                  {departments.length === 0 && !loading && (
                    <div style={{ color: '#dc2626', fontSize: '12px', marginBottom: '8px', fontWeight: 'bold' }}>
                      ⚠️ No doctors are scheduled for duty on this date and time. Please select another slot.
                    </div>
                  )}
                  <label className="preg-label">Chief Complaint / Reason for Visit</label>
                  <textarea className="preg-textarea" name="reason" value={data.reason} onChange={ch} placeholder="Briefly describe the patient's condition or reason for visit…" />
                </div>

              </div>
            </div>
          </div>
        )}

        {/* ── Lab Test Booking ── */}
        {(bookingMode === 'lab' || bookingMode === 'both') && (
          <div className="preg-card" style={{ marginTop: '20px' }}>
            <div className="preg-card-header">
              <span className="preg-card-title">Lab Test Booking</span>
              {selectedLabTests.length > 0 && (
                <span style={{
                  background: '#dbeafe',
                  color: '#1e40af',
                  padding: '4px 12px',
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: 600
                }}>
                  {selectedLabTests.length} selected
                </span>
              )}
            </div>
            <div className="preg-card-body">
              {/* Search Input */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Search lab tests by name or code..."
                    value={labSearchQuery}
                    onChange={(e) => setLabSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px 10px 40px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#9ca3af"
                    strokeWidth="2"
                    style={{
                      position: 'absolute',
                      left: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)'
                    }}
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  {labSearchQuery && (
                    <button
                      onClick={() => setLabSearchQuery('')}
                      style={{
                        position: 'absolute',
                        right: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#9ca3af',
                        fontSize: '16px',
                        padding: 0,
                        lineHeight: 1
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {filteredLabTests.length !== services.laboratory.length && (
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
                    Showing {filteredLabTests.length} of {services.laboratory.length} tests
                  </div>
                )}
              </div>

              {labLoading ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280' }}>
                  Loading lab tests...
                </div>
              ) : filteredLabTests.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280' }}>
                  {labSearchQuery ? 'No matching lab tests found' : 'No lab tests available'}
                </div>
              ) : (
                <div className="lab-tests-grid" style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '12px'
                }}>
                  {filteredLabTests.map(test => (
                    <div
                      key={test.id}
                      onClick={() => toggleLabTest(test)}
                      style={{
                        padding: '16px',
                        border: `2px solid ${selectedLabTests.find(t => t.id === test.id) ? '#2563eb' : '#e5e7eb'}`,
                        borderRadius: '8px',
                        cursor: 'pointer',
                        background: selectedLabTests.find(t => t.id === test.id) ? '#eff6ff' : '#fff',
                        transition: 'all 0.2s'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                        <div style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '4px',
                          border: `2px solid ${selectedLabTests.find(t => t.id === test.id) ? '#2563eb' : '#d1d5db'}`,
                          background: selectedLabTests.find(t => t.id === test.id) ? '#2563eb' : '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          marginTop: '2px'
                        }}>
                          {selectedLabTests.find(t => t.id === test.id) && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: '#1f2937', marginBottom: '4px' }}>
                            {test.name}
                          </div>
                          {test.code && (
                            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                              Code: {test.code}
                            </div>
                          )}
                          <div style={{ fontSize: '14px', color: '#2563eb', fontWeight: 600 }}>
                            ₹{test.price || 0}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Selected Tests Summary */}
              {selectedLabTests.length > 0 && (
                <div style={{
                  marginTop: '20px',
                  padding: '16px',
                  background: '#f3f4f6',
                  borderRadius: '8px'
                }}>
                  <div style={{ fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
                    Selected Tests:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {selectedLabTests.map(test => (
                      <span key={test.id} style={{
                        background: '#2563eb',
                        color: '#fff',
                        padding: '4px 12px',
                        borderRadius: '16px',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        {test.name}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLabTest(test);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#fff',
                            cursor: 'pointer',
                            padding: 0,
                            fontSize: '14px',
                            lineHeight: 1
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div style={{
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid #d1d5db',
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#1f2937',
                    textAlign: 'right'
                  }}>
                    Total: ₹{selectedLabTests.reduce((sum, t) => sum + (parseFloat(t.price || t.selling_price) || 0), 0).toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <div className="preg-action-bar">
        <span style={{ fontSize: 12, color: 'var(--text-soft)', marginRight: 'auto' }}>
          {bookingMode === 'doctor' && 'Please select a doctor to proceed'}
          {bookingMode === 'lab' && `${selectedLabTests.length} test(s) selected`}
          {bookingMode === 'both' && `Doctor: ${data.doctor ? '✓' : '✗'} | Lab: ${selectedLabTests.length} test(s)`}
        </span>
        <button className="btn-ghost" onClick={() => { }}>Back</button>
        <button className="btn-primary" onClick={handleBook}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {bookingMode === 'doctor' && 'Confirm Appointment'}
          {bookingMode === 'lab' && 'Book Lab Tests'}
          {bookingMode === 'both' && 'Confirm Both'}
        </button>
      </div>

      {/* ── Doctor Search Modal ── */}
      {showSearchModal && (
        <div className="camera-overlay">
          <div className="search-modal-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                </svg>
                Find Available Doctors
              </h3>
              <button
                className="btn-ghost"
                style={{ width: '40px', height: '40px', borderRadius: '50%', padding: 0 }}
                onClick={() => setShowSearchModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="search-form-grid">
              <div className="preg-field">
                <label className="preg-label">Date</label>
                <input
                  type="date"
                  className="preg-input"
                  value={searchFilters.date}
                  onChange={(e) => setSearchFilters(p => ({ ...p, date: e.target.value }))}
                />
              </div>
              <div className="preg-field">
                <label className="preg-label">Time</label>
                <input
                  type="time"
                  className="preg-input"
                  value={searchFilters.time}
                  onChange={(e) => setSearchFilters(p => ({ ...p, time: e.target.value }))}
                />
              </div>
              <div className="preg-field">
                <label className="preg-label">Department</label>
                <select
                  className="preg-select"
                  value={searchFilters.department}
                  onChange={(e) => setSearchFilters(p => ({ ...p, department: e.target.value }))}
                >
                  <option value="">All Departments</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <button className="btn-primary" style={{ height: '32px', width: '100px' }} onClick={handleSearch}>
                {isSearching ? '...' : 'Search'}
              </button>
            </div>

            <div className="search-results-container" style={{ minHeight: '200px' }}>
              {searchResults.length > 0 ? (
                <table className="search-results-table">
                  <thead>
                    <tr>
                      <th>Doctor</th>
                      <th>Specialization</th>
                      <th>Fee</th>
                      <th>Location</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((doc) => (
                      <tr key={doc.id}>
                        <td style={{ fontWeight: 600, color: 'var(--brand-blue)' }}>
                          Dr. {doc.first_name} {doc.last_name}
                        </td>
                        <td>{doc.department}</td>
                        <td style={{ fontWeight: 600, color: '#166534' }}>
                          ₹{doc.price != null ? Number(doc.price).toFixed(2) : '—'}
                        </td>
                        <td>
                          <div className="location-chip">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
                            </svg>
                            {doc.room_name} ({doc.block}, Fl {doc.floor})
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="select-btn-sm" onClick={() => handleSelectDoctor(doc)}>
                            Select
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  {isSearching ? 'Searching duty rosters...' : 'No doctors found on duty for the selected criteria.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AppointmentBooking;