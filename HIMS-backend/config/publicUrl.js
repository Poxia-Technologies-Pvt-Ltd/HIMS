// VAPT #11 (Host Header Injection): report URLs embedded in generated PDFs
// (QR codes) and sent to CDAC/WhatsApp are patient/doctor-facing output, not
// just internal redirects — building them from req.protocol/req.get('host')
// meant anyone who could get a request past server.js's Host allowlist (e.g.
// hitting the API's directly-published port with Host: localhost, allowed
// there for health checks pre-fix) could steer that header into a medical
// report's QR code. A single fixed, operator-configured origin removes the
// request as an input to this output entirely — the actual fix the finding
// wants, since narrowing the allowlist alone still leaves the pattern of
// trusting a client header for externally-shared links.
export const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 7005}`).replace(/\/+$/, '');

// Where the web app itself is served (report verification pages open here).
// Same origin as the API in production; set PUBLIC_APP_URL when they differ (local dev).
export const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || PUBLIC_API_URL).replace(/\/+$/, '');
