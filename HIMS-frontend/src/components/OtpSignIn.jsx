import { useState } from 'react';
import DOMPurify from 'dompurify';
import { useCaptcha } from '../hooks/useCaptcha';

const API_BASE = import.meta.env.VITE_API_URL || '';

const post = async (url, body) => {
  const r = await fetch(`${API_BASE}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok && d.success !== false, status: r.status, ...d };
};

/**
 * Mobile number + captcha → 6-digit code → signed in. Used by the patient portal and the clinician
 * portal (tender #41, #48). `onSuccess(data)` receives the server's sign-in response.
 */
export default function OtpSignIn({ requestUrl, verifyUrl, onSuccess, phoneLabel = 'Mobile number', hint }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const { svg, captchaId, refresh, applyCaptcha, captchaEnabled } = useCaptcha();

  const send = async (e) => {
    e?.preventDefault();
    setError(''); setInfo('');
    if (!/^\d{10}$/.test(phone.replace(/\D/g, '').slice(-10)) || phone.replace(/\D/g, '').length < 10) { setError('Enter a valid 10-digit mobile number.'); return; }
    if (captchaEnabled && !captchaText) { setError('Please enter the captcha text.'); return; }
    setBusy(true);
    const d = await post(requestUrl, { phone, captchaId, captchaText });
    setBusy(false);
    setCaptchaText('');
    if (!d.ok) { setError(d.message || 'Could not send the code.'); applyCaptcha(d.captcha); return; }
    setInfo(d.dev_code ? `${d.message} (development code: ${d.dev_code})` : d.message);
    setStep('code');
  };

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code.trim())) { setError('Enter the 6-digit code.'); return; }
    setBusy(true);
    const d = await post(verifyUrl, { phone, code: code.trim() });
    setBusy(false);
    if (!d.ok) { setError(d.message || 'That code did not work.'); return; }
    onSuccess(d);
  };

  return (
    <>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {info && !error && <div className="alert" role="status" style={{ background: '#ecfdf5', color: '#065f46', padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 14 }}>{info}</div>}

      {step === 'phone' ? (
        <form className="auth-form" onSubmit={send} noValidate>
          <div className="field-group has-value">
            <label htmlFor="otp-phone" className="field-label">{phoneLabel}</label>
            <div className="input-wrapper">
              <input id="otp-phone" type="tel" inputMode="numeric" autoComplete="tel" value={phone} onChange={(e) => { setError(''); setPhone(e.target.value); }} placeholder="10-digit mobile number" required />
            </div>
          </div>
          {hint && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>{hint}</p>}
          {captchaEnabled && (
          <div className="form-group">
            <label className="field-label">Captcha</label>
            <div className="captcha-row">
              <div className="captcha-image" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }) }} />
              <button type="button" className="captcha-refresh" onClick={() => { setCaptchaText(''); refresh(); }} aria-label="Refresh captcha" title="Refresh captcha">↻</button>
            </div>
            <input type="text" className="field-input" placeholder="Enter the text shown above" value={captchaText} onChange={(e) => setCaptchaText(e.target.value)} autoComplete="off" required />
          </div>
          )}
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={verify} noValidate>
          <div className="field-group has-value">
            <label htmlFor="otp-code" className="field-label">6-digit code sent to {phone}</label>
            <div className="input-wrapper">
              <input id="otp-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => { setError(''); setCode(e.target.value.replace(/\D/g, '')); }} placeholder="______" autoFocus required />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Verify and sign in'}</button>
          <button type="button" className="captcha-refresh" style={{ width: 'auto', margin: '12px auto 0', display: 'block', padding: '6px 10px' }}
            onClick={() => { setStep('phone'); setCode(''); setInfo(''); refresh(); }}>Use a different number or ask for a new code</button>
        </form>
      )}
    </>
  );
}
