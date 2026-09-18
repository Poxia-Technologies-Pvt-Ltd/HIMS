import crypto from 'crypto';

// In-memory CSRF token store, single-instance server (same pattern as
// captchaStore.js / developerController.js's otpStore). Keyed by the JWT's
// `sid` claim (one per login, not per user — so two tabs/devices logged in
// simultaneously each get an independent token lifecycle instead of racing
// to invalidate each other).
//
// Sliding window of 2: both the current and the immediately-previous token
// are accepted. This still kills a captured/replayed request as soon as the
// legitimate client makes its next mutating call, without causing false
// 403s when two legitimate requests race from the same tab (parallel saves,
// bulk actions, React 18 StrictMode double-effects in dev).
const csrfStore = new Map(); // sid -> { current, previous, expiresAt }
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // matches the longest-lived JWT (staff, 30d)

const purgeExpired = () => {
  const now = Date.now();
  for (const [sid, entry] of csrfStore) {
    if (entry.expiresAt < now) csrfStore.delete(sid);
  }
};

export const issueCsrfToken = (sid) => {
  purgeExpired();
  const token = crypto.randomBytes(32).toString('hex');
  csrfStore.set(sid, { current: token, previous: null, expiresAt: Date.now() + TTL_MS });
  return token;
};

export const verifyAndRotateCsrfToken = (sid, submittedToken) => {
  if (!sid || !submittedToken) return null;

  const entry = csrfStore.get(sid);

  // This store is in memory, so a backend restart forgets every session's
  // token while their JWT cookie — good for 30 days — is still perfectly
  // valid. Rejecting here logged every signed-in user out on each deploy,
  // mid-task, which is exactly what the 8-hour idle window is meant to
  // prevent.
  //
  // A caller that reaches this point has already had its JWT cookie verified
  // by authenticateToken, so the session is genuine; the only thing missing
  // is server-side memory of its token. Issuing a fresh one keeps the
  // protection intact — a cross-site attacker cannot read our responses
  // (CORS), so it can never learn the token it would have to submit, which is
  // the whole basis of the double-submit defence.
  if (!entry) return issueCsrfToken(sid);

  if (Date.now() > entry.expiresAt) return null;

  if (submittedToken !== entry.current && submittedToken !== entry.previous) return null;

  const nextToken = crypto.randomBytes(32).toString('hex');
  csrfStore.set(sid, { current: nextToken, previous: entry.current, expiresAt: Date.now() + TTL_MS });
  return nextToken;
};
