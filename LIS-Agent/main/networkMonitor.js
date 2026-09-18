// Actively tells the renderer whether the backend is reachable, and drives
// the retry queue the moment it comes back — rather than only finding out a
// push failed after the fact. Polls the backend's public health route
// (GET /, no auth, no device key needed) rather than trusting the OS's
// "connected to a network" signal, which says nothing about whether THIS
// backend is actually reachable (captive portals, VPN routing, the backend
// itself being down all look identical to the OS as "online").
const axios = require('./apiClient');
const { API_BASE } = require('./apiBase');

const POLL_MS = 15_000;
const CHECK_TIMEOUT_MS = 6_000;

let online = null; // null = not checked yet
let timer = null;
// A getter, not a captured window reference — see resultQueue.js's setWindow
// for why (the window is recreated on tray-restore).
let getWin = () => null;
let onStatusChange = null; // (online:boolean) => void, e.g. to trigger a retry sweep

async function checkOnce() {
  try {
    await axios.get(`${API_BASE}/`, { timeout: CHECK_TIMEOUT_MS });
    setOnline(true);
  } catch {
    setOnline(false);
  }
}

function setOnline(next) {
  const changed = online !== next;
  online = next;
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('network-status', { online });
  if (changed && next && onStatusChange) {
    // Coming back online is exactly the moment the retry queue matters —
    // nobody should have to remember to click Retry after a network blip.
    try { onStatusChange(online); } catch (e) { console.error('network-status handler failed:', e.message); }
  }
}

function start(windowGetter, onReconnect) {
  getWin = windowGetter;
  onStatusChange = onReconnect;
  checkOnce();
  timer = setInterval(checkOnce, POLL_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function isOnline() {
  return online;
}

module.exports = { start, stop, isOnline, checkOnce };
