import svgCaptcha from 'svg-captcha';
import crypto from 'crypto';

// In-memory captcha store — this is a single-instance server (see the OTP
// store in developerController.js for the same pattern), so a Map is enough.
// Each captcha is single-use: verifyCaptcha deletes it on the first check
// whether the answer was right or wrong, so a leaked/replayed answer can't
// be reused.
const captchaStore = new Map(); // captchaId -> { text, expiresAt }
const TTL_MS = 5 * 60 * 1000;

const purgeExpired = () => {
  const now = Date.now();
  for (const [id, entry] of captchaStore) {
    if (entry.expiresAt < now) captchaStore.delete(id);
  }
};

// size/case-sensitivity are mandated by the security checklist this feature
// was built against: min 6 chars, alphanumeric, case sensitive. Do not relax
// these without checking that requirement first.
export const createCaptcha = () => {
  purgeExpired();

  const { data, text } = svgCaptcha.create({
    size: 6,
    noise: 3,
    color: true,
    ignoreChars: '0o1ilI',
    width: 180,
    height: 52,
  });

  const captchaId = crypto.randomUUID();
  // Stored verbatim (case preserved) — comparison below is case-sensitive.
  captchaStore.set(captchaId, { text, expiresAt: Date.now() + TTL_MS });

  return { captchaId, svg: data };
};

export const verifyCaptcha = (captchaId, answer) => {
  if (!captchaId || !answer) return false;

  const entry = captchaStore.get(captchaId);
  captchaStore.delete(captchaId);

  if (!entry || Date.now() > entry.expiresAt) return false;

  return entry.text === String(answer).trim();
};
