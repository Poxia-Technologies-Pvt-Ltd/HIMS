// Small helpers shared by the quality, audit, delivery, equipment and
// data-export pages. The session cookie and CSRF token are attached by
// csrfClient.js's fetch interceptor; the Bearer header is the same fallback
// every other page sends.

export const API_BASE = import.meta.env.VITE_API_URL || '';

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}`, 'Content-Type': 'application/json' });

export async function api(path, { method = 'GET', body } = {}) {
  try {
    const r = await fetch(`${API_BASE}${path}`, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (d.success === undefined) d.success = r.ok;
    if (!d.success && !d.message) d.message = `Request failed (${r.status})`;
    return d;
  } catch {
    return { success: false, message: 'Could not reach the server.' };
  }
}

const saveBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Download an authenticated file (CSV export etc.) under its server-given name.
export async function download(path, fallbackName) {
  const r = await fetch(`${API_BASE}${path}`, { headers: headers() });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.message || `Download failed (${r.status})`);
  }
  const name = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || fallbackName;
  saveBlob(await r.blob(), name);
}

// Client-side CSV of rows already on screen. cols: [[header, row => value], ...]
export function saveCsv(name, rows, cols) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map(([h]) => cell(h)).join(','), ...rows.map((r) => cols.map(([, f]) => cell(f(r))).join(','))];
  saveBlob(new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), name);
}

export const role = () => (localStorage.getItem('role') || '').toLowerCase();
export const roleLevel = () => localStorage.getItem('role_level') || 'Branch';

const p2 = (n) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));

export const fmtDT = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// Minutes as "45m", "3h 10m" or "2d 4h".
export const fmtMin = (m) => {
  if (m == null || Number.isNaN(Number(m))) return '—';
  const v = Math.round(Number(m));
  if (v < 60) return `${v}m`;
  if (v < 1440) return `${Math.floor(v / 60)}h${v % 60 ? ` ${v % 60}m` : ''}`;
  return `${Math.floor(v / 1440)}d${Math.floor((v % 1440) / 60) ? ` ${Math.floor((v % 1440) / 60)}h` : ''}`;
};
export const fmtPct = (v) => (v == null ? '—' : `${v}%`);
