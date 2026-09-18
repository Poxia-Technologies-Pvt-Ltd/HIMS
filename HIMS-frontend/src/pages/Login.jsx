import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import m1 from '../assets/m1.png';
import m2 from '../assets/m2.png';
import m3 from '../assets/m3.png';
import merilLogo from '../assets/meril.png';
import '../assets/CSS/Login.css';
import { useCaptcha } from '../hooks/useCaptcha';

function Login() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [captchaText, setCaptchaText] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Informational, not a failure — kept separate from `error` so a genuine
  // login error doesn't sit alongside a stale "you were logged out" banner.
  const [notice, setNotice] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [focused, setFocused] = useState('');
  const [currentSlide, setCurrentSlide] = useState(0);
  const { svg: captchaSvg, captchaId, refresh: refreshCaptcha, applyCaptcha } = useCaptcha();

  const slides = [
    { image: m1, text: 'Innovation for better healthcare' },
    { image: m2, text: 'State-of-the-art diagnostic facilities' },
    { image: m3, text: 'Serving humanity with care' }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide(prev => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Explain why the user is back at the login screen. Set either by the idle
  // timer (useIdleLogout) or by the global 401 handler (utils/csrfClient) —
  // previously an expired session just surfaced the backend's raw "Invalid or
  // expired token" on whatever page they were on, which reads like a fault
  // rather than a normal timeout.
  useEffect(() => {
    let reason = null;
    try {
      reason = sessionStorage.getItem('logout_reason');
      // Read once: a refresh of the login page shouldn't repeat the message.
      if (reason) sessionStorage.removeItem('logout_reason');
    } catch { /* storage unavailable — no notice, login still works */ }

    if (reason === 'idle') {
      setNotice('You have been logged out due to inactivity. Please log in to continue.');
    } else if (reason === 'expired') {
      setNotice('Your session has ended. Please log in to continue.');
    }
  }, []);

  const handleChange = (e) => {
    setError('');
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  // VAPT #23: block copy/cut/paste (mouse and keyboard shortcuts) on
  // credential fields so a shoulder-surfer with clipboard access, or a
  // compromised clipboard manager, can't lift the value out of the DOM.
  const blockClipboard = (e) => e.preventDefault();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.email || !formData.password) {
      setError('Please fill in all fields.');
      return;
    }
    if (!captchaText) {
      setError('Please enter the captcha text.');
      return;
    }
    setLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // VAPT #9: the server sets the session token as an HttpOnly cookie
        // on this response — the browser only stores/sends it if the
        // request opts in to credentials.
        credentials: 'include',
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          captchaId,
          captchaText
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const err = new Error(data.message || 'Login failed');
        err.status = response.status;
        err.captcha = data.captcha;
        throw err;
      }

      // Clear any stale session data from a previous user before writing new values
      ['hims_authed', 'hims_csrf', 'branch_id', 'hospital_code', 'role_level', 'role', 'district_id', 'password_change_required'].forEach(
        key => localStorage.removeItem(key)
      );

      // Store fresh session context. VAPT #9: the actual session token is
      // never stored here — it arrived as an HttpOnly cookie on this
      // response, invisible to JS. `hims_authed` is just a UI flag so
      // RequireAuth/hasStaffToken know a session exists to redirect around;
      // it grants nothing by itself.
      localStorage.setItem('hims_authed', '1');
      if (data.csrfToken) localStorage.setItem('hims_csrf', data.csrfToken);
      if (data.id) localStorage.setItem('user_id', data.id);
      if (data.branch_id !== undefined && data.branch_id !== null) localStorage.setItem('branch_id', data.branch_id);
      if (data.hospital_code) localStorage.setItem('hospital_code', data.hospital_code);
      if (data.role_level) localStorage.setItem('role_level', data.role_level);
      if (data.role) localStorage.setItem('role', data.role);
      if (data.district_id) localStorage.setItem('district_id', data.district_id);
      localStorage.setItem('user', JSON.stringify(data)); // helpful for full context
      localStorage.setItem('password_change_required', data.passwordChangeRequired ? '1' : '0');

      navigate(
        data.passwordChangeRequired
          ? '/change-password'
          : data.role === 'Doctor' ? '/doctor-dashboard' : '/dashboard'
      );
    } catch (err) {
      setError(err.message);
      if (err.status === 429) {
        // IP is locked out for 24h — nothing left to retry, no captcha comes
        // back with this response, so just lock the form.
        setBlocked(true);
      } else {
        // The captcha is single-use on the server regardless of outcome, so
        // a failed attempt needs a fresh one before the user can retry.
        setCaptchaText('');
        applyCaptcha(err.captcha);
      }
    } finally {
      setLoading(false);
    }
  };

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
          {/* Brand Logo in Card */}
          <div className="brand-header">
            <img src={merilLogo} alt="Meril Logo" className="brand-logo-img" />
            <span className="product-name">Meril LIS</span>
            <p className="brand-motto">Laboratory Information System</p>
          </div>

          <div className="auth-card">
            <header className="auth-header">
              <h1 className="auth-title">Welcome Back!</h1>
              <p className="auth-subtitle">Sign in to your Meril LIS account</p>
            </header>

            {notice && !error && (
              <div className="alert alert-info" role="status">
                {notice}
              </div>
            )}

            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}

            <form id="login-form" className="auth-form" onSubmit={handleSubmit} noValidate autoComplete="off">
              <div className="form-group">
                <label className="field-label">Email or mobile number</label>
                <input
                  // Not type="email": the browser would refuse to submit a
                  // mobile number as invalid, which is exactly what half the
                  // lab floor will type.
                  type="text"
                  inputMode="email"
                  name="email"
                  className="field-input"
                  placeholder="you@example.com or 9876543210"
                  value={formData.email}
                  onChange={handleChange}
                  autoComplete="off"
                  onCopy={blockClipboard}
                  onCut={blockClipboard}
                  onPaste={blockClipboard}
                  required
                />
              </div>

              <div className="form-group" style={{ marginTop: '20px' }}>
                <label className="field-label">Password</label>
                <div className="input-with-toggle">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    className="field-input"
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={handleChange}
                    autoComplete="off"
                    onCopy={blockClipboard}
                    onCut={blockClipboard}
                    onPaste={blockClipboard}
                    required
                  />
                  <button
                    type="button"
                    className="toggle-eye"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
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

              <div className="form-options">
                <label className="remember-me">
                  <input type="checkbox" /> Remember Me
                </label>
                <Link to="/forgot-password" style={{ color: '#4F46E5', fontWeight: '600', textDecoration: 'none', fontSize: '14px' }}>
                  Forgot Password?
                </Link>
              </div>

              <button
                type="submit"
                className="btn-login-new"
                disabled={loading || blocked}
              >
                {loading ? 'Logging in...' : blocked ? 'Temporarily blocked' : 'Login'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Login;
