import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// VAPT #7 asked for a bounded inactivity window. 30 minutes proved far too
// short for real lab work, and 2 hours still caught staff out: a technician
// running a long analyzer batch, or a lab that goes quiet over a shift break,
// would come back to a logged-out screen mid-task.
//
// 8 hours covers a full working shift, which is the unit of time this app is
// actually used in. The window still exists — an unattended machine does not
// stay signed in overnight — but it no longer interrupts anybody's day.
const IDLE_LIMIT_MS = 8 * 60 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'];

// Logs the user out (and clears their session) after the inactivity window
// above with no mouse/keyboard/touch activity, regardless of whether the tab
// is open.
export function useIdleLogout(clearSession, redirectTo = '/') {
  const navigate = useNavigate();
  const timerRef = useRef(null);

  useEffect(() => {
    const logout = () => {
      clearSession();
      // Tells the login screen why the user landed there, so it can explain
      // ("you were logged out") instead of leaving them to guess. sessionStorage
      // rather than localStorage: it must not survive into a new tab or a
      // later visit and show a stale banner.
      try {
        sessionStorage.setItem('logout_reason', 'idle');
      } catch { /* private mode / storage disabled — banner is optional */ }
      navigate(redirectTo, { replace: true });
    };

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(logout, IDLE_LIMIT_MS);
    };

    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, resetTimer));
    resetTimer();

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
