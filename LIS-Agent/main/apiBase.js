// Single source of truth for the HIMS-backend base URL used by the Electron main process.
// Override via the LIS_API_BASE_URL environment variable for non-production deployments.
const PRODUCTION_API_BASE = 'https://ka-lims.poxiatechnologies.com';
const rawBase = process.env.LIS_API_BASE_URL || PRODUCTION_API_BASE;

function resolve(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`Invalid LIS_API_BASE_URL "${url}" — falling back to ${PRODUCTION_API_BASE}`);
    return PRODUCTION_API_BASE;
  }

  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol === 'http:' && !isLoopback) {
    console.error(`Refusing plaintext HTTP for non-loopback backend "${url}" — credentials and patient data must not travel unencrypted. Upgrading to https.`);
    parsed.protocol = 'https:';
    return parsed.toString().replace(/\/$/, '');
  }
  return url;
}

module.exports = { API_BASE: resolve(rawBase) };
