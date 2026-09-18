import { verifyCareBearerJwt } from '../services/careAuthService.js';

// Sibling to apiKeyAuth.js — deliberately not touching that file, which is
// still used by the unrelated hl7Routes.js endpoints. CARE uses a custom
// "Care_Bearer" auth scheme (not the standard "Bearer"), verified as an RS256
// JWT against CARE's own JWKS rather than a static shared secret.
export async function requireCareBearer(req, res, next) {
  const careBackendUrl = process.env.CARE_BACKEND_URL;
  if (!careBackendUrl) {
    return res.status(503).json({ error: 'Service unavailable: CARE_BACKEND_URL is not configured' });
  }

  const authHeader = req.headers['authorization'] || '';
  const [scheme, token] = authHeader.split(' ');
  if (!token || scheme !== 'Care_Bearer') {
    return res.status(401).json({ error: 'Unauthorized: missing or malformed Care_Bearer token' });
  }

  try {
    req.careAuth = await verifyCareBearerJwt(token, careBackendUrl);
    next();
  } catch (err) {
    console.error('CARE Bearer verification failed:', err.message);
    return res.status(401).json({ error: 'Unauthorized: invalid Care_Bearer token' });
  }
}
