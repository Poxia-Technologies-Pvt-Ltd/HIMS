// Password-reset links must point at a fixed, operator-configured frontend
// origin — never anything derived from the incoming request (see
// config/publicUrl.js and VAPT #11, Host Header Injection, for why trusting
// a request for an externally-shared link is the exact pattern to avoid).
// The frontend is a separate app from this API, so it gets its own env var
// rather than reusing PUBLIC_API_URL.
export const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5175').replace(/\/+$/, '');
