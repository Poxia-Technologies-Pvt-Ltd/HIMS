import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import m1 from '../assets/m1.png';
import m2 from '../assets/m2.png';
import m3 from '../assets/m3.png';
import merilLogo from '../assets/meril.png';
import '../assets/CSS/Login.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// VAPT #23 (Clipboard Data Stealing Attack): matches Login.jsx/ChangePassword.jsx.
const blockClipboard = (e) => e.preventDefault();

const PASSWORD_REQUIREMENTS = [
  { re: /.{8,}/, label: 'At least 8 characters' },
  { re: /[A-Z]/, label: 'One uppercase letter' },
  { re: /[a-z]/, label: 'One lowercase letter' },
  { re: /[0-9]/, label: 'One number' },
  { re: /[^A-Za-z0-9]/, label: 'One special character' },
];

function PasswordStrength({ password }) {
  if (!password) return null;
  const met = PASSWORD_REQUIREMENTS.filter(r => r.re.test(password));
  const pct = (met.length / PASSWORD_REQUIREMENTS.length) * 100;
  const color = pct <= 25 ? '#ef4444' : pct <= 50 ? '#f59e0b' : pct <= 75 ? '#3b82f6' : '#10b981';
  const label = pct <= 25 ? 'Weak' : pct <= 50 ? 'Fair' : pct <= 75 ? 'Good' : 'Strong';

  return (
    <div style={{ marginTop: '10px' }}>
      <div style={{ height: '5px', borderRadius: '3px', background: '#e2e8f0', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.25s ease, background 0.25s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color }}>{label}</span>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {PASSWORD_REQUIREMENTS.map(req => {
            const isMet = req.re.test(password);
            return (
              <span key={req.label} style={{ fontSize: '11px', color: isMet ? '#10b981' : '#94a3b8', fontWeight: 500 }}>
                {isMet ? '✓' : '○'} {req.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EyeToggle({ shown, onClick }) {
  return (
    <button type="button" className="toggle-eye" onClick={onClick} aria-label={shown ? 'Hide password' : 'Show password'}>
      {shown ? (
        <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" /><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" /></svg>
      ) : (
        <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
      )}
    </button>
  );
}

function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = [
    { image: m1, text: 'Innovation for better healthcare' },
    { image: m2, text: 'State-of-the-art diagnostic facilities' },
    { image: m3, text: 'Serving humanity with care' },
  ];

  useEffect(() => {
    const timer = setInterval(() => setCurrentSlide(prev => (prev + 1) % slides.length), 5000);
    return () => clearInterval(timer);
  }, []);

  const handleChange = (e) => {
    setError('');
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      setError('This reset link is missing its token. Please use the link from your email.');
      return;
    }
    if (!(form.newPassword.length >= 8 && /[A-Z]/.test(form.newPassword) && /[a-z]/.test(form.newPassword) && /[0-9]/.test(form.newPassword) && /[^A-Za-z0-9]/.test(form.newPassword))) {
      setError('Password must be at least 8 characters, with an upper-case letter, a lower-case letter, a number and a symbol.');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: form.newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Password reset failed');

      setSuccess('Password reset successfully. Redirecting to login...');
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const mismatch = form.confirmPassword.length > 0 && form.newPassword !== form.confirmPassword;

  return (
    <div className="auth-page">
      {/* ── Left Panel: Carousel ── */}
      <aside className="auth-aside" aria-hidden="true">
        <div className="carousel-container">
          {slides.map((slide, index) => (
            <div
              key={index}
              className={`carousel-slide ${index === currentSlide ? 'active' : ''}`}
              style={{ backgroundImage: `url(${slide.image})` }}
            >
              <div className="carousel-content">
                <div className="carousel-badge">
                  <span className="carousel-badge-dot"></span>
                  Meril LIS — Live System
                </div>
                <p className="carousel-text">{slide.text}</p>
              </div>
            </div>
          ))}
          <div className="carousel-indicators">
            {slides.map((_, index) => (
              <div
                key={index}
                className={`indicator ${index === currentSlide ? 'active' : ''}`}
                onClick={() => setCurrentSlide(index)}
              />
            ))}
          </div>
        </div>
      </aside>

      {/* ── Right Panel: Form ── */}
      <main className="auth-main">
        <div className="auth-card-container">
          <div className="brand-header">
            <img src={merilLogo} alt="Meril Logo" className="brand-logo-img" />
            <span className="product-name">Meril LIS</span>
            <p className="brand-motto">Laboratory Information System</p>
          </div>

          <div className="auth-card">
            {success ? (
              <>
                <div className="auth-icon-badge auth-icon-badge--success" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <header className="auth-header">
                  <h1 className="auth-title">All Set!</h1>
                  <p className="auth-subtitle">{success}</p>
                </header>
              </>
            ) : (
              <>
                <div className="auth-icon-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </div>
                <header className="auth-header">
                  <h1 className="auth-title">Reset Password</h1>
                  <p className="auth-subtitle">Choose a new password for your account.</p>
                </header>

                {error && <div className="alert alert-error" role="alert">{error}</div>}

                {!token && (
                  <div className="alert alert-error" role="alert">
                    No reset token found in this link. Please use the link from your email, or request a new one.
                  </div>
                )}

                <form className="auth-form" onSubmit={handleSubmit} noValidate autoComplete="off">
                  <div className="form-group">
                    <label className="field-label">New Password</label>
                    <div className="input-with-toggle">
                      <input
                        type={showNew ? 'text' : 'password'}
                        name="newPassword"
                        className="field-input"
                        value={form.newPassword}
                        onChange={handleChange}
                        autoComplete="new-password"
                        onCopy={blockClipboard}
                        onCut={blockClipboard}
                        onPaste={blockClipboard}
                        required
                        autoFocus
                      />
                      <EyeToggle shown={showNew} onClick={() => setShowNew(s => !s)} />
                    </div>
                    <PasswordStrength password={form.newPassword} />
                  </div>

                  <div className="form-group" style={{ marginTop: '20px' }}>
                    <label className="field-label">Confirm New Password</label>
                    <div className="input-with-toggle">
                      <input
                        type={showConfirm ? 'text' : 'password'}
                        name="confirmPassword"
                        className="field-input"
                        style={mismatch ? { borderColor: '#ef4444' } : undefined}
                        value={form.confirmPassword}
                        onChange={handleChange}
                        autoComplete="new-password"
                        onCopy={blockClipboard}
                        onCut={blockClipboard}
                        onPaste={blockClipboard}
                        required
                      />
                      <EyeToggle shown={showConfirm} onClick={() => setShowConfirm(s => !s)} />
                    </div>
                    {mismatch && (
                      <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '6px', fontWeight: 500 }}>
                        Passwords do not match
                      </div>
                    )}
                  </div>

                  <button type="submit" className="btn-login-new" disabled={loading} style={{ marginTop: '24px' }}>
                    {loading ? 'Resetting...' : 'Reset Password'}
                  </button>

                  <p style={{ marginTop: '20px', textAlign: 'center' }}>
                    <Link to="/" className="auth-back-link">← Back to Login</Link>
                  </p>
                </form>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default ResetPassword;
