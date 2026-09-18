const axios = require('axios');
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
  (res) => res,
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
