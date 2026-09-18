// Persists the LIS-Agent's permanent device API key on disk, encrypted with
// the OS's own credential store (Windows DPAPI / macOS Keychain / Linux
// Secret Service) via Electron's safeStorage — this key is a standing
// credential with Lab Technician-level backend access and no expiry, so it
// gets the same at-rest protection a saved browser password would, not a
// plain JSON config file next to it.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const keyFilePath = () => path.join(app.getPath('userData'), 'device-key.enc');

function getDeviceKey() {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('safeStorage encryption is unavailable on this machine — device key cannot be read.');
      return null;
    }
    const filePath = keyFilePath();
    if (!fs.existsSync(filePath)) return null;
    const encrypted = fs.readFileSync(filePath);
    return safeStorage.decryptString(encrypted);
  } catch (err) {
    console.error('Failed to read stored device key:', err.message);
    return null;
  }
}

function setDeviceKey(plainKey) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level encryption is unavailable on this machine — cannot store the device key securely.');
  }
  const encrypted = safeStorage.encryptString(plainKey);
  fs.writeFileSync(keyFilePath(), encrypted, { mode: 0o600 });
}

function clearDeviceKey() {
  try {
    const filePath = keyFilePath();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Failed to clear stored device key:', err.message);
  }
}

module.exports = { getDeviceKey, setDeviceKey, clearDeviceKey };
