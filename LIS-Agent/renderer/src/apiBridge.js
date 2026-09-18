// Routes the renderer's backend calls through the Electron main process.
//
// A packaged app loads from file://, so anything it fetches cross-origin
// carries `Origin: null` — which the backend rejects in cors() and again in
// the Referer/Origin guard. Rather than weakening those server-side (a `null`
// origin is also what sandboxed iframes on any site send), calls are proxied
// through main, which talks to the API as a plain Node client: no Origin
// header, no CORS, and the session travels as a Bearer token that main reads
// from the HttpOnly cookie.
//
// Installed as an axios *adapter* rather than rewritten at ~20 call sites, so
// every existing `axios.get(...)` / `axios.post(...)` keeps working as-is.
import axios from 'axios';
import { API_BASE } from './apiBase';

const bridge = () =>
  (typeof window !== 'undefined' && window.electronAPI?.apiRequest) || null;

export const isBridgeAvailable = () => Boolean(bridge());

// Join baseURL + url the way axios would, and leave absolute URLs untouched.
function resolveUrl(config) {
  const url = config.url || '';
  if (/^https?:\/\//i.test(url)) return url;
  const base = (config.baseURL || API_BASE || '').replace(/\/+$/, '');
  return `${base}/${url.replace(/^\/+/, '')}`;
}

// axios needs headers as a plain object; v1 may hand us an AxiosHeaders.
function plainHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.toJSON === 'function') return headers.toJSON();
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && v !== null && typeof v !== 'object') out[k] = v;
  }
  return out;
}

export const ipcAdapter = async (config) => {
  const res = await bridge()({
    method: (config.method || 'get').toUpperCase(),
    url: resolveUrl(config),
    // axios has usually serialised the body to a JSON string by this point;
    // hand main the object so it can re-serialise cleanly.
    data: typeof config.data === 'string' ? safeParse(config.data) : config.data,
    params: config.params,
    headers: plainHeaders(config.headers),
  });

  const response = {
    data: res.data,
    status: res.status,
    statusText: String(res.status),
    headers: res.headers || {},
    config,
    request: null,
  };

  // Preserve axios semantics: reject on non-2xx so existing try/catch and the
  // 401/403 response interceptor keep behaving identically.
  if (!res.ok) {
    const err = new Error(
      res.data?.message || `Request failed with status code ${res.status}`);
    err.response = response;
    err.config = config;
    err.isAxiosError = true;
    throw err;
  }
  return response;
};

function safeParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

// Minimal fetch replacement for the few places using fetch() directly
// (useCaptcha, Login). Only the surface those call sites actually use.
export async function bridgeFetch(url, options = {}) {
  const res = await bridge()({
    method: (options.method || 'GET').toUpperCase(),
    url: /^https?:\/\//i.test(url) ? url : `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`,
    data: typeof options.body === 'string' ? safeParse(options.body) : options.body,
    headers: options.headers || {},
  });

  return {
    ok: res.ok,
    status: res.status,
    headers: { get: (name) => res.headers?.[String(name).toLowerCase()] ?? null },
    json: async () => res.data,
    text: async () => (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
  };
}

// Called once at startup. In a browser (vite dev in a normal tab) there is no
// bridge, so this is a no-op and the app keeps using real axios/fetch.
export function installApiBridge() {
  if (!isBridgeAvailable()) {
    console.warn('[apiBridge] electronAPI.apiRequest unavailable — using direct network calls');
    return false;
  }
  axios.defaults.adapter = ipcAdapter;
  // withCredentials is meaningless over IPC and misleading if left on: the
  // session is attached by main as a Bearer header, not by the page.
  axios.defaults.withCredentials = false;
  if (typeof window !== 'undefined') window.fetch = bridgeFetch;
  console.log('[apiBridge] backend calls routed through main process');
  return true;
}
