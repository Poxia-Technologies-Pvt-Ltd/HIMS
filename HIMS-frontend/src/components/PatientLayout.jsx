import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import '../assets/CSS/Sidebar.css';
import { useIdleLogout } from '../hooks/useIdleLogout';
import { clearPatientSession, hasPatientToken } from '../utils/session';

function PatientLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  useIdleLogout(clearPatientSession, '/patient-login');

  useEffect(() => {
    const onPageShow = (e) => {
      if (e.persisted && !hasPatientToken()) {
        navigate('/patient-login', { replace: true });
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [navigate]);

  const patient = useMemo(() => {
    const patientData = localStorage.getItem('patient_data');
    if (!patientData) {
      navigate('/patient-login');
      return null;
    }
    return JSON.parse(patientData);
  }, [navigate]);

  const handleLogout = () => {
    clearPatientSession();
    navigate('/patient-login', { replace: true });
  };

  const navItems = [
    { id: 'profile', label: 'My Profile', path: '/patient-portal/profile' },
    { id: 'reports', label: 'Lab Reports', path: '/patient-portal/reports' },
  ];

  if (!patient) return null;

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Patient Navigation Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo-container">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L12 22" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" />
              <path d="M2 12L22 12" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="12" r="5" fill="#1d4ed8" fillOpacity="0.3" stroke="#60a5fa" strokeWidth="1.5" />
            </svg>
          </div>
          <span className="sidebar-brand">Patient Portal</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            >
              <span className="nav-text">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">
              {patient?.first_name?.[0]}{patient?.last_name?.[0]}
            </div>
            <div className="user-info">
              <span className="user-name">{patient?.first_name} {patient?.last_name}</span>
              <span className="user-role">Patient</span>
            </div>
          </div>

          <button className="logout-btn" onClick={handleLogout}>
            <div className="nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </div>
            <span className="nav-text">Sign Out</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main style={{
        flex: 1,
        height: '100vh',
        overflowY: 'auto',
        background: 'var(--sys-bg)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <Outlet />
      </main>
    </div>
  );
}

export default PatientLayout;
