import React from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import App from "./App";
import "./assets/CSS/theme.css";
import { installApiBridge } from "./apiBridge";

// Must run before any component issues a request. Routes backend calls through
// the main process, which reaches the API without an Origin header — a
// packaged app loads from file:// and would otherwise send `Origin: null`,
// which the backend rejects. No-op outside Electron.
const bridged = installApiBridge();

// The backend session lives only in an HttpOnly `hims_token` cookie (VAPT #9 —
// it's never returned in the login JSON body, so there's no token here for a
// request interceptor to attach as a Bearer header) — every request just
// needs the cookie itself sent along.
//
// Only when NOT bridged: over IPC the page issues no network request at all,
// so credentials mode is meaningless — main attaches the session itself,
// reading the same HttpOnly cookie through Electron's session API.
if (!bridged) axios.defaults.withCredentials = true;

const MUTATING_METHODS = new Set(["post", "put", "patch", "delete"]);

// Every mutating request (POST/PUT/PATCH/DELETE) is required by the backend
// (middleware/auth.js authenticateToken) to carry the CSRF token issued at
// login as an X-CSRF-Token header — cookie-based auth alone isn't enough.
// Login.jsx stores the initial token from the login response body; from then
// on it's single-use and rotates on every mutating request, so it has to be
// both attached here AND re-captured from each response below, or the very
// next mutating call fails with "Invalid or missing CSRF token".
axios.interceptors.request.use((config) => {
  if (MUTATING_METHODS.has((config.method || "").toLowerCase())) {
    const token = localStorage.getItem("csrf_token");
    if (token) config.headers["X-CSRF-Token"] = token;
  }
  return config;
});

// The agent NEVER logs itself out — not on 401, not on 403.
//
// It is a background service: it listens to analyzers around the clock and
// pushes results to the server, usually with nobody at the keyboard. Clearing
// the session and bouncing to a login screen would leave a machine sitting on
// a login form instead of doing its job, and whoever walks up next has no idea
// when or why it stopped. Auth failures are logged for remote diagnosis and
// otherwise ignored; the sidebar Logout button remains for a deliberate
// sign-out.
//
// (The web app does the opposite — see HIMS-frontend/src/utils/csrfClient.js —
// because that is a shared browser session a person is actively using.)
axios.interceptors.response.use(
  (response) => {
    const rotated = response.headers?.["x-csrf-token"];
    if (rotated) localStorage.setItem("csrf_token", rotated);
    return response;
  },
  (error) => {
    // The CSRF token rotates on every mutating request regardless of
    // whether the route itself returns 2xx or a business-logic error (404,
    // 400, ...) — the rotation only ever gets skipped on the interceptor's
    // success branch above. Missing it here left the stored token stale
    // after the very next such error, and since the backend only accepts a
    // sliding window of 2 tokens (current + previous), a couple of
    // back-to-back non-2xx responses were enough to burn through the
    // window and produce a hard "Invalid or missing CSRF token" 403.
    const rotated = error.response?.headers?.["x-csrf-token"];
    if (rotated) localStorage.setItem("csrf_token", rotated);

    // Logged only. See the note above: an auth failure must never take this
    // machine off the air.
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      console.warn(
        `[auth] ${status} from ${error.config?.url || 'API'} — session left as-is; ` +
        `use the Logout button in the sidebar if you need to sign in again.`
      );
    }
    return Promise.reject(error);
  }
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);