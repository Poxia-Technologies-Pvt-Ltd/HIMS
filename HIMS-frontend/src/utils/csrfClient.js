import axios from 'axios';
import { clearStaffSession } from './session.js';

// Transparently attaches the app's CSRF token to every mutating request and
// captures the server's rotated replacement from the response, without
// touching the ~50 individual pages that call fetch()/axios directly.
//
// The token is single-use with a sliding window of 2 on the server (see
// HIMS-backend/utils/csrfStore.js): each successful mutating request rotates
// the token, so this must run on every request/response pair to stay in
// sync, not just once at login.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Longest, most specific prefix wins. Patient portal has no mutating
// endpoints today, so it has no CSRF key here — nothing to attach or store.
const CSRF_KEYS_BY_PREFIX = [
  ['/api/dev/', 'dev_csrf'],
  ['/api/', 'hims_csrf'],
];

const csrfKeyForPath = (pathname) => {
  const match = CSRF_KEYS_BY_PREFIX.find(([prefix]) => pathname.startsWith(prefix));
  return match ? match[1] : null;
};

const csrfKeyForUrl = (url) => {
  try {
    return csrfKeyForPath(new URL(url, window.location.origin).pathname);
  } catch {
    return null;
  }
};

// VAPT #9: the staff session now lives in an HttpOnly cookie instead of a
// header built from localStorage, so it only reaches the API if the request
// opts in to sending credentials cross-origin — true for every /api/ call
// this app makes, never for arbitrary third-party fetches, so gate on that
// rather than flipping it on globally.
const isOwnApiPath = (pathname) => pathname.startsWith('/api/');

const installFetchInterceptor = () => {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const pathname = (() => { try { return new URL(url, window.location.origin).pathname; } catch { return ''; } })();
    const csrfKey = MUTATING_METHODS.has(method) ? csrfKeyForPath(pathname) : null;

    let finalInit = init;
    if (isOwnApiPath(pathname) && finalInit.credentials === undefined) {
      finalInit = { ...finalInit, credentials: 'include' };
    }
    if (csrfKey) {
      const token = localStorage.getItem(csrfKey);
      if (token) {
        finalInit = { ...finalInit, headers: { ...(finalInit.headers || {}), 'X-CSRF-Token': token } };
      }
    }

    const response = await originalFetch(input, finalInit);

    if (csrfKey) {
      const rotated = response.headers.get('X-CSRF-Token');
      if (rotated) localStorage.setItem(csrfKey, rotated);
    }

    return response;
  };
};

const installAxiosInterceptor = () => {
  axios.interceptors.request.use((config) => {
    const method = (config.method || 'get').toUpperCase();
    let pathname = '';
    try { pathname = new URL(axios.getUri(config), window.location.origin).pathname; } catch { /* relative/malformed URL, leave blank */ }
    if (isOwnApiPath(pathname) && config.withCredentials === undefined) {
      config.withCredentials = true;
    }
    if (MUTATING_METHODS.has(method)) {
      const csrfKey = csrfKeyForPath(pathname);
      const token = csrfKey && localStorage.getItem(csrfKey);
      if (token) config.headers['X-CSRF-Token'] = token;
    }
    return config;
  });

  const captureRotatedToken = (config, headers) => {
    const method = (config?.method || 'get').toUpperCase();
    if (!MUTATING_METHODS.has(method)) return;
    const csrfKey = csrfKeyForUrl(axios.getUri(config));
    const rotated = headers?.['x-csrf-token'];
    if (csrfKey && rotated) localStorage.setItem(csrfKey, rotated);
  };

  axios.interceptors.response.use(
    (response) => {
      captureRotatedToken(response.config, response.headers);
      return response;
    },
    (error) => {
      // The token rotates on every mutating request regardless of whether
      // the route returns 2xx or a business-logic error (400/403/404/...)
      // — unlike fetch, axios rejects on any non-2xx, so without this
      // branch the rotation from an error response was silently dropped,
      // desyncing the shared CSRF key in localStorage for every other
      // caller (including the fetch-based ones) until the next login.
      if (error.response) captureRotatedToken(error.config, error.response.headers);
      return Promise.reject(error);
    }
  );
};

// ── Expired-session handling ────────────────────────────────────────────────
// Without this, a request made after the session expired surfaced the raw
// backend string ("Invalid or expired token") wherever that page happened to
// render errors, leaving the user stuck on a screen that would never work
// again until they manually cleared storage. Any 401 now means one thing —
// the session is gone — so clear it and send them to the login page with an
// explanation.
//
// 403 is deliberately NOT treated this way: it is also returned for
// legitimate permission denials ("Access denied. Insufficient permissions.")
// and for CSRF failures, none of which should throw the user out.
const LOGIN_PATH = '/';

// Endpoints that legitimately 401 for a user who simply isn't signed in yet.
// Treating those as "your session expired" is how the login screen ended up
// in a reload loop: a 401 here triggered a reload, the guard flag reset with
// the new page, the request fired again — and the captcha never rendered.
const PRE_AUTH_PATHS = ['/api/auth/captcha', '/api/auth/login', '/api/auth/forgot-password',
  '/api/auth/reset-password', '/api/dev/login', '/api/patients/portal/login'];

const isSessionExpiredResponse = (status, pathname) =>
  status === 401 &&
  pathname.startsWith('/api/') &&
  !PRE_AUTH_PATHS.some((p) => pathname.startsWith(p));

const handleSessionExpired = () => {
  // Guard against a burst of parallel requests all 401-ing and each trying to
  // redirect — the first one wins, the rest are no-ops.
  if (window.__sessionExpiredHandled) return;
  window.__sessionExpiredHandled = true;

  try {
    sessionStorage.setItem('logout_reason', 'expired');
  } catch { /* storage unavailable — redirect still happens */ }

  try {
    clearStaffSession();
  } catch { /* clearing is best-effort; the redirect below still happens */ }

  // Already on the login screen: there is nowhere to send them, and reloading
  // here is actively harmful — the guard flag above lives on `window`, so a
  // reload clears it and the next 401 reloads again, forever. Just leave them
  // on the form.
  if (window.location.pathname === LOGIN_PATH) return;

  // Full assignment rather than react-router navigate(): this module lives
  // outside the router tree and has no access to its history object.
  window.location.assign(LOGIN_PATH);
};

const installSessionExpiryHandlers = () => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    let pathname = '';
    try { pathname = new URL(url, window.location.origin).pathname; } catch { /* ignore */ }
    if (isSessionExpiredResponse(response.status, pathname)) handleSessionExpired();
    return response;
  };

  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      let pathname = '';
      try { pathname = new URL(axios.getUri(error.config || {}), window.location.origin).pathname; } catch { /* ignore */ }
      if (isSessionExpiredResponse(error.response?.status, pathname)) handleSessionExpired();
      return Promise.reject(error);
    }
  );
};

installFetchInterceptor();
installAxiosInterceptor();
// Must come after the CSRF interceptors so it wraps them: the rotated token
// still gets captured from the response before this decides to redirect.
installSessionExpiryHandlers();
