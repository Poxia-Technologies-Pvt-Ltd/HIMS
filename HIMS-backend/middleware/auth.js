import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { verifyAndRotateCsrfToken } from '../utils/csrfStore.js';
import db from '../config/db.js';

// Maps legacy DB role slugs → canonical display names used in route guards
const ROLE_ALIASES = {
  'admin':        'Admin',
  'lab_tech':     'Lab Technician',
  'lab_doctor':   'Lab Head',
  'lab doctor':   'Lab Head',
  'receptionist': 'Receptionist',
  'phlebotomist': 'Phlebotomist',
};

export const normalizeRole = (role = '') =>
  ROLE_ALIASES[role.toLowerCase()] ?? role;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// LIS-Agent machines authenticate with a permanent per-machine device key
// instead of a human staff session — see controllers/deviceKeyController.js.
// A normal JWT expires by design (a human is expected to log back in); a
// lab PC running unattended for a shift was hitting that expiry and
// bouncing to a login screen with no one there to clear it. The device key
// has no expiry at all — only an explicit Admin revoke ends it — so this
// path is checked first and short-circuits the rest of the function
// (no JWT to decode, no CSRF to rotate — see the Bearer-token exemption
// note below, which applies here for the same reason: nothing a browser
// can attach automatically).
const hashDeviceKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

async function tryDeviceKeyAuth(req) {
  const deviceKey = req.headers['x-device-key'];
  if (!deviceKey) return false;

  const [[row]] = await db.query(
    `SELECT id, label, branch_id, role, status FROM device_api_keys WHERE key_hash = ? LIMIT 1`,
    [hashDeviceKey(deviceKey)]
  );
  if (!row || row.status !== 'Active') return false;

  db.query(
    `UPDATE device_api_keys SET last_used_at = NOW(), last_used_ip = ? WHERE id = ?`,
    [req.ip || null, row.id]
  ).catch((err) => console.error('Failed to update device_api_keys.last_used_at:', err.message));

  req.user = {
    role: row.role,
    branch_id: row.branch_id,
    device_key_id: row.id,
    device_label: row.label,
    isDeviceKey: true,
  };
  return true;
}

export const authenticateToken = async (req, res, next) => {
  if (await tryDeviceKeyAuth(req)) return next();

  // VAPT #9 (Cookie Header Not Implemented): the staff session token now
  // lives in an HttpOnly cookie set by authController.login, not in
  // localStorage — a page that reads it into a JS variable could hand it to
  // any XSS. The cookie takes priority; the Authorization header stays as a
  // fallback for non-browser API clients (Postman/scripts) that can't rely
  // on a cookie jar.
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1];
  const cookieToken = req.cookies?.hims_token;
  const token = cookieToken || headerToken;

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (error) {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }

  req.user = decoded;

  // CSRF only protects ambient (cookie-based) auth — a request can only be
  // forged cross-site if the browser attaches credentials on its own. A
  // Bearer token has to be deliberately attached by the caller (LIS-Agent's
  // Electron main process forwards the session as a Bearer header, not a
  // cookie, for its analyzer-event/save-test-results pipeline), which a
  // forged cross-site request can't do — so it's not a CSRF target and
  // doesn't carry/rotate a CSRF token.
  if (MUTATING_METHODS.has(req.method) && cookieToken) {
    const rotated = verifyAndRotateCsrfToken(decoded.sid, req.headers['x-csrf-token']);
    if (!rotated) {
      return res.status(403).json({ message: 'Invalid or missing CSRF token' });
    }
    res.setHeader('X-CSRF-Token', rotated);
  }

  next();
};

export const authorizeRole = (roles) => {
  return (req, res, next) => {
    const role = normalizeRole(req.user?.role);
    if (!req.user || !roles.includes(role)) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
};
