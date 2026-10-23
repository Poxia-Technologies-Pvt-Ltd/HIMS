// Small fetch wrapper for the HMIS pages. The session cookie and CSRF token
// are attached by utils/csrfClient.js's global fetch interceptor.
const API_BASE = import.meta.env.VITE_API_URL || '';

export async function api(method, path, body) {
  const init = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    return { ok: false, status: 0, data: { message: 'Network error. Check your connection.' } };
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  return { ok: res.ok && data.success !== false, status: res.status, data };
}

export const get = (path) => api('GET', path);
export const post = (path, body) => api('POST', path, body ?? {});
export const put = (path, body) => api('PUT', path, body ?? {});
export const patch = (path, body) => api('PATCH', path, body ?? {});
export const del = (path) => api('DELETE', path);

// Opens a file the API streams (PDF, CSV) in a new tab, via a blob so the
// session cookie is sent.
export async function openFile(path, filename) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    let msg = 'Could not open the file';
    try { msg = (await res.json()).message || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  if (filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const currentUser = () => {
  try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
};
export const userRole = () => (localStorage.getItem('role') || currentUser().role || '').toLowerCase();
export const isCentral = () => (localStorage.getItem('role_level') || currentUser().role_level) === 'Central';
export const hasRole = (...roles) => roles.map((r) => r.toLowerCase()).includes(userRole());
export const isHrAdmin = () => hasRole('admin', 'super admin', 'hr manager');
export const isRosterPlanner = () => isHrAdmin() || hasRole('lab head', 'medical superintendent', 'nursing superintendent');
export const isFrontDesk = () => hasRole('admin', 'super admin', 'receptionist', 'medical superintendent');

// India-time date helpers (the browser may be in any zone).
const IST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export const todayIST = () => IST.format(new Date());
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const weekStart = (iso) => {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((day + 6) % 7)); // Monday
};
export const fmtDate = (iso, opts = { day: '2-digit', month: 'short', year: 'numeric' }) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' }) : '—';
export const weekdayShort = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
export const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const fullName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ');
export const timeHM = (dt) => (dt ? String(dt).slice(11, 16) || String(dt).slice(0, 5) : '—');
