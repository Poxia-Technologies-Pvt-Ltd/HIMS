import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  MapPin,
  Check
} from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import PatientDetails from './PatientDetails';
import AppointmentBooking from '../Billing/AppointmentBooking';
import Billing from '../Billing/Billing';
import '../../assets/CSS/PatientRegistration.css';

const TABS = [
  { id: 'details', label: 'Patient Details', num: '1' },
  { id: 'appointment', label: 'Appointment Booking', num: '2' },
  { id: 'billing', label: 'Billing', num: '3' },
];

function PatientRegistration() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [activeTab, setActiveTab] = useState('details');
  const [isPatientSaved, setIsPatientSaved] = useState(false);
  const [patientRegNo, setPatientRegNo] = useState(null);
  const [bookingData, setBookingData] = useState(null);
  const [detailsKey, setDetailsKey] = useState(0);
  const [labName, setLabName] = useState('Loading...');

  const branchId = localStorage.getItem('branch_id');

  const fetchLabName = async () => {
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_BASE}/api/infra?type=Lab&branch_id=${branchId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('hims_token')}` }
      });
      const data = await res.json();
      if (data.success && data.items.length > 0) {
        setLabName(data.items[0].name);
      } else {
        setLabName(localStorage.getItem('hospital_code') || 'General Hospital');
      }
    } catch (err) {
      console.error('Error fetching lab name:', err);
      setLabName(localStorage.getItem('hospital_code') || 'General Hospital');
    }
  };

  useEffect(() => {
    if (branchId) fetchLabName();
    else setLabName('General Hospital');
  }, [branchId]);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Global Tab Switching Shortcuts (Alt+1, Alt+2, Alt+3)
  useEffect(() => {
    const handleTabSwitch = (e) => {
      if (e.altKey) {
        if (e.key === '1') { e.preventDefault(); setActiveTab('details'); }
        if (e.key === '2' && isPatientSaved) { e.preventDefault(); setActiveTab('appointment'); }
        if (e.key === '3' && isPatientSaved) { e.preventDefault(); setActiveTab('billing'); }
      }
    };
    window.addEventListener('keydown', handleTabSwitch);
    return () => window.removeEventListener('keydown', handleTabSwitch);
  }, [isPatientSaved]);

  const handlePatientSaved = (regNo) => {
    setPatientRegNo(regNo);
    setIsPatientSaved(true);
    setActiveTab('appointment');
  };

  const handleAppointmentSaved = (data) => {
    setBookingData(data);
    setActiveTab('billing');
  };

  const handleNewRegistration = () => {
    setActiveTab('details');
    setIsPatientSaved(false);
    setPatientRegNo(null);
    setBookingData(null);
    setDetailsKey(k => k + 1);
  };

  const executeSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const token = localStorage.getItem('hims_token');
      const res = await fetch(`${API_BASE}/api/patients/search?q=${encodeURIComponent(searchQuery)}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const result = await res.json();

      if (result.success) {
        setPatientRegNo(result.patient.reg_no);
        setIsPatientSaved(true); // Treat as saved since they exist
        setActiveTab('appointment'); // Jump them to appointment
        showAlert(`Found returning patient: ${result.patient.first_name} ${result.patient.last_name}`, 'success');
      } else {
        showAlert('No patient found. Please proceed with new registration.', 'warning');
      }
    } catch (err) {
      console.error(err);
      showAlert('Error searching for patient.', 'error');
    } finally {
      setIsSearching(false);
    }
  };

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
      <div className="preg-page">
        {/* ── App Bar ── */}
        <header className="preg-appbar">
          <br />
          <div className="preg-appbar-top">
            <div className="preg-title-group">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h1>Patient Registration & Context {patientRegNo && <span style={{ color: 'var(--brand-blue)', fontWeight: 'bold' }}>{patientRegNo}</span>}</h1>
                <span style={{
                  background: '#e0f2fe',
                  color: '#0369a1',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: '600',
                  border: '1px solid #bae6fd',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <MapPin size={12} />
                  {labName}
                </span>
              </div>
              <span>Complete sections or search for an existing patient</span>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              {isPatientSaved && (
                <button className="btn-primary" onClick={handleNewRegistration} style={{ padding: '6px 14px', fontSize: '13px' }}>
                  + New Registration
                </button>
              )}
              <button className="preg-back-btn" onClick={() => window.history.back()}>
                <ArrowLeft size={14} />
                Exit
              </button>
            </div>
          </div>

          {/* ── Tabs ── */}
          <nav className="preg-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`preg-tab ${activeTab === t.id ? 'active' : ''}`}
                onClick={() => setActiveTab(t.id)}
                disabled={t.id !== 'details' && !isPatientSaved}
                title={t.id !== 'details' && !isPatientSaved ? 'Save patient details first' : ''}
              >
                <span className="preg-tab-badge">{t.num}</span>
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        {/* ── Content ── */}
        <div style={{ display: activeTab === 'details' ? 'contents' : 'none' }}>
          <PatientDetails key={detailsKey} onSaveSuccess={handlePatientSaved} />
        </div>
        {activeTab === 'appointment' && <AppointmentBooking regNo={patientRegNo} onSaveSuccess={handleAppointmentSaved} />}
        {activeTab === 'billing' && <Billing regNo={patientRegNo} bookingData={bookingData} />}

      </div>
    </>
  );
}

export default PatientRegistration;
