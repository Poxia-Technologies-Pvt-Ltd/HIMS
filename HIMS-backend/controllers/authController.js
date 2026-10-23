import bcrypt from 'bcryptjs';
import { ROLE_PORTALS, portalAccepts } from '../utils/rolePortals.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../config/db.js';
import { createCaptcha, verifyCaptcha, captchaEnabled } from '../utils/captchaStore.js';
import { issueCsrfToken } from '../utils/csrfStore.js';
import { getBlockedUntil, recordLoginFailure, recordLoginSuccess } from '../utils/bruteForceGuard.js';
import { createResetToken, consumeResetToken } from '../utils/passwordResetStore.js';
import { FRONTEND_URL } from '../config/frontendUrl.js';
import { sendPasswordResetEmail } from '../services/emailService.js';
import { passwordProblem, passwordExpired, PASSWORD_MAX_AGE_DAYS } from '../utils/passwordPolicy.js';

// Every JWT gets its own random `sid` (one per login, not per user) so the
// CSRF token store — keyed by sid — gives each login/tab an independent
// token lifecycle instead of racing with other sessions for the same user.
const generateToken = (id, role, branch_id, role_level) => {
  const sid = crypto.randomUUID();
  const token = jwt.sign({ id, role, branch_id, role_level, sid }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
  return { token, csrfToken: issueCsrfToken(sid) };
};

// VAPT #9 (Cookie Header Not Implemented): the session token lives only in
// an HttpOnly cookie now — never in a JS-readable response field or
// localStorage — so an XSS on any page can no longer read it out. Secure is
// forced in production (the only environment actually served over HTTPS);
// SameSite=None is required for it to survive the frontend/API being on
// different origins there. COOKIE_DOMAIN is optional — omitting Domain
// makes the cookie host-only, which is already the most restrictive scope,
// so it's only needed if the API and frontend share a parent domain and the
// cookie must be sent to both.
const isProd = process.env.NODE_ENV === 'production';
const AUTH_COOKIE_NAME = 'hims_token';
const authCookieOptions = () => ({
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000, // matches the JWT's 30d expiry
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
});

// Logins are created from Employee Management (employeeController.createLogin),
// never self-registered, so there is no register endpoint.

export const getCaptcha = (req, res) => {
  const { captchaId, svg, disabled } = createCaptcha();
  res.json({ captchaId, svg, disabled: !!disabled });
};

// Sets the session cookie and returns what the frontend keeps about the user.
// `user` is a users row joined with its branch (hospital_code, district_id, branch_name).
const sendSession = (res, user, extra = {}) => {
  const { token, csrfToken } = generateToken(user.id, user.role, user.branch_id, user.role_level);
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
  res.json({
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: user.role,
    branch_id: user.branch_id,
    role_level: user.role_level,
    hospital_code: user.hospital_code,
    district_id: user.district_id,
    branch_name: user.branch_name,
    passwordChangeRequired: !extra.quickAccess && (!!user.password_change_required || passwordExpired(user.password_changed_at)),
    passwordExpired: passwordExpired(user.password_changed_at),
    passwordMaxAgeDays: PASSWORD_MAX_AGE_DAYS,
    csrfToken,
    ...extra,
  });
};

// ── Temporary access (QUICK_ACCESS=true) ─────────────────────────────────────
// For setting the system up and trying it out: the start page opens a
// session for a role without an ID or password. Anyone who can reach the
// site can then act as that role, so it is off unless the backend .env sets
// QUICK_ACCESS=true, and must stay off on a live hospital deployment.
export const quickAccessEnabled = () => process.env.QUICK_ACCESS === 'true';

const QUICK_USER_SQL = `
  SELECT u.*, b.hospital_code, b.district_id, b.branch_name
    FROM users u LEFT JOIN branches b ON u.branch_id = b.id
   WHERE u.is_active = 1 AND u.role IN (?)
   ORDER BY u.id LIMIT 1`;

// GET /api/auth/config — what the sign-in pages should offer.
export const authConfig = async (req, res) => {
  try {
    const out = { captcha: captchaEnabled(), quickAccess: quickAccessEnabled(), portals: {} };
    if (out.quickAccess) {
      // Which account each role's session would open as, so the start page can say so.
      for (const [id, p] of Object.entries(ROLE_PORTALS)) {
        const [[u]] = await db.query(QUICK_USER_SQL, [p.roles]);
        out.portals[id] = u ? { name: `${u.first_name} ${u.last_name}`.trim(), role: u.role } : null;
      }
    }
    res.json({ success: true, ...out });
  } catch (error) {
    console.error('authConfig error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/auth/quick-session { portal } — opens a session as that role's account.
export const quickSession = async (req, res) => {
  if (!quickAccessEnabled()) return res.status(404).json({ success: false, message: 'Not found' });
  try {
    const portal = ROLE_PORTALS[req.body?.portal];
    if (!portal) return res.status(400).json({ success: false, message: 'Choose a role' });
    const [[user]] = await db.query(QUICK_USER_SQL, [portal.roles]);
    if (!user) return res.status(404).json({ success: false, message: `There is no active ${portal.label} account yet. Create one in Employee Management.` });
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    console.warn(`[quick-access] ${portal.label} session opened as ${user.email} from ${req.ip}`);
    sendSession(res, user, { quickAccess: true });
  } catch (error) {
    console.error('quickSession error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const login = async (req, res) => {
  const { email, password, captchaId, captchaText } = req.body;
  const clientIp = req.ip;

  // Blocked IPs are rejected before touching the captcha at all — no point
  // burning a freshly-issued captcha on a request that can't succeed anyway.
  const blockedUntil = getBlockedUntil(clientIp);
  if (blockedUntil) {
    res.setHeader('Retry-After', Math.ceil((blockedUntil - Date.now()) / 1000));
    return res.status(429).json({
      message: 'Too many failed login attempts from this network. Try again in 24 hours.',
      blockedUntil: new Date(blockedUntil).toISOString(),
    });
  }

  // A wrong credential must never leave the previous CAPTCHA usable for a
  // retry, so every failure path below returns a freshly generated one.
  if (!verifyCaptcha(captchaId, captchaText)) {
    return res.status(400).json({ message: 'Invalid or expired captcha', captcha: createCaptcha() });
  }

  try {
    // The field accepts either an email address or a mobile number — staff on
    // a lab floor remember their phone far more reliably than an address like
    // sdrramtech@mail.com. Phones are compared as their last ten digits so
    // +91, a leading 0 and any spacing all reach the same account.
    const identifier = String(email || '').trim();
    const digits = identifier.replace(/\D/g, '');

    const clauses = ['u.email = ?'];
    const params = [identifier];
    if (digits.length >= 10) {
      clauses.push(`RIGHT(REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', ''), 10) = ?`);
      params.push(digits.slice(-10));
    }

    const [users] = await db.query(`
      SELECT u.*, b.hospital_code, b.district_id, b.branch_name
      FROM users u
      LEFT JOIN branches b ON u.branch_id = b.id
      WHERE ${clauses.join(' OR ')}
    `, params);

    if (users.length === 0) {
      recordLoginFailure(clientIp);
      return res.status(401).json({ message: 'Invalid credentials or password', captcha: createCaptcha() });
    }

    // Two accounts answering to one identifier must never resolve to
    // "whichever came first" — that signs somebody into a colleague's
    // account, with their role and their branch. Refused outright, naming the
    // way out.
    if (users.length > 1) {
      recordLoginFailure(clientIp);
      return res.status(409).json({
        message: 'That mobile number is registered to more than one account. Please sign in with your email address.',
        captcha: createCaptcha(),
      });
    }

    const user = users[0];

    // Deactivated accounts (User Management, tender #107) cannot sign in.
    if (user.is_active === 0) {
      recordLoginFailure(clientIp);
      return res.status(403).json({ message: 'This account has been deactivated. Please contact your administrator.', captcha: createCaptcha() });
    }

    // VAPT #6 (No Account Lock-Out): per-account lockout, layered on top of
    // the IP-based block above — an attacker who rotates source IPs against
    // one specific account is still stopped.
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({
        message: 'Account temporarily locked due to repeated failed logins. Try again later.',
        lockedUntil: user.locked_until,
        captcha: createCaptcha(),
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      recordLoginFailure(clientIp);
      const attempts = (user.failed_login_attempts || 0) + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await db.query(
        'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
        [attempts, lockedUntil, user.id]
      );
      return res.status(401).json({ message: 'Invalid credentials or password', captcha: createCaptcha() });
    }

    // The start page sends which role's sign-in screen was used. Checked only
    // after the password, so it never reveals which accounts exist.
    if (req.body.portal && !portalAccepts(req.body.portal, user.role)) {
      return res.status(403).json({
        message: `This is not a ${ROLE_PORTALS[req.body.portal]?.label || 'valid'} account. Go back and choose your own role.`,
        captcha: createCaptcha(),
      });
    }

    recordLoginSuccess(clientIp);
    await db.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?',
      [user.id]
    );
    sendSession(res, user);
  } catch (error) {
    console.error(error);

    // The CAPTCHA was already consumed by verifyCaptcha() above, so even on
    // a server error the client needs a new one to retry.
    if (error.code === '42P01') {
      return res.status(500).json({ message: 'Database tables not created yet.', captcha: createCaptcha() });
    }

    res.status(500).json({ message: 'Server error during login', captcha: createCaptcha() });
  }
};

// VAPT #16 (No Compulsory Change Password Functionality): lets an
// authenticated user change their own password, verifying the current one
// first. `password_change_required` is cleared on success so the frontend
// stops force-redirecting here after this call.
export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword) {
    return res.status(400).json({ message: 'Enter your current password.' });
  }
  const problem = passwordProblem(newPassword);
  if (problem) {
    return res.status(400).json({ message: problem });
  }

  try {
    const [users] = await db.query('SELECT id, password FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, users[0].password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    if (await bcrypt.compare(newPassword, users[0].password)) {
      return res.status(400).json({ message: 'The new password must be different from the current one.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(newPassword, salt);

    await db.query(
      'UPDATE users SET password = ?, password_change_required = 0, password_changed_at = NOW() WHERE id = ?',
      [hashed, req.user.id]
    );

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error during password change' });
  }
};

// Self-service reset for a user who's locked out of their account entirely
// (forgot the password, so can't use changePassword above). Always responds
// with the same generic message regardless of whether the email is
// registered — confirming/denying account existence here would itself be a
// user-enumeration vector.
export const forgotPassword = async (req, res) => {
  const { email, captchaId, captchaText } = req.body;

  if (!verifyCaptcha(captchaId, captchaText)) {
    return res.status(400).json({ message: 'Invalid or expired captcha', captcha: createCaptcha() });
  }

  const genericSuccess = () => res.json({
    success: true,
    message: 'If that email is registered, a password reset link has been sent.',
  });

  if (!email) return genericSuccess();

  try {
    const [users] = await db.query('SELECT id, first_name FROM users WHERE email = ?', [email]);
    if (users.length > 0) {
      const token = createResetToken(users[0].id);
      const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;
      // Deliberately not awaited: the generic-response design exists so an
      // attacker can't tell a registered email from an unregistered one by
      // the response body — but awaiting an SMTP round-trip only on the
      // "registered" branch would leak the same thing through response
      // *timing* instead (hundreds of ms vs. an instant DB miss). Firing
      // this in the background keeps both branches equally fast; a send
      // failure is still logged, just not surfaced to the caller.
      sendPasswordResetEmail(email, resetUrl, users[0].first_name)
        .catch(err => console.error('sendPasswordResetEmail failed:', err));
    }

    return genericSuccess();
  } catch (error) {
    console.error('forgotPassword error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again.', captcha: createCaptcha() });
  }
};

// Completes the flow above: exchanges a single-use reset token (proof the
// requester controls the account's email) for a new password. Treated the
// same as changePassword in terms of trust — clears password_change_required
// and any account lockout so the reset actually gets the user back in.
export const resetPasswordWithToken = async (req, res) => {
  const { token, newPassword } = req.body;

  const problem = passwordProblem(newPassword);
  if (problem) {
    return res.status(400).json({ message: problem });
  }

  const userId = consumeResetToken(token);
  if (!userId) {
    return res.status(400).json({ message: 'This reset link is invalid or has expired. Please request a new one.' });
  }

  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query(
      'UPDATE users SET password = ?, password_change_required = 0, password_changed_at = NOW(), failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      [hashed, userId]
    );
    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    console.error('resetPasswordWithToken error:', error);
    res.status(500).json({ message: 'Server error resetting password.' });
  }
};

// VAPT #9/#5: logout must actually invalidate the session server-side, not
// just rely on the client discarding it — clearCookie's options (path/
// domain/sameSite/secure) have to match what the cookie was set with or the
// browser won't recognize it as the same cookie to remove. Always succeeds:
// a client with no/expired cookie still gets a clean 200.
export const logout = (req, res) => {
  // clearCookie sets its own past Expires to delete the cookie — passing our
  // maxAge alongside it would add a future Max-Age, which browsers prefer
  // over Expires when both are present, silently keeping the cookie alive.
  const { maxAge, ...clearOptions } = authCookieOptions();
  res.clearCookie(AUTH_COOKIE_NAME, clearOptions);
  res.json({ success: true, message: 'Logged out' });
};
