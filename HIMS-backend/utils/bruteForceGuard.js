// In-memory brute-force guard, single-instance server (same Map-based
// pattern as captchaStore.js / csrfStore.js / developerController.js's
// otpStore). Tracks failed login attempts per client IP and blocks an IP
// for BLOCK_DURATION_MS once it crosses MAX_FAILURES wrong-credential
// attempts. Only actual wrong-credential failures count — captcha typos and
// server errors don't, so a mistyped captcha can't burn down toward a
// 24-hour lockout.
const failureStore = new Map(); // ip -> { failCount, blockedUntil, lastFailAt }

const MAX_FAILURES = 5;
const BLOCK_DURATION_MS = 24 * 60 * 60 * 1000;

const purgeStale = () => {
  const now = Date.now();
  for (const [ip, entry] of failureStore) {
    const blockExpired = !entry.blockedUntil || entry.blockedUntil < now;
    const longIdle = entry.lastFailAt < now - BLOCK_DURATION_MS;
    if (blockExpired && longIdle) failureStore.delete(ip);
  }
};

// Returns the block's expiry timestamp (ms) if the IP is currently blocked, else null.
export const getBlockedUntil = (ip) => {
  const entry = failureStore.get(ip);
  if (!entry?.blockedUntil || Date.now() > entry.blockedUntil) return null;
  return entry.blockedUntil;
};

export const recordLoginFailure = (ip) => {
  purgeStale();
  const entry = failureStore.get(ip) || { failCount: 0, blockedUntil: null, lastFailAt: 0 };
  entry.failCount += 1;
  entry.lastFailAt = Date.now();
  if (entry.failCount >= MAX_FAILURES) {
    entry.blockedUntil = Date.now() + BLOCK_DURATION_MS;
  }
  failureStore.set(ip, entry);
};

export const recordLoginSuccess = (ip) => {
  failureStore.delete(ip);
};
