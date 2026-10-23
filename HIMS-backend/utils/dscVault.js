import crypto from 'crypto';

// Keeps a certificate's password encrypted at rest (AES-256-GCM) when a hospital
// admin chooses "sign automatically". The key comes from DSC_VAULT_KEY on the
// server (JWT_SECRET is the fallback) — so the database alone is not enough to
// use a certificate. Rotating that key makes stored passwords unreadable; the
// certificate then has to be uploaded again.
const key = () => crypto.createHash('sha256').update(String(process.env.DSC_VAULT_KEY || process.env.JWT_SECRET || '')).digest();

export function sealPassword(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

export function openPassword(sealed) {
  const raw = Buffer.from(String(sealed), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
