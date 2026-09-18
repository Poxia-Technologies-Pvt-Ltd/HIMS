import { useState, useCallback, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Fetches a one-time captcha (id + inline SVG markup) from the backend.
// Each captcha is consumed by the server on the first verify attempt
// (success or failure), so callers must call refresh() after every submit.
export function useCaptcha() {
  const [svg, setSvg] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  // Starts true: the mount effect below fetches immediately, and the initial
  // value must be set synchronously (not from inside the effect) to satisfy
  // react-hooks/set-state-in-effect.
  const [loadingCaptcha, setLoadingCaptcha] = useState(true);

  const refresh = useCallback(async () => {
    setLoadingCaptcha(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/captcha`);
      const data = await res.json();
      setSvg(data.svg || '');
      setCaptchaId(data.captchaId || '');
    } catch {
      setSvg('');
      setCaptchaId('');
    } finally {
      setLoadingCaptcha(false);
    }
  }, []);

  // Failed-auth responses bundle a freshly generated captcha (the old one is
  // consumed server-side on every verify attempt, win or lose) — apply it
  // directly instead of firing a second request. Falls back to a fetch if
  // the response didn't include one (e.g. a network-level failure).
  const applyCaptcha = useCallback((captcha) => {
    if (captcha?.captchaId && captcha?.svg) {
      setCaptchaId(captcha.captchaId);
      setSvg(captcha.svg);
    } else {
      refresh();
    }
  }, [refresh]);

  // Inlined rather than calling refresh() directly, so state updates happen
  // inside the async continuation instead of synchronously in the effect body.
  useEffect(() => {
    let ignore = false;
    fetch(`${API_BASE}/api/auth/captcha`)
      .then(res => res.json())
      .then(data => {
        if (ignore) return;
        setSvg(data.svg || '');
        setCaptchaId(data.captchaId || '');
      })
      .catch(() => {
        if (ignore) return;
        setSvg('');
        setCaptchaId('');
      })
      .finally(() => {
        if (!ignore) setLoadingCaptcha(false);
      });
    return () => { ignore = true; };
  }, []);

  return { svg, captchaId, refresh, applyCaptcha, loadingCaptcha };
}
