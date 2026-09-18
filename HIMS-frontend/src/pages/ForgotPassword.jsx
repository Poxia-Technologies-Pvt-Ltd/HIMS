import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import DOMPurify from 'dompurify';
import m1 from '../assets/m1.png';
import m2 from '../assets/m2.png';
import m3 from '../assets/m3.png';
import merilLogo from '../assets/meril.png';
import '../assets/CSS/Login.css';
import { useCaptcha } from '../hooks/useCaptcha';

const API_BASE = import.meta.env.VITE_API_URL || '';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const { svg: captchaSvg, captchaId, refresh: refreshCaptcha, applyCaptcha } = useCaptcha();

  const slides = [
    { image: m1, text: 'Innovation for better healthcare' },
    { image: m2, text: 'State-of-the-art diagnostic facilities' },
    { image: m3, text: 'Serving humanity with care' },
  ];

  useEffect(() => {
    const timer = setInterval(() => setCurrentSlide(prev => (prev + 1) % slides.length), 5000);
    return () => clearInterval(timer);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email.');
      return;
    }
    if (!captchaText) {
      setError('Please enter the captcha text.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, captchaId, captchaText }),
      });
      const data = await response.json();

      if (!response.ok) {
        const err = new Error(data.message || 'Something went wrong');
        err.captcha = data.captcha;
        throw err;
      }

      // Same generic message whether or not the email is registered — the
      // backend never confirms account existence, so neither does this UI.
      setSent(true);
    } catch (err) {
      setError(err.message);
      setCaptchaText('');
      applyCaptcha(err.captcha);
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
          <div className="brand-header">
            <img src={merilLogo} alt="Meril Logo" className="brand-logo-img" />
            <span className="product-name">Meril LIS</span>
            <p className="brand-motto">Laboratory Information System</p>
          </div>

          <div className="auth-card">
            {sent ? (
              <>
                <div className="auth-icon-badge auth-icon-badge--success" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <header className="auth-header">
                  <h1 className="auth-title">Check Your Inbox</h1>
                  <p className="auth-subtitle">
                    If that email is registered, a password reset link has been sent. The link expires in 30 minutes.
                  </p>
                </header>

                <p style={{ textAlign: 'center' }}>
                  <Link to="/" className="auth-back-link">← Back to Login</Link>
                </p>
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
                  <h1 className="auth-title">Forgot Password</h1>
                  <p className="auth-subtitle">Enter your account email and we'll send you a reset link.</p>
                </header>

                {error && <div className="alert alert-error" role="alert">{error}</div>}

                <form className="auth-form" onSubmit={handleSubmit} noValidate autoComplete="off">
                  <div className="form-group">
                    <label className="field-label">Email</label>
                    <input
                      type="email"
                      name="email"
                      className="field-input"
                      placeholder="admin@test.com"
                      value={email}
                      onChange={(e) => { setError(''); setEmail(e.target.value); }}
                      autoComplete="off"
                      required
                      autoFocus
                    />
                  </div>

                  <div className="form-group" style={{ marginTop: '20px' }}>
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

                  <button type="submit" className="btn-login-new" disabled={loading} style={{ marginTop: '24px' }}>
                    {loading ? 'Sending...' : 'Send Reset Link'}
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

export default ForgotPassword;
