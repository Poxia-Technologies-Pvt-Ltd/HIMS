import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import DOMPurify from 'dompurify';
import { useCaptcha } from '../../hooks/useCaptcha';

const API = import.meta.env.VITE_API_URL || '';

export default function DeveloperLogin() {
  const navigate = useNavigate();
  const [step, setStep]       = useState('email'); // 'email' | 'otp'
  const [email, setEmail]     = useState('');
  const [otp, setOtp]         = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [info, setInfo]       = useState('');
  const { svg: captchaSvg, captchaId, refresh: refreshCaptcha, applyCaptcha } = useCaptcha();

  const handleSendOTP = async (e) => {
    e.preventDefault();
    if (!captchaText) {
      setError('Please enter the captcha text.');
      return;
    }
    setError(''); setLoading(true);
    try {
      await axios.post(`${API}/api/dev/send-otp`, { email, captchaId, captchaText });
      setInfo(`OTP sent to ${email}`);
      setStep('otp');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send OTP');
      setCaptchaText('');
      applyCaptcha(err.response?.data?.captcha);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      // VAPT #9: the dev session lives in an httpOnly cookie set by the
      // server response (see developerController.verifyOTP) — never handed
      // to JS, so there's nothing to store here beyond the CSRF token.
      const { data } = await axios.post(`${API}/api/dev/verify-otp`, { email, otp });
      if (data.csrfToken) localStorage.setItem('dev_csrf', data.csrfToken);
      // VAPT #4/#5: non-sensitive UI flag DeveloperPanel's bfcache check
      // reads — see session.js's hasDeveloperToken.
      localStorage.setItem('dev_authed', '1');
      navigate('/developer/panel');
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.iconWrap}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
          </div>
          <div style={styles.title}>Developer Portal</div>
          <div style={styles.subtitle}>LIMS — Restricted Access</div>
        </div>

        {/* Step indicator */}
        <div style={styles.steps}>
          <div style={{ ...styles.step, ...(step === 'email' ? styles.stepActive : styles.stepDone) }}>
            <span style={styles.stepNum}>{step === 'otp' ? '✓' : '1'}</span> Email
          </div>
          <div style={styles.stepLine} />
          <div style={{ ...styles.step, ...(step === 'otp' ? styles.stepActive : {}) }}>
            <span style={styles.stepNum}>2</span> OTP
          </div>
        </div>

        {/* Error / Info */}
        {error && <div style={styles.error}>{error}</div>}
        {info  && <div style={styles.info}>{info}</div>}

        {/* Email step */}
        {step === 'email' && (
          <form onSubmit={handleSendOTP} style={styles.form}>
            <label style={styles.label}>Developer Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              style={styles.input}
              autoFocus
            />
            <label style={styles.label}>Captcha</label>
            <div style={styles.captchaRow}>
              <div
                style={styles.captchaImage}
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(captchaSvg, { USE_PROFILES: { svg: true, svgFilters: true } }) }}
              />
              <button
                type="button"
                style={styles.captchaRefresh}
                onClick={() => { setCaptchaText(''); refreshCaptcha(); }}
                aria-label="Refresh captcha"
                title="Refresh captcha"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
              </button>
            </div>
            <input
              type="text"
              value={captchaText}
              onChange={e => setCaptchaText(e.target.value)}
              placeholder="Enter the text shown above"
              required
              style={styles.input}
              autoComplete="off"
            />
            <button type="submit" disabled={loading} style={styles.btn}>
              {loading ? 'Sending…' : 'Send OTP →'}
            </button>
          </form>
        )}

        {/* OTP step */}
        {step === 'otp' && (
          <form onSubmit={handleVerifyOTP} style={styles.form}>
            <label style={styles.label}>6-digit Code</label>
            <input
              type="text"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              required
              maxLength={6}
              style={{ ...styles.input, letterSpacing: '10px', fontSize: '24px', textAlign: 'center' }}
              autoFocus
            />
            <button type="submit" disabled={loading || otp.length < 6} style={styles.btn}>
              {loading ? 'Verifying…' : 'Verify & Enter'}
            </button>
            <button type="button" style={styles.linkBtn} onClick={() => { setStep('email'); setError(''); setInfo(''); setOtp(''); }}>
              ← Back
            </button>
          </form>
        )}

        <div style={styles.footer}>Valid OTP expires in 5 minutes · Max 3 attempts</div>
      </div>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  card: {
    width: '100%', maxWidth: '400px',
    background: '#1e293b', border: '1px solid #334155',
    borderRadius: '16px', padding: '40px 36px',
    boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
  },
  header: { textAlign: 'center', marginBottom: '28px' },
  iconWrap: {
    width: '56px', height: '56px', borderRadius: '14px',
    background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
  },
  title:    { fontSize: '22px', fontWeight: '700', color: '#f1f5f9', marginBottom: '4px' },
  subtitle: { fontSize: '13px', color: '#64748b' },
  steps: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '24px' },
  step: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#475569' },
  stepActive: { color: '#38bdf8', fontWeight: '600' },
  stepDone: { color: '#22c55e' },
  stepNum: {
    width: '20px', height: '20px', borderRadius: '50%',
    background: 'rgba(56,189,248,0.15)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: '11px', fontWeight: '700',
  },
  stepLine: { width: '32px', height: '1px', background: '#334155' },
  error: {
    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
    color: '#fca5a5', borderRadius: '8px', padding: '10px 14px',
    fontSize: '13px', marginBottom: '16px',
  },
  info: {
    background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
    color: '#86efac', borderRadius: '8px', padding: '10px 14px',
    fontSize: '13px', marginBottom: '16px',
  },
  form:  { display: 'flex', flexDirection: 'column', gap: '14px' },
  label: { fontSize: '13px', color: '#94a3b8', fontWeight: '500' },
  input: {
    background: '#0f172a', border: '1px solid #334155', borderRadius: '8px',
    color: '#f1f5f9', padding: '12px 14px', fontSize: '16px', outline: 'none',
    transition: 'border-color .2s',
  },
  captchaRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  captchaImage: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f1f5f9', border: '1px solid #334155', borderRadius: '8px',
    height: '52px', overflow: 'hidden',
  },
  captchaRefresh: {
    flex: 'none', width: '42px', height: '42px', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: '#0f172a', border: '1px solid #334155', borderRadius: '8px',
    color: '#94a3b8', cursor: 'pointer',
  },
  btn: {
    background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
    color: '#fff', border: 'none', borderRadius: '8px',
    padding: '12px', fontSize: '15px', fontWeight: '600',
    cursor: 'pointer', marginTop: '4px',
  },
  linkBtn: {
    background: 'none', border: 'none', color: '#64748b',
    fontSize: '13px', cursor: 'pointer', padding: '4px 0',
  },
  footer: { textAlign: 'center', fontSize: '11px', color: '#334155', marginTop: '24px' },
};
