import { useState, useEffect } from 'react';
import '../../assets/CSS/PatientRegistration.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

function PatientProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const patientData = localStorage.getItem('patient_data');
    if (patientData) {
      const parsed = JSON.parse(patientData);
      fetchProfile(parsed.phone);
    }
  }, []);

  const fetchProfile = async (phone) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('patient_token');
      const response = await fetch(`${API_BASE}/api/patients/portal/profile/${phone}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      if (data.success) {
        setProfile(data.patient);
      } else {
        setError('Failed to load profile');
      }
    } catch {
      setError('Error loading profile');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const calculateAge = (dob) => {
    if (!dob) return '-';
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 20px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="40" height="40">
            <circle cx="12" cy="12" r="10" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="31.416">
              <animate attributeName="stroke-dashoffset" from="31.416" to="0" dur="1s" repeatCount="indefinite" />
            </circle>
          </svg>
        </div>
        <p>Loading your profile...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px' }}>
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1000px' }}>
      <header style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>
          My Profile
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Your personal and medical information
        </p>
      </header>

      {profile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Registration Info */}
          <section className="form-section">
            <h2 className="section-title">Registration Details</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
              <div className="info-field">
                <label>CRN No</label>
                <div className="value">{profile.reg_no || '-'}</div>
              </div>
              <div className="info-field">
                <label>Registration Date</label>
                <div className="value">{formatDate(profile.reg_date)}</div>
              </div>
              <div className="info-field">
                <label>Age</label>
                <div className="value">{calculateAge(profile.dob)} years</div>
              </div>
            </div>
          </section>

          {/* Personal Info */}
          <section className="form-section">
            <h2 className="section-title">Personal Information</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
              <div className="info-field">
                <label>Full Name</label>
                <div className="value">
                  {[profile.title, profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(' ')}
                </div>
              </div>
              <div className="info-field">
                <label>Date of Birth</label>
                <div className="value">{formatDate(profile.dob)}</div>
              </div>
              <div className="info-field">
                <label>Gender</label>
                <div className="value">{profile.gender || '-'}</div>
              </div>
              <div className="info-field">
                <label>Phone Number</label>
                <div className="value">{profile.telephone || '-'}</div>
              </div>
              <div className="info-field">
                <label>Email</label>
                <div className="value">{profile.email_id || '-'}</div>
              </div>
              <div className="info-field">
                <label>Marital Status</label>
                <div className="value">{profile.marital_status || '-'}</div>
              </div>
            </div>
          </section>

          {/* Address */}
          <section className="form-section">
            <h2 className="section-title">Address</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
              <div className="info-field" style={{ gridColumn: '1 / -1' }}>
                <label>Address</label>
                <div className="value">{profile.address || '-'}</div>
              </div>
              <div className="info-field">
                <label>City</label>
                <div className="value">{profile.city || '-'}</div>
              </div>
              <div className="info-field">
                <label>Country</label>
                <div className="value">{profile.country || '-'}</div>
              </div>
              <div className="info-field">
                <label>Postal Code</label>
                <div className="value">{profile.postal_code || '-'}</div>
              </div>
            </div>
          </section>

          {/* Emergency Contact */}
          <section className="form-section">
            <h2 className="section-title">Emergency Contact</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
              <div className="info-field">
                <label>Name</label>
                <div className="value">{profile.kin_name || '-'}</div>
              </div>
              <div className="info-field">
                <label>Relation</label>
                <div className="value">{profile.kin_relation || '-'}</div>
              </div>
              <div className="info-field">
                <label>Phone</label>
                <div className="value">{profile.kin_telephone || '-'}</div>
              </div>
            </div>
          </section>

          {/* Insurance */}
          <section className="form-section">
            <h2 className="section-title">Insurance Information</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
              <div className="info-field">
                <label>Payer Type</label>
                <div className="value">{profile.payer_type || '-'}</div>
              </div>
              <div className="info-field">
                <label>Insurance Provider</label>
                <div className="value">{profile.insurance_provider || '-'}</div>
              </div>
              <div className="info-field">
                <label>Policy Number</label>
                <div className="value">{profile.policy_number || '-'}</div>
              </div>
            </div>
          </section>

          {/* ID Information */}
          <section className="form-section">
            <h2 className="section-title">ID Information</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
              <div className="info-field">
                <label>Aadhar Number</label>
                <div className="value">{profile.aadhar_number ? 'XXXX-XXXX-' + profile.aadhar_number.slice(-4) : '-'}</div>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default PatientProfile;
