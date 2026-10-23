const fs = require('fs');
const path = require('path');

// Settings kept on the doctor's PC (userData/config.json). Nothing secret is
// stored here — in particular never a PIN.
let dir = null;
let current = null;

const defaults = (isPackaged) => {
  const servers = ['https://ka-lims.poxiatechnologies.com'];
  // Running from source (development): the local LIMS as well.
  if (!isPackaged) servers.push('http://localhost:7005', 'http://localhost:5716');
  return {
    port: 8765,
    // API servers the agent will fetch signing requests from.
    allowedServers: servers,
    // Web pages (LIMS) allowed to ask this agent to sign.
    allowedOrigins: [...servers],
    // Extra PKCS#11 driver files, beyond the ones found automatically.
    pkcs11Libraries: [],
    // How long the token stays unlocked after a signing, so several reports can be
    // signed without retyping the PIN (0 = ask every time).
    sessionIdleSeconds: 120,
    launchAtLogin: false,
    // Developer test only: sign with a .p12 file instead of a token (its password is the "PIN").
    devP12Path: '',
  };
};

const origin = (u) => { try { return new URL(String(u).trim()).origin; } catch { return null; } };

function init(userDataDir, isPackaged) {
  dir = userDataDir;
  const base = defaults(isPackaged);
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch { /* first run */ }
  current = { ...base, ...saved };
  return current;
}

const get = () => current;

function save(patch) {
  const next = { ...current };
  if (patch.port !== undefined) {
    const p = Number(patch.port);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error('The port must be a number between 1024 and 65535.');
    next.port = p;
  }
  for (const key of ['allowedServers', 'allowedOrigins']) {
    if (patch[key] !== undefined) {
      const list = (Array.isArray(patch[key]) ? patch[key] : String(patch[key]).split(/[\s,]+/)).map(origin).filter(Boolean);
      if (!list.length) throw new Error(`Add at least one address under ${key === 'allowedServers' ? 'LIMS servers' : 'LIMS web pages'}.`);
      next[key] = [...new Set(list)];
    }
  }
  if (patch.pkcs11Libraries !== undefined) {
    next.pkcs11Libraries = (Array.isArray(patch.pkcs11Libraries) ? patch.pkcs11Libraries : String(patch.pkcs11Libraries).split(/\r?\n/)).map((s) => s.trim()).filter(Boolean);
  }
  if (patch.sessionIdleSeconds !== undefined) {
    const n = Number(patch.sessionIdleSeconds);
    if (!Number.isFinite(n) || n < 0 || n > 900) throw new Error('Keep the token unlocked for between 0 and 900 seconds.');
    next.sessionIdleSeconds = Math.round(n);
  }
  if (patch.launchAtLogin !== undefined) next.launchAtLogin = !!patch.launchAtLogin;
  if (patch.devP12Path !== undefined) next.devP12Path = String(patch.devP12Path || '').trim();
  current = next;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(current, null, 2));
  return current;
}

module.exports = { init, get, save, origin };
