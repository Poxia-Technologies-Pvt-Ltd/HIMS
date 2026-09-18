export function requireApiKey(req, res, next) {
  const configuredKey = process.env.CARE_API_KEY;

  // Fail closed: an unconfigured key must never be treated as "auth not required."
  if (!configuredKey) {
    return res.status(503).json({ error: 'Service unavailable: CARE_API_KEY is not configured' });
  }

  const provided = req.headers['x-api-key'];
  if (!provided || provided !== configuredKey) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing X-API-Key' });
  }

  next();
}
