import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Rate-limit login attempts per ACCOUNT-at-a-location rather than per IP.
//
// The default key is the client IP, which breaks in the field: government
// health facilities routinely share one computer — and therefore one public
// IP — across the whole lab. Ten fumbled passwords by any one person locked
// out every other member of staff at that site for fifteen minutes, including
// people typing their password correctly.
//
// Keying on email+IP fixes that: on a shared machine the IP is identical but
// the email differs, so each person gets their own budget. Email ALONE would
// be worse than the IP default — anyone on the internet could burn through a
// known user's allowance and deny them login. Including the IP means an
// attacker elsewhere consumes only their own bucket, never the victim's at
// the lab.
//
// Falls back to IP alone when no email is supplied (malformed request), so a
// scripted attacker can't escape the limit by simply omitting the field.
const emailAndIpKey = (field) => (req, res) => {
  const value = typeof req.body?.[field] === 'string'
    ? req.body[field].trim().toLowerCase()
    : '';
  // ipKeyGenerator normalises IPv6 into a /64 subnet — using req.ip raw would
  // let an attacker with an IPv6 range trivially rotate addresses.
  const ip = ipKeyGenerator(req, res);
  return value ? `${field}:${value}|${ip}` : `ip:${ip}`;
};

// Staff login (email + password) — generous enough for real typos, tight enough to block brute force.
// Skipped outside production so local development isn't blocked by the 15-minute
// lockout while iterating on login. Production (NODE_ENV=production, set in the
// Dockerfile) keeps the limit — this is the VAPT brute-force control.
//
// Note this is the coarse throttle only. The real per-account brute-force
// control is users.failed_login_attempts / locked_until (VAPT #6), which is
// enforced in authController regardless of source IP.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailAndIpKey('email'),
  skip: () => process.env.NODE_ENV !== 'production',
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
});

// Patient portal login (phone + DOB) — DOB has far fewer possibilities than a
// password, so this stays tighter. Keyed per phone+IP for the same reason as
// staff login: a reception desk is one shared machine, and one patient's
// mistyped DOB must not lock out the next person in the queue.
// The controller keeps its own separate 24h per-network block for repeated
// failures, which is unaffected by this.
export const patientLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailAndIpKey('phone'),
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
});

// OTP request/verify — must be tight; OTPs are short-lived numeric codes.
export const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many OTP requests. Please try again in 10 minutes.' },
});

// Public, unauthenticated lookup endpoints (e.g. lab report tracking by
// reference number) — slows down enumeration attempts regardless of how
// strong the underlying identifier is.
export const publicLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again in 15 minutes.' },
});

// Forgot-password — tightly bounded: each request sends a real email, so
// this is the actual abuse/spam vector (and, more subtly, an enumeration
// vector if it weren't already rate-limited the same regardless of whether
// the email is registered).
export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again in 15 minutes.' },
});

// Reset-password — separate, slightly more generous bucket: this endpoint is
// already token-guarded (256-bit random, single-use, 30min expiry — see
// passwordResetStore.js), so it isn't the same enumeration/spam concern as
// forgot-password. A legitimate user can plausibly fail validation (password
// too short, mismatch) a few times while typing before it succeeds.
export const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again in 15 minutes.' },
});

// Captcha generation — served to staff/patient/developer login screens before
// each submit attempt. Generous since a user may refresh the image a few
// times, but still bounded against scripted captcha-farming.
export const captchaLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many captcha requests. Please try again shortly.' },
});

// Care HIMS (CARE) inbound endpoints — /send-order, /health/status. Higher
// limit than publicLookupLimiter since CARE may legitimately call frequently
// (health checks, order delivery), but still bounded against abuse.
export const careInboundLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again in 15 minutes.' },
});
