import crypto from 'crypto';
import db from '../config/db.js';

// Integrity of the data a LIS Agent sends (tender #111). The agent adds
// X-Body-SHA256 (the SHA-256 of the exact request body) to everything it posts.
// The server hashes the bytes it actually received:
//   • equal    → the request goes on, and the hash is echoed back in
//                X-Received-Body-SHA256 so the agent can confirm too;
//   • different → rejected with 422 and recorded; the agent keeps the item
//                and sends it again, so a damaged transfer is never saved.
// Requests without the header (browsers, older agents) are unaffected.

/** Called by the JSON body parser with the raw bytes. */
export const captureBodyDigest = (req, _res, buf) => {
  if (req.headers['x-body-sha256'] && buf?.length) {
    req.bodySha256 = crypto.createHash('sha256').update(buf).digest('hex');
    req.bodyBytes = buf.length;
  }
};

export const verifyBodyIntegrity = (req, res, next) => {
  const claimed = String(req.headers['x-body-sha256'] || '').trim().toLowerCase();
  if (!claimed || !req.bodySha256) return next();
  if (claimed === req.bodySha256) {
    res.setHeader('X-Received-Body-SHA256', req.bodySha256);
    return next();
  }
  db.query(
    'INSERT INTO sync_integrity_events (method, path, claimed_sha256, actual_sha256, body_bytes, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [req.method, String(req.originalUrl).slice(0, 255), claimed.slice(0, 64), req.bodySha256, req.bodyBytes || null, req.ip || null]
  ).catch((e) => console.error('could not record the integrity mismatch:', e.message));
  return res.status(422).json({
    success: false, code: 'INTEGRITY_MISMATCH',
    message: 'The data was damaged on the way to the server and was not saved. It will be sent again.',
  });
};
