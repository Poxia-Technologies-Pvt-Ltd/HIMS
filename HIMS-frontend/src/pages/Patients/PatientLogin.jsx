import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import '../../assets/CSS/Login.css';
import { useCaptcha } from '../../hooks/useCaptcha';

const API_BASE = import.meta.env.VITE_API_URL || '';

function PatientLogin() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ phone: '', dob: '' });
  const [captchaText, setCaptchaText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [focused, setFocused] = useState('');
  const { svg: captchaSvg, captchaId, refresh: refreshCaptcha, applyCaptcha } = useCaptcha();

  const handleChange = (e) => {
    setError('');
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.phone || !formData.dob) {
      setError('Please enter both phone number and date of birth.');
      return;
    }
    if (!captchaText) {
      setError('Please enter the captcha text.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/patients/portal/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: formData.phone,
          dob: formData.dob,
          captchaId,
          captchaText
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const err = new Error(data.message || 'Login failed');
        err.status = response.status;
        err.captcha = data.captcha;
        throw err;
      }

      // Store patient token and data
      if (data.token) localStorage.setItem('patient_token', data.token);
      if (data.patient) localStorage.setItem('patient_data', JSON.stringify(data.patient));

      navigate('/patient-portal/profile');
    } catch (err) {
      setError(err.message);
      if (err.status === 429) {
        // IP is locked out for 24h — nothing left to retry, no captcha comes
        // back with this response, so just lock the form.
        setBlocked(true);
      } else {
        setCaptchaText('');
        applyCaptcha(err.captcha);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <main className="auth-main">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            <svg viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 3v20M3 13h20" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-name">HIMS</span>
            <span className="brand-tagline">PATIENT PORTAL</span>
          </div>
        </div>

        <div className="auth-card">
          <header className="auth-header">
            <h1 className="auth-title">Patient Login</h1>
            <p className="auth-subtitle">Access your reports and profile</p>
          </header>

          {error && (
            <div className="alert alert-error" role="alert">
              <svg viewBox="0 0 20 20" fill="currentColor" width="17" height="17" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9V5a1 1 0 112 0v4a1 1 0 11-2 0zm0 4a1 1 0 102 0 1 1 0 00-2 0z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className={`field-group ${focused === 'phone' ? 'is-focused' : ''} ${formData.phone ? 'has-value' : ''}`}>
              <label htmlFor="patient-phone" className="field-label">Phone Number</label>
              <div className="input-wrapper">
                <span className="input-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="17" height="17">
                    <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                  </svg>
                </span>
                <input
                  id="patient-phone"
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  onFocus={() => setFocused('phone')}
                  onBlur={() => setFocused('')}
                  placeholder="Enter your phone number"
                  required
                />
              </div>
            </div>

            <div className={`field-group ${focused === 'dob' ? 'is-focused' : ''} ${formData.dob ? 'has-value' : ''}`}>
              <label htmlFor="patient-dob" className="field-label">Date of Birth</label>
              <div className="input-wrapper">
                <span className="input-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="17" height="17">
                    <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                  </svg>
                </span>
                <input
                  id="patient-dob"
                  type="date"
                  name="dob"
                  value={formData.dob}
                  onChange={handleChange}
                  onFocus={() => setFocused('dob')}
                  onBlur={() => setFocused('')}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="field-label">Captcha</label>
              <div className="captcha-row">
                <div
                  className="captcha-image"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(captchaSvg, { USE_PROFILES: { svg: true, svgFilters: true } }) }}
                />
                <button
                  type="button"
                  className="captcha-refresh"
                  onClick={() => { setCaptchaText(''); refreshCaptcha(); }}
                  aria-label="Refresh captcha"
                  title="Refresh captcha"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                </button>
              </div>
              <input
                type="text"
                name="captchaText"
                className="field-input"
                placeholder="Enter the text shown above"
                value={captchaText}
                onChange={(e) => setCaptchaText(e.target.value)}
                autoComplete="off"
                required
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading || blocked}>
              {loading ? (
                <span className="spinner">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="31.416">
                      <animate attributeName="stroke-dashoffset" from="31.416" to="0" dur="1s" repeatCount="indefinite" />
                    </circle>
                  </svg>
                  Signing in...
                </span>
              ) : blocked ? (
                'Temporarily blocked'
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="auth-footer" style={{ marginTop: '24px', textAlign: 'center' }}>
            <Link to="/" style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
              ← Back to Staff Login
            </Link>
          </div>
        </div>
      </main>

      <aside className="auth-aside">
        <div className="auth-aside-overlay" />
        <div className="auth-aside-content">
          <h2 className="aside-title">Your Health,<br />Simplified</h2>
          <p className="aside-desc">Access your lab reports and medical history anytime, anywhere.</p>
        </div>
      </aside>
    </div>
  );
}

export default PatientLogin;
