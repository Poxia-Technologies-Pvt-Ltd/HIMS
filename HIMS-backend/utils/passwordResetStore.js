import crypto from 'crypto';

// In-memory password-reset token store — single-instance server, same
// pattern as captchaStore.js / csrfStore.js / developerController.js's
// otpStore. Tokens are single-use: consumeResetToken deletes on first read
// regardless of what the caller does with the result, so a captured/replayed
// reset link can't be reused once anyone has acted on it.
const resetTokenStore = new Map(); // token -> { userId, expiresAt }
const TTL_MS = 30 * 60 * 1000; // 30 minutes

const purgeExpired = () => {
  const now = Date.now();
  for (const [token, entry] of resetTokenStore) {
    if (entry.expiresAt < now) resetTokenStore.delete(token);
  }
};

export const createResetToken = (userId) => {
  purgeExpired();
  const token = crypto.randomBytes(32).toString('hex');
  resetTokenStore.set(token, { userId, expiresAt: Date.now() + TTL_MS });
  return token;
};

export const consumeResetToken = (token) => {
  if (!token) return null;
  const entry = resetTokenStore.get(token);
  resetTokenStore.delete(token);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.userId;
};
