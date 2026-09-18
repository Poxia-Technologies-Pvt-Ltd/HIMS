// Central place for clearing auth state so logout actually invalidates the
// session (VAPT: Direct URL Access / Browser Refresh Attack) instead of
// leaving hims_csrf et al. behind for the next Back-button press or a
// bookmarked deep link to reuse.
//
// VAPT #9: the staff session token itself is an HttpOnly cookie set by the
// backend (authController.login) — it was never in localStorage as
// `hims_token` to begin with, so there's nothing to clear here for it.
// `hims_authed` is a non-sensitive UI flag only ("was the last login call
// successful"); it grants no access on its own — every request is still
// authorized server-side by the cookie via authenticateToken.

const STAFF_KEYS = [
  'hims_authed', 'hims_csrf', 'user_id', 'branch_id', 'hospital_code',
  'role_level', 'role', 'district_id', 'user', 'password_change_required',
];
// VAPT #9: dev_token used to hold the raw developer JWT in localStorage;
// the session now lives in an httpOnly cookie set by developerController
// (mirrors hims_token above), so only the CSRF token is left to clear here.
// dev_authed mirrors hims_authed — a non-sensitive UI flag (VAPT #4/#5:
// Direct URL Access / Browser Refresh Attack) so DeveloperPanel's bfcache
// pageshow check has something synchronous to read, without needing a round
// trip to re-verify the httpOnly cookie on every back-button restore.
const DEVELOPER_KEYS = ['dev_csrf', 'dev_authed'];
const PATIENT_KEYS = ['patient_token', 'patient_data'];

// Best-effort: also clears the HttpOnly cookie server-side so a stolen
// device (or the next Back-button press before the cookie's own maxAge
// expires) can't keep riding a "logged out" localStorage state that never
// actually revoked the session. Fire-and-forget — callers here are sync UI
// handlers (idle-timeout, sidebar logout button) that shouldn't block on it.
const revokeStaffCookie = () => {
  const API_BASE = import.meta.env.VITE_API_URL || '';
  fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
};

const revokeDeveloperCookie = () => {
  const API_BASE = import.meta.env.VITE_API_URL || '';
  fetch(`${API_BASE}/api/dev/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
};

export const clearStaffSession = () => {
  STAFF_KEYS.forEach(k => localStorage.removeItem(k));
  revokeStaffCookie();
};
export const clearDeveloperSession = () => {
  DEVELOPER_KEYS.forEach(k => localStorage.removeItem(k));
  revokeDeveloperCookie();
};
export const clearPatientSession = () => PATIENT_KEYS.forEach(k => localStorage.removeItem(k));

export const hasStaffToken = () => localStorage.getItem('hims_authed') === '1';
export const hasDeveloperToken = () => localStorage.getItem('dev_authed') === '1';
export const hasPatientToken = () => !!localStorage.getItem('patient_token');
