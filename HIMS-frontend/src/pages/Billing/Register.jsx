import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import vectorImg from '../../assets/vector.jpg';
import '../../assets/CSS/Auth.css';

const ROLES = [
  { value: 'doctor', label: 'Doctor', icon: '🩺' },
  { value: 'nurse', label: 'Nurse', icon: '👩‍⚕️' },
  { value: 'admin', label: 'Admin', icon: '🖥️' },
  { value: 'receptionist', label: 'Receptionist', icon: '📋' },
  { value: 'lab_tech', label: 'Lab Technician', icon: '🔬' },
  { value: 'pharmacist', label: 'Pharmacist', icon: '💊' },
];

// VAPT #23 (Clipboard Data Stealing Attack): matches Login.jsx/ChangePassword.jsx.
const blockClipboard = (e) => e.preventDefault();

const PASSWORD_REQUIREMENTS = [
  { re: /.{8,}/, label: 'At least 8 characters' },
  { re: /[A-Z]/, label: 'One uppercase letter' },
  { re: /[0-9]/, label: 'One number' },
  { re: /[^A-Za-z0-9]/, label: 'One special character' },
];

function PasswordStrength({ password }) {
  const met = PASSWORD_REQUIREMENTS.filter(r => r.re.test(password));
  const pct = (met.length / PASSWORD_REQUIREMENTS.length) * 100;
  const color = pct <= 25 ? '#ff4d6d' : pct <= 50 ? '#fbbf24' : pct <= 75 ? '#00c2ff' : '#00e5a0';
  const label = pct <= 25 ? 'Weak' : pct <= 50 ? 'Fair' : pct <= 75 ? 'Good' : 'Strong';

  if (!password) return null;

  return (
    <div className="password-strength">
      <div className="strength-bar-track">
        <div className="strength-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="strength-info">
        <span className="strength-label" style={{ color }}>{label}</span>
        <div className="strength-requirements">
          {PASSWORD_REQUIREMENTS.map(req => (
            <span
              key={req.label}
              className={`req-item ${req.re.test(password) ? 'met' : ''}`}
            >
              <span className="req-dot" aria-hidden="true">{req.re.test(password) ? '✓' : '○'}</span>
              {req.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Register() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    role: '', department: '', staffId: '',
    password: '', confirmPassword: '',
    branchId: '',
    newBranchName: '', newHospitalCode: '', newDistrictId: '',
    agreeTerms: false,
  });
  const [branches, setBranches] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const API_BASE = import.meta.env.VITE_API_URL || '';
        const res = await fetch(`${API_BASE}/api/branches`);
        const data = await res.json();
        if (data.success) {
          setBranches(data.branches || []);
          setDistricts(data.districts || []);
        }
      } catch (err) {
        console.error('Failed to fetch branches', err);
      }
    };
    fetchBranches();
  }, []);

  const handleChange = (e) => {
    setError('');
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleRoleSelect = (value) => {
    setFormData(prev => ({ ...prev, role: value }));
    setError('');
  };

  const validateStep1 = () => {
    if (!formData.firstName.trim()) return 'First name is required.';
    if (!formData.lastName.trim()) return 'Last name is required.';
    if (!formData.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return 'Please enter a valid email address.';
    if (formData.phone && !formData.phone.match(/^[+\d\s\-()]{7,15}$/)) return 'Please enter a valid phone number.';
    return null;
  };

  const validateStep2 = () => {
    if (!formData.role) return 'Please select a role.';
    if (!formData.department.trim()) return 'Department is required.';
    if (!formData.branchId) return 'Please select a facility/branch.';
    if (formData.branchId === 'NEW') {
      if (!formData.newBranchName.trim()) return 'Please enter the new facility name.';
      if (!formData.newHospitalCode.trim()) return 'Please enter a hospital code.';
      if (!formData.newDistrictId) return 'Please select a district for the new facility.';
    }
    return null;
  };

  const validateStep3 = () => {
    if (formData.password.length < 8) return 'Password must be at least 8 characters.';
    if (formData.password !== formData.confirmPassword) return 'Passwords do not match.';
    if (!formData.agreeTerms) return 'Please accept the terms and conditions.';
    return null;
  };

  const nextStep = () => {
    const err = step === 1 ? validateStep1() : step === 2 ? validateStep2() : null;
    if (err) { setError(err); return; }
    setError('');
    setStep(s => s + 1);
  };

  const prevStep = () => { setError(''); setStep(s => s - 1); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validateStep3();
    if (err) { setError(err); return; }

    setLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          phone: formData.phone,
          role: formData.role,
          department: formData.department,
          staffId: formData.staffId,
          password: formData.password,
          branch_id: formData.branchId,
          role_level: formData.role === 'admin' ? 'Sub-Central' : 'Branch',
          newBranchName: formData.branchId === 'NEW' ? formData.newBranchName : undefined,
          newHospitalCode: formData.branchId === 'NEW' ? formData.newHospitalCode : undefined,
          newDistrictId: formData.branchId === 'NEW' ? formData.newDistrictId : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Registration failed');
      }

      // Store token (optional but standard)
      if (data.token) localStorage.setItem('hims_token', data.token);

      setSuccess(true);
      setTimeout(() => navigate('/'), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fieldProps = (name) => ({
    name,
    id: `reg-${name}`,
    value: formData[name],
    onChange: handleChange,
    onFocus: () => setFocused(name),
    onBlur: () => setFocused(''),
    className: 'field-input',
  });

  const wrapperClass = (name) =>
    `field-group ${focused === name ? 'is-focused' : ''} ${formData[name] ? 'has-value' : ''}`;

  if (success) {
    return (
      <div className="auth-page">
        <div className="success-screen">
          <div className="success-icon" aria-hidden="true">
            <svg viewBox="0 0 80 80" fill="none">
              <circle cx="40" cy="40" r="40" fill="url(#sg)" />
              <path d="M24 40l11 11 21-22" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <defs>
                <linearGradient id="sg" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#1a6fd4" /><stop offset="1" stopColor="#0ea5e9" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h2 className="success-title">Account Created!</h2>
          <p className="success-msg">
            Your HIMS account has been created successfully.<br />
            Redirecting you to login…
          </p>
          <div className="success-dots">
            <span /><span /><span />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      {/* ── Left Panel: Form ── */}

      <main className="auth-main">
        {/* Brand */}
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            <svg viewBox="0 0 26 26" fill="none">
              <path d="M13 3v20M3 13h20" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-name">HIMS</span>
            <span className="brand-tagline">HOSPITAL MANAGEMENT</span>
          </div>
        </div>
        <div className="auth-card auth-card--wide">
          <header className="auth-header">
            <div className="auth-logo mobile-only" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none">
                <rect x="4" y="4" width="40" height="40" rx="12" fill="url(#rg2)" />
                <path d="M24 13v22M13 24h22" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
                <defs>
                  <linearGradient id="rg2" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#00c2ff" /><stop offset="1" stopColor="#7c3aed" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <h1 className="auth-title">Create Account</h1>
            <p className="auth-subtitle">Step {step} of 3 — {
              step === 1 ? 'Personal information' : step === 2 ? 'Role & department' : 'Security setup'
            }</p>

            {/* Step indicator */}
            <div className="step-indicator" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={3} aria-label="Registration progress">
              {[1, 2, 3].map(n => (
                <div key={n} className={`step-dot ${step === n ? 'active' : ''} ${step > n ? 'done' : ''}`}>
                  <span>{step > n ? '✓' : n}</span>
                </div>
              ))}
              <div className="step-track">
                <div className="step-fill" style={{ width: `${((step - 1) / 2) * 100}%` }} />
              </div>
            </div>
          </header>

          {error && (
            <div className="alert alert-error" role="alert">
              <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9V5a1 1 0 112 0v4a1 1 0 11-2 0zm0 4a1 1 0 102 0 1 1 0 00-2 0z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          <form
            id={`register-form-step-${step}`}
            className="auth-form"
            onSubmit={step < 3 ? (e) => { e.preventDefault(); nextStep(); } : handleSubmit}
            noValidate
          >
            {/* STEP 1 */}
            {step === 1 && (
              <div className="form-step" key="step1">
                <div className="field-row">
                  <div className={wrapperClass('firstName')}>
                    <label htmlFor="reg-firstName" className="field-label">First Name</label>
                    <div className="input-wrapper">
                      <span className="input-icon" aria-hidden="true">
                        <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                          <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                        </svg>
                      </span>
                      <input {...fieldProps('firstName')} type="text" placeholder="John" autoComplete="given-name" required />
                    </div>
                  </div>
                  <div className={wrapperClass('lastName')}>
                    <label htmlFor="reg-lastName" className="field-label">Last Name</label>
                    <div className="input-wrapper">
                      <span className="input-icon" aria-hidden="true">
                        <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                          <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                        </svg>
                      </span>
                      <input {...fieldProps('lastName')} type="text" placeholder="Doe" autoComplete="family-name" required />
                    </div>
                  </div>
                </div>

                <div className={wrapperClass('email')}>
                  <label htmlFor="reg-email" className="field-label">Email Address</label>
                  <div className="input-wrapper">
                    <span className="input-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                        <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                        <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                      </svg>
                    </span>
                    <input {...fieldProps('email')} type="email" placeholder="john.doe@hospital.com" autoComplete="email" required />
                  </div>
                </div>

                <div className={wrapperClass('phone')}>
                  <label htmlFor="reg-phone" className="field-label">
                    Phone Number <span className="optional">(optional)</span>
                  </label>
                  <div className="input-wrapper">
                    <span className="input-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                        <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                      </svg>
                    </span>
                    <input {...fieldProps('phone')} type="tel" placeholder="+1 (555) 000-0000" autoComplete="tel" />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <div className="form-step" key="step2">
                <div className="field-group">
                  <span className="field-label">Select Your Role</span>
                  <div className="role-grid" role="radiogroup" aria-label="Staff role selection">
                    {ROLES.map(r => (
                      <button
                        key={r.value}
                        type="button"
                        id={`reg-role-${r.value}`}
                        className={`role-card ${formData.role === r.value ? 'selected' : ''}`}
                        onClick={() => handleRoleSelect(r.value)}
                        aria-pressed={formData.role === r.value}
                      >
                        <span className="role-icon" aria-hidden="true">{r.icon}</span>
                        <span className="role-label">{r.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className={wrapperClass('department')}>
                  <label htmlFor="reg-department" className="field-label">Department</label>
                  <div className="input-wrapper">
                    <span className="input-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
                      </svg>
                    </span>
                    <select {...fieldProps('department')} className="field-input field-select" required>
                      <option value="" disabled>Select department…</option>
                      {['Emergency', 'Cardiology', 'Neurology', 'Orthopedics', 'Pediatrics', 'Oncology', 'Radiology', 'Pathology', 'Pharmacy', 'Administration', 'ICU', 'Surgery'].map(d => (
                        <option key={d} value={d.toLowerCase()}>{d}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={wrapperClass('branchId')}>
                  <label htmlFor="reg-branchId" className="field-label">Facility / Branch</label>
                  <div className="input-wrapper">
                    <span className="input-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
                      </svg>
                    </span>
                    <select {...fieldProps('branchId')} className="field-input field-select" required>
                      <option value="" disabled>Select facility...</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.branch_name} ({b.hospital_code})</option>
                      ))}
                      <option value="NEW" style={{ fontWeight: 'bold', color: '#3b82f6' }}>+ Create New Facility</option>
                    </select>
                  </div>
                </div>

                {formData.branchId === 'NEW' && (
                  <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: '1px solid #e2e8f0' }}>
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#0f172a' }}>New Facility Details</h4>

                    <div className={wrapperClass('newBranchName')} style={{ marginBottom: '12px' }}>
                      <label className="field-label">Facility Name</label>
                      <input {...fieldProps('newBranchName')} type="text" placeholder="e.g. City General Hospital" required />
                    </div>

                    <div className={wrapperClass('newHospitalCode')} style={{ marginBottom: '12px' }}>
                      <label className="field-label">Hospital Code</label>
                      <input {...fieldProps('newHospitalCode')} type="text" placeholder="e.g. CGH-01" required />
                    </div>

                    <div className={wrapperClass('newDistrictId')} style={{ marginBottom: '0' }}>
                      <label className="field-label">District Location</label>
                      <select {...fieldProps('newDistrictId')} className="field-input field-select" required>
                        <option value="" disabled>Select district...</option>
                        {districts.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className={wrapperClass('staffId')}>
                  <label htmlFor="reg-staffId" className="field-label">
                    Staff ID <span className="optional">(optional)</span>
                  </label>
                  <div className="input-wrapper">
                    <span className="input-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                        <path fillRule="evenodd" d="M10 2a1 1 0 00-1 1v1a1 1 0 002 0V3a1 1 0 00-1-1zM4 4h3a3 3 0 006 0h3a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm2.5 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm2.45 4a2.5 2.5 0 10-4.9 0h4.9zM12 9a1 1 0 000 2h3a1 1 0 000-2h-3zm-1 4a1 1 0 011-1h2a1 1 0 010 2h-2a1 1 0 01-1-1z" clipRule="evenodd" />
                      </svg>
                    </span>
                    <input {...fieldProps('staffId')} type="text" placeholder="e.g. HMS-2024-001" />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3 */}
            {step === 3 && (
              <div className="form-step" key="step3">
                <div className={`field-group ${focused === 'password' ? 'is-focused' : ''} ${formData.password ? 'has-value' : ''}`}>
                  <label htmlFor="reg-password" className="field-label">Password</label>
                  <div className="input-wrapper">
                    <span className="input-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                    </span>
                    <input
                      id="reg-password" name="password" type={showPassword ? 'text' : 'password'}
                      className="field-input" placeholder="••••••••••"
                      value={formData.password} onChange={handleChange}
                      onFocus={() => setFocused('password')} onBlur={() => setFocused('')}
                      onCopy={blockClipboard} onCut={blockClipboard} onPaste={blockClipboard}
                      autoComplete="new-password" required
                    />
                    <button type="button" id="reg-toggle-password" className="toggle-password"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword(p => !p)}>
                      {showPassword
                        ? <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" /><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" /></svg>
                        : <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>}
                    </button>
                  </div>
                  <PasswordStrength password={formData.password} />
                </div>

                <div className={`field-group ${focused === 'confirmPassword' ? 'is-focused' : ''} ${formData.confirmPassword ? 'has-value' : ''}`}>
                  <label htmlFor="reg-confirmPassword" className="field-label">Confirm Password</label>
                  <div className="input-wrapper">
                    <span className="input-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                        <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </span>
                    <input
                      id="reg-confirmPassword" name="confirmPassword"
                      type={showConfirm ? 'text' : 'password'}
                      className={`field-input ${formData.confirmPassword && formData.confirmPassword !== formData.password ? 'input-error' : ''}`}
                      placeholder="••••••••••"
                      value={formData.confirmPassword} onChange={handleChange}
                      onFocus={() => setFocused('confirmPassword')} onBlur={() => setFocused('')}
                      onCopy={blockClipboard} onCut={blockClipboard} onPaste={blockClipboard}
                      autoComplete="new-password" required
                    />
                    <button type="button" id="reg-toggle-confirm" className="toggle-password"
                      aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                      onClick={() => setShowConfirm(p => !p)}>
                      {showConfirm
                        ? <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" /><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" /></svg>
                        : <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>}
                    </button>
                  </div>
                  {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                    <span className="field-hint field-hint--error">Passwords do not match</span>
                  )}
                  {formData.confirmPassword && formData.password === formData.confirmPassword && (
                    <span className="field-hint field-hint--success">✓ Passwords match</span>
                  )}
                </div>

                <label className="checkbox-label terms-label" htmlFor="reg-terms">
                  <input type="checkbox" id="reg-terms" name="agreeTerms" className="checkbox-input"
                    checked={formData.agreeTerms} onChange={handleChange} required />
                  <span className="checkbox-custom" aria-hidden="true" />
                  <span>
                    I agree to the <Link to="/terms" target="_blank">Terms of Service</Link> and{' '}
                    <Link to="/privacy" target="_blank">Privacy Policy</Link>
                  </span>
                </label>
              </div>
            )}

            {/* Navigation */}
            <div className="form-nav">
              {step > 1 && (
                <button type="button" id="reg-back" className="btn-secondary" onClick={prevStep}>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
                    <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 010 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                  </svg>
                  Back
                </button>
              )}
              <button
                type="submit"
                id={step < 3 ? `reg-next-step-${step}` : 'reg-submit'}
                className={`btn-primary ${loading ? 'btn-loading' : ''}`}
                style={{ marginLeft: step === 1 ? 'auto' : undefined }}
                disabled={loading}
              >
                {loading ? (
                  <><span className="spinner" aria-hidden="true" />Creating account…</>
                ) : step < 3 ? (
                  <>
                    Continue
                    <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
                      <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </>
                ) : (
                  <>
                    Create Account
                    <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </form>

          <p className="auth-footer">
            Already have an account?{' '}
            <Link to="/" id="register-to-login">Sign in instead</Link>
          </p>
        </div>
      </main>

      {/* ── Right Panel: Illustration ── */}
      <aside className="auth-aside" aria-hidden="true">
        <div className="aside-illustration">
          <img src={vectorImg} alt="Hospital management illustration" />
        </div>
      </aside>
    </div>
  );
}

export default Register;
