/**
 * RS256 JWT/JWKS plumbing for the Care HIMS (CARE) integration. Two directions:
 *  - We SIGN Gateway_Bearer JWTs (our own gateway identity) for outbound calls
 *    to CARE (API 4/5) — verified by CARE against our published JWKS.
 *  - We VERIFY Care_Bearer JWTs CARE sends us on inbound /send-order calls —
 *    verified against CARE's own JWKS.
 *
 * Confirmed in this environment (Node v25.9.0 + jsonwebtoken@9.0.2): RS256
 * sign/verify and JWK<->PEM conversion work with zero new npm dependencies via
 * crypto.createPublicKey(...).export(...) — no jose/jwks-rsa needed.
 *
 * Open item: exact claim shape CARE expects/sends isn't documented beyond
 * "JWT" — this ships minimal iss/sub/aud/iat/exp and should be adjusted based
 * on real accept/reject behavior against the UAT sandbox, same philosophy as
 * cdacService.js's getCdacToken() swappable seam.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

let cachedCareJwks = null; // { keys: [...], fetchedAt }

function getPrivateKeyPem() {
  const pem = process.env.CARE_GATEWAY_PRIVATE_KEY_PEM;
  if (!pem) throw new Error('CARE_GATEWAY_PRIVATE_KEY_PEM is not configured');
  return pem.replace(/\\n/g, '\n');
}

function getKeyId() {
  const kid = process.env.CARE_GATEWAY_KEY_ID;
  if (!kid) throw new Error('CARE_GATEWAY_KEY_ID is not configured');
  return kid;
}

/** Public JWK for our gateway's signing key, served at GET /openid-configuration. */
export function getGatewayPublicJwk() {
  const privateKeyPem = getPrivateKeyPem();
  const publicKeyPem = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' });
  const jwk = crypto.createPublicKey(publicKeyPem).export({ format: 'jwk' });
  return { ...jwk, use: 'sig', alg: 'RS256', kid: getKeyId() };
}

/**
 * Signs a short-lived Gateway_Bearer JWT for outbound calls to CARE.
 * Confirmed via eGov (2026-07-15): no iss/aud/sub/facility/role claim is
 * required or wanted — "Please do not add an aud claim." Just iat/exp,
 * ~60s lifetime. `kid` is optional per CARE but harmless to keep.
 */
export function signGatewayJwt() {
  const privateKeyPem = getPrivateKeyPem();
  const kid = getKeyId();

  return jwt.sign({}, privateKeyPem, { algorithm: 'RS256', expiresIn: 60, keyid: kid });
}

function jwkToPem(jwk) {
  return crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
}

async function fetchCareJwks(careBackendUrl, { forceRefresh = false } = {}) {
  const ttlMs = Number(process.env.CARE_JWKS_CACHE_TTL_MS) || 600000;
  const isFresh = cachedCareJwks && Date.now() - cachedCareJwks.fetchedAt < ttlMs;
  if (isFresh && !forceRefresh) return cachedCareJwks.keys;

  const res = await fetch(`${careBackendUrl}/api/gateway_device/jwks.json/`);
  if (!res.ok) throw new Error(`Failed to fetch CARE JWKS: HTTP ${res.status}`);
  const body = await res.json();
  const keys = body?.keys || [];
  cachedCareJwks = { keys, fetchedAt: Date.now() };
  return keys;
}

/**
 * Verifies a Care_Bearer JWT against CARE's own published JWKS. Self-heals on
 * key rotation: if the JWT's kid isn't in the cached set, force-refreshes
 * once before giving up (the same trick jwks-rsa does internally).
 */
export async function verifyCareBearerJwt(token, careBackendUrl) {
  const decodedHeader = jwt.decode(token, { complete: true })?.header;
  if (!decodedHeader) throw new Error('Could not decode JWT header');

  let keys = await fetchCareJwks(careBackendUrl);
  let matchingJwk = decodedHeader.kid ? keys.find((k) => k.kid === decodedHeader.kid) : null;

  if (!matchingJwk && decodedHeader.kid) {
    keys = await fetchCareJwks(careBackendUrl, { forceRefresh: true });
    matchingJwk = keys.find((k) => k.kid === decodedHeader.kid);
  }

  // CARE's exact JWT shape isn't documented — some providers omit `kid`
  // entirely when they only ever publish one signing key. Falling back to
  // the sole published key (only when there's exactly one, and only when kid
  // matching didn't already succeed) avoids hard-failing on that shape
  // without weakening verification when CARE does rotate multiple keys.
  if (!matchingJwk && keys.length === 1) {
    matchingJwk = keys[0];
  }

  if (!matchingJwk) {
    throw new Error(`No matching JWKS key found${decodedHeader.kid ? ` for kid=${decodedHeader.kid}` : ' (no kid in token, and JWKS has multiple keys)'}`);
  }

  const publicKeyPem = jwkToPem(matchingJwk);
  return jwt.verify(token, publicKeyPem, { algorithms: ['RS256'], clockTolerance: 30 });
}
