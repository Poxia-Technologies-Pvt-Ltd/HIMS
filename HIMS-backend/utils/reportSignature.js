import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// Electronic authentication of authorized reports (login-based).

const secret = () => process.env.REPORT_SEAL_SECRET || process.env.JWT_SECRET || 'ka-lims-report-seal';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (s) => crypto.createHmac('sha256', secret()).update(s).digest('hex');

// The signature image must be a small PNG / JPEG data URL.
export function validateSignatureImage(dataUrl) {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return 'The signature must be a PNG or JPEG image.';
  if (Buffer.byteLength(m[2], 'base64') > 250 * 1024) return 'The signature image is too large (limit 250 KB).';
  return null;
}

// Deterministic description of what the doctor is vouching for. Anything that
// changes a printed value changes the hash.
export async function canonicalReportContent(conn, resultId) {
  const [[r]] = await conn.query(
    `SELECT tr.id, tr.sample_id, tr.test_name, tr.tested_at, tr.results_json,
            p.reg_no, CONCAT(p.first_name, ' ', p.last_name) AS patient_name
     FROM lab_test_result tr LEFT JOIN patients p ON p.id = tr.patient_id WHERE tr.id = ?`,
    [resultId]
  );
  if (!r) return null;
  const rows = typeof r.results_json === 'string' ? JSON.parse(r.results_json || '[]') : (r.results_json || []);
  const results = rows.filter((x) => x && !x.is_subheader).map((x) => [
    String(x.parameter_name ?? ''), String(x.result_value ?? ''), String(x.unit ?? ''),
    String(x.reference_range ?? x.ref_range ?? ''), String(x.result_flag ?? x.flag ?? ''),
  ]);
  return JSON.stringify({
    result_id: r.id, sample_id: r.sample_id, test: r.test_name || '', patient: r.reg_no || '',
    patient_name: r.patient_name || '', tested_at: r.tested_at ? new Date(r.tested_at).toISOString() : null, results,
  });
}

export const contentHash = (canonical) => sha256(canonical);
export const sealFor = ({ hash, signerId, signedAt }) => hmac(`${hash}|${signerId}|${new Date(signedAt).toISOString()}`);

// Link key for the public verification page (knowing an id is not enough).
export const verifyKey = (signatureId) => hmac(`verify:${signatureId}`).slice(0, 16);
export const verifyKeyOk = (signatureId, key) => {
  const expected = verifyKey(signatureId);
  return typeof key === 'string' && key.length === expected.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected));
};

// Password re-entry with a small in-memory attempt limit, so a signing prompt
// on an unattended screen cannot be used to guess the doctor's password.
const attempts = new Map();
export async function confirmPassword(conn, userId, password) {
  const now = Date.now();
  const rec = (attempts.get(userId) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (rec.length >= 5) return { ok: false, status: 429, message: 'Too many wrong passwords. Try again in 15 minutes.' };
  const [[u]] = await conn.query('SELECT password FROM users WHERE id = ?', [userId]);
  const ok = !!password && !!u && await bcrypt.compare(String(password), u.password);
  if (!ok) { rec.push(now); attempts.set(userId, rec); return { ok: false, status: 401, message: 'Password incorrect — the report was not signed.' }; }
  attempts.delete(userId);
  return { ok: true };
}

// Current state of a signature against the stored result.
export async function checkSignature(conn, sig) {
  const canonical = await canonicalReportContent(conn, sig.result_id);
  const sealOk = sealFor({ hash: sig.content_hash, signerId: sig.signer_id, signedAt: sig.signed_at }) === sig.seal;
  const unchanged = !!canonical && contentHash(canonical) === sig.content_hash;
  return { sealOk, unchanged, state: sig.status === 'Revoked' ? 'Revoked' : (sealOk && unchanged ? 'Authentic' : 'Altered') };
}
