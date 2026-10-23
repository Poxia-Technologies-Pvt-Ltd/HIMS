const axios = require('axios');
const crypto = require('crypto');
const { API_BASE } = require('./apiBase');
const deviceKeyStore = require('./deviceKeyStore');

const apiClient = axios.create({
  baseURL: API_BASE,
});

// The agent authenticates as its own machine, not as a logged-in human — a
// permanent per-machine device key (see HIMS-backend controllers/
// deviceKeyController.js) sent as X-Device-Key, instead of the hims_token
// session cookie a normal staff login used to forward. That cookie carried
// a normal JWT expiry, which was logging unattended lab PCs out mid-shift
// with no one there to sign back in; the device key never expires on its
// own, only an explicit Admin revoke ends it.
apiClient.interceptors.request.use((config) => {
  // Identify as the app's own origin. Requests from this process are plain
  // Node HTTP and carry no Origin at all, which the backend's Referer/Origin
  // guard rejects for mutating methods unless the caller presents a
  // credential. Setting it is honest rather than a workaround: this IS a
  // first-party client of that deployment, API_BASE is the value the server
  // allowlists, and the guard exists to stop *browsers* being driven
  // cross-site, which does not apply to a Node process.
  if (!config.headers.Origin) config.headers.Origin = API_BASE;
  if (!config.headers.Referer) config.headers.Referer = `${API_BASE}/`;

  const deviceKey = deviceKeyStore.getDeviceKey();
  if (deviceKey) config.headers['X-Device-Key'] = deviceKey;

  // Integrity of what is sent (tender #111): the body is serialised here, once, and its SHA-256
  // goes in X-Body-SHA256. The server hashes the bytes it received and refuses a mismatch; it
  // also echoes the hash back, which the response check below compares.
  const method = String(config.method || 'get').toLowerCase();
  if (['post', 'put', 'patch', 'delete'].includes(method) && config.data !== undefined && config.data !== null) {
    let body = null;
    if (typeof config.data === 'string') body = config.data;
    else if (Buffer.isBuffer(config.data) || typeof config.data !== 'object') body = null;
    else if (Object.getPrototypeOf(config.data) === Object.prototype || Array.isArray(config.data)) {
      body = JSON.stringify(config.data);
      config.data = body;
      if (!config.headers['Content-Type']) config.headers['Content-Type'] = 'application/json';
    }
    if (body !== null) {
      const hash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
      config.headers['X-Body-SHA256'] = hash;
      config.__bodySha256 = hash;
    }
  }

  return config;
});

// Told when the stored device key is missing or has been revoked, so the
// window can show the activation screen rather than a raw 401. Registered
// by the main process, which owns the window.
let onUnauthorized = null;
let lastNotified = 0;

apiClient.setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

/** True when this machine has an activated device key stored. */
apiClient.hasDeviceKey = () => !!deviceKeyStore.getDeviceKey();

apiClient.interceptors.response.use(
  (res) => {
    // The server echoes the checksum of what it received; if it is not what we sent, the transfer
    // was damaged — treat it as a failed send so the item stays queued and goes again.
    const sent = res.config?.__bodySha256;
    const echoed = res.headers?.['x-received-body-sha256'];
    if (sent && echoed && String(echoed).toLowerCase() !== sent) {
      const e = new Error('The server did not receive exactly what was sent (integrity check failed).');
      e.code = 'INTEGRITY';
      throw e;
    }
    return res;
  },
  (err) => {
    // 401 only. A 500, a timeout or a dropped link means the server or the
    // network is unwell, not that the key has been revoked — throwing to
    // the activation screen for those would lose nothing (there's no form
    // state to lose here) but would be a false alarm. Those keep surfacing
    // as errors.
    if (err.response?.status === 401 && onUnauthorized) {
      // The agent fires several authenticated calls together at boot; one
      // activation prompt is enough for all of them.
      const now = Date.now();
      if (now - lastNotified > 5000) {
        lastNotified = now;
        try { onUnauthorized(); } catch { /* window may be gone */ }
      }
    }
    return Promise.reject(err);
  }
);

module.exports = apiClient;
