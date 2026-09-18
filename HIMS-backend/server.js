import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { apiLogger } from './middleware/apiLogger.js';
import authRoutes from './routes/authRoutes.js';
import developerRoutes from './routes/developerRoutes.js';
import patientRoutes from './routes/patientRoutes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import staffRoutes from './routes/staffRoutes.js';
import infraRoutes from './routes/infraRoutes.js';
import dutyRoutes from './routes/dutyRoutes.js';
import billingPackageRoutes from './routes/billingPackageRoutes.js';
import freeSchemeRoutes from './routes/freeSchemeRoutes.js';
import departmentRoutes from './routes/departmentRoutes.js';
import labRoutes from './routes/labRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import inventoryVendorRoutes from './routes/inventoryVendorRoutes.js';
import inventoryItemRoutes from './routes/inventoryItemRoutes.js';
import inventoryBatchRoutes from './routes/inventoryBatchRoutes.js';
import inventoryTransactionRoutes from './routes/inventoryTransactionRoutes.js';
import inventoryMappingRoutes from './routes/inventoryMappingRoutes.js';
import inventoryAnalyticsRoutes from './routes/inventoryAnalyticsRoutes.js';
import inventorySuggestionRoutes from './routes/inventorySuggestionRoutes.js';
import inventoryTransferRoutes from './routes/inventoryTransferRoutes.js';
import inventoryAccountsPayableRoutes from './routes/inventoryAccountsPayableRoutes.js';
import inventoryProcurementRoutes from './routes/inventoryProcurementRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import branchRoutes from './routes/branchRoutes.js';
import orgRoutes from './routes/orgRoutes.js';
import inventoryNetworkRoutes from './routes/inventoryNetworkRoutes.js';
import hl7Routes from './routes/hl7Routes.js';
import disasterRoutes from './routes/disasterRoutes.js';
import careRoutes from './routes/careRoutes.js';
import careBridgeRoutes from './routes/careBridgeRoutes.js';
import careAdminRoutes from './routes/careAdminRoutes.js';
import cdacRoutes from './routes/cdacRoutes.js';
import publicUploadRoutes from './routes/publicUploadRoutes.js';
import deviceKeyRoutes from './routes/deviceKeyRoutes.js';
import db from './config/db.js';
import barcodeRoutes from './routes/barcodeRoutes.js';
import prescriptionRoutes from './routes/prescriptionRoutes.js';
import consultationRoutes from './routes/consultationRoutes.js';
import { initCronJobs } from './jobs/cronJobs.js';

dotenv.config();

// Initialize scheduled tasks
initCronJobs();

const app = express();
const PORT = process.env.PORT || 5001;

// This app always runs behind nginx (both the live lims.poxiatechnologies.com
// domain and any tunnel), which sets X-Forwarded-For. Without trust proxy set,
// express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on any request
// carrying that header — and since it's thrown from inside a middleware's
// async key generator with no surrounding try/catch, it's an *uncaught*
// exception that crashes the whole process. `1` trusts exactly one hop
// (nginx), matching the actual deployment topology.
app.set('trust proxy', 1);

// VAPT #23 (Server Fingerprinting): must run before ANY other middleware —
// including the Host-header/CORS/Referer gates below, which each have their
// own early "reject" response paths. Express adds X-Powered-By: Express at
// send-time regardless of where in the chain a response is produced, so
// disabling it app-wide (rather than only via helmet's hidePoweredBy, which
// is a middleware that only strips headers on responses that reach it) is
// what actually guarantees it never appears, even on a 400 from the Host
// check below.
app.disable('x-powered-by');

// This is a JSON/file API, not an HTML-serving app, so the CSP/COEP defaults
// (meant for pages rendering markup) are irrelevant here and just add noise;
// crossOriginResourcePolicy is relaxed so the frontend (a different origin)
// can still load PDFs/QR images/barcodes served from these endpoints.
// Placed first, ahead of the Host/CORS/Referer gates, so their early
// rejections still carry baseline headers (X-Frame-Options etc. — VAPT #23 /
// Clickjacking) instead of skipping helmet entirely.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // VAPT #17: helmet's default max-age (180 days) is below the report's
  // required 31536000s/1yr — the frontend's nginx config already sets the
  // stronger value; match it here in case the API's own origin is scanned
  // separately from the frontend's.
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));
// VAPT #18: helmet sets X-XSS-Protection to "0" by default (the modern,
// correct advice — the old browser XSS auditor is deprecated and could
// itself be abused). The scanner's checklist still wants the legacy
// "1; mode=block" value, which is harmless noise on current browsers, so
// set it explicitly to close the finding without fighting helmet's default.
// Kept immediately after helmet() — same reasoning as VAPT #23 above: the
// Host/CORS/Referer gates below have their own early-reject responses, and
// this needs to be on those too, not just requests that reach the routes.
app.use((req, res, next) => {
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});
// VAPT #25: don't let clients fingerprint/diff exact response revisions.
app.set('etag', false);

// VAPT #10 (Cache Header Not Implemented): this is a pure JSON/file API —
// every response is either user-specific or state-changing, so none of it
// should ever be cached by a shared proxy or left in browser disk cache.
// Same reasoning as X-XSS-Protection above for the placement: ahead of the
// Host/CORS/Referer gates' own early-reject responses.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://jh-lims.poxiatechnologies.com')
  .split(',')
  .map(o => o.trim());

// VAPT #11 (Host Header Injection): reject requests whose Host header
// doesn't match a known hostname before anything downstream trusts it for
// link/redirect generation. Derived from ALLOWED_ORIGINS by default so
// there's one list to maintain in prod; override with ALLOWED_HOSTS if the
// API's own hostname differs from the frontend origins.
// localhost/127.0.0.1 are only added outside production — this backend's
// port is published directly (see docker-compose.yml), so unconditionally
// trusting those in prod let a request that reaches the container straight
// (bypassing the real domain) still pass this check with a spoofed Host,
// which then flowed into patient-facing report URLs (see config/publicUrl.js).
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS
  ? process.env.ALLOWED_HOSTS.split(',')
  : ALLOWED_ORIGINS.map(o => { try { return new URL(o).host; } catch { return null; } }).filter(Boolean)
).concat(process.env.NODE_ENV === 'production' ? [] : ['localhost', '127.0.0.1'])
  .map(h => h.trim().toLowerCase());

console.log('[debug] NODE_ENV=', JSON.stringify(process.env.NODE_ENV), 'ALLOWED_HOSTS=', ALLOWED_HOSTS);

app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (ALLOWED_HOSTS.some(allowed => host === allowed || host === allowed.split(':')[0])) {
    return next();
  }
  return res.status(400).json({ success: false, message: 'Invalid Host header' });
});

// Needed to read the HttpOnly session cookie set by authController.login
// (VAPT #9) before any route/middleware that calls authenticateToken.
app.use(cookieParser());

// CARE's gateway-registration screen runs its "Test Connection" check from the
// operator's *browser*, not from CARE's servers — so the fetch carries CARE's
// own origin, which the allowlist below rejects with 403. The endpoint is
// healthy; the browser simply can't read the response, and CARE reports the
// gateway as unreachable.
//
// These two routes are public by design: a JWKS endpoint exists precisely to
// be fetched by anyone verifying our signature, and /health/status returns
// only booleans. Neither reads a cookie nor returns anything sensitive, so
// they get an open CORS policy of their own instead of widening the global
// allowlist (which is credentialed and must stay closed).
const CARE_PUBLIC_PATHS = new Set(['/openid-configuration', '/health/status']);
const isCarePublicPath = (req) =>
  CARE_PUBLIC_PATHS.has(req.path.replace(/\/+$/, '') || '/');

// The CARE bridge is called by a browser extension, whose Origin is
// chrome-extension://<id> — an id that changes between an unpacked build and a
// published one, so it cannot usefully be allowlisted. The API key is what
// actually authorises this endpoint (requireApiKey, failing closed), and it is
// never cookie-authenticated, so opening CORS here grants nothing: a page
// without the key gets 401, and anyone holding the key does not need a browser.
const isCareBridgePath = (req) => req.path.startsWith('/api/care-bridge');

const isOpenCorsPath = (req) => isCarePublicPath(req) || isCareBridgePath(req);

app.use((req, res, next) => {
  if (!isOpenCorsPath(req)) return next();
  // No Allow-Credentials: '*' and credentials are mutually exclusive, and
  // these endpoints authenticate by key or not at all — never by cookie.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const corsMiddleware = cors({
  origin: (origin, callback) => {
    // No Origin header = server-to-server/curl/mobile clients — not subject to
    // browser CORS enforcement in the first place, so let them through.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-CSRF-Token'],
  // Custom response headers aren't readable by client JS cross-origin unless
  // explicitly exposed — the CSRF middleware rotates the token via this header.
  exposedHeaders: ['X-CSRF-Token']
});

// Skip the credentialed allowlist for the two public CARE endpoints — they
// were already answered above. Without this they would still reach cors() and
// be rejected, defeating the handler.
app.use((req, res, next) =>
  isOpenCorsPath(req) ? next() : corsMiddleware(req, res, next));

// VAPT #20 (Access Control Allowed Origin Header Not Implemented): the cors
// middleware above only emits Access-Control-Allow-Origin when the request
// itself carries a matching Origin header (correct CORS behavior, and how a
// real browser cross-origin call works) — but scanners that probe plain GETs
// without an Origin header see no ACAO header at all and flag it as missing.
// Backfill it with the primary trusted origin (never "*") whenever cors()
// didn't already set one, so the header is always present without loosening
// the allowlist enforced above.
app.use((req, res, next) => {
  if (!res.getHeader('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  next();
});

// VAPT #14 (Improper Referer Check): defense-in-depth alongside the CSRF
// token in middleware/auth.js — a mutating request whose Referer/Origin
// points somewhere outside the allowlist is rejected even if it somehow
// carried a valid token (e.g. leaked via an XSS on an allowed origin, or a
// misconfigured proxy).
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use((req, res, next) => {
  if (!MUTATING_METHODS.has(req.method)) return next();

  // The CARE bridge is exempt. This guard defends against CSRF — a browser
  // being tricked into sending a request that rides an ambient cookie the
  // victim already holds. The bridge has no ambient credential to ride: it is
  // authenticated solely by an X-API-Key header that a cross-site page cannot
  // read or guess, and it never consults a cookie. The caller is a browser
  // extension whose chrome-extension://<id> origin changes between unpacked
  // and published builds, so it cannot be allowlisted; without this it fails
  // the check below as "Request source not allowed" despite holding a valid
  // key.
  if (isCareBridgePath(req)) return next();

  const source = req.headers.origin || req.headers.referer;
  if (!source) {
    // A blanket exemption here was the bypass a manual Referer-check test
    // exploits: a plain cross-site <form> POST omits Origin, and the
    // attacker's own page can suppress Referer too (<meta name="referrer"
    // content="no-referrer">), leaving neither header for this check to see
    // — while the victim's browser still attaches the httpOnly session
    // cookie. Real requests from this app's own frontend always carry one
    // of the two (it never sets a no-referrer policy), so the only
    // legitimate way to have both absent is a non-browser client.
    const hasSessionCookie = !!(req.cookies?.hims_token || req.cookies?.hims_dev_token);
    if (hasSessionCookie) {
      // A browser session with no Referer/Origin is exactly the forged-form
      // pattern above — reject regardless of what else the request carries.
      return res.status(403).json({ success: false, message: 'Missing Referer/Origin header' });
    }

    // The comment above used to stop here and let anything cookie-less
    // through on the theory that "a real non-browser client authenticates
    // via the Authorization header instead" — but never actually checked
    // for one. That left every pre-auth mutating endpoint (login,
    // forgot-password, reset-password, dev OTP) with no Referer/Origin
    // enforcement at all: none of them have a cookie yet by definition, so
    // a captured request with Origin/Referer stripped sailed straight
    // through regardless of where it came from. Actually check for the
    // credential a genuine non-browser caller in this app always carries
    // instead — CARE's Care_Bearer / hl7's X-API-Key both ride here, same
    // as an Authorization: Bearer token for authenticateToken's fallback —
    // and only exempt when one is actually present.
    const hasNonBrowserCredential = !!(req.headers['authorization'] || req.headers['x-api-key']);
    if (hasNonBrowserCredential) return next();

    return res.status(403).json({ success: false, message: 'Missing Referer/Origin header' });
  }

  let sourceOrigin;
  try {
    sourceOrigin = new URL(source).origin;
  } catch {
    return res.status(403).json({ success: false, message: 'Invalid Referer/Origin header' });
  }

  if (ALLOWED_ORIGINS.includes(sourceOrigin)) return next();
  return res.status(403).json({ success: false, message: 'Request source not allowed' });
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(apiLogger);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/dev', developerRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/infra', infraRoutes);
app.use('/api/duty', dutyRoutes);
app.use('/api/billing-packages', billingPackageRoutes);
app.use('/api/free-schemes', freeSchemeRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/lab', labRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/v2/inventory/vendors', inventoryVendorRoutes);
app.use('/api/v2/inventory/items', inventoryItemRoutes);
app.use('/api/v2/inventory/batches', inventoryBatchRoutes);
app.use('/api/v2/inventory/transactions', inventoryTransactionRoutes);
app.use('/api/v2/inventory/mappings', inventoryMappingRoutes);
app.use('/api/v2/inventory/analytics', inventoryAnalyticsRoutes);
app.use('/api/v2/inventory/suggestions', inventorySuggestionRoutes);
app.use('/api/v2/inventory/transfers', inventoryTransferRoutes);
app.use('/api/v2/inventory/ap', inventoryAccountsPayableRoutes);
app.use('/api/v2/inventory/procurement', inventoryProcurementRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/org', orgRoutes);
app.use('/api/inventory-network', inventoryNetworkRoutes);
app.use('/api/hl7', hl7Routes);
app.use('/api/disaster', disasterRoutes);
app.use('/api/barcodes', barcodeRoutes);
app.use('/api/public/upload', publicUploadRoutes);
app.use('/api/dev-keys', deviceKeyRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/', careRoutes);
app.use('/api/care', careAdminRoutes);
// Browser-extension bridge: scraped CARE orders -> bills (X-API-Key auth).
app.use('/api/care-bridge', careBridgeRoutes);
app.use('/api/cdac', cdacRoutes);
// Health check route
app.get('/', (req, res) => {
  res.send('HIMS Backend is running!');
});

// Global error handler — must be last. Catches anything not already handled by
// a controller's own try/catch (malformed JSON bodies, the CORS rejection above,
// etc.) and never leaks a stack trace to the client outside of development.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'Not allowed by CORS' });
  }

  // Multer validation errors (file too large, wrong type) are user-actionable
  // input errors, not internal failures — safe to surface in production.
  if (err.name === 'MulterError' || /Only image uploads/.test(err.message || '')) {
    return res.status(400).json({ success: false, message: err.message });
  }

  const isProd = process.env.NODE_ENV === 'production';
  res.status(err.status || 500).json({
    success: false,
    message: isProd ? 'Internal server error' : err.message,
    ...(isProd ? {} : { stack: err.stack }),
  });
});

// Start server - bind to 0.0.0.0 to accept external connections
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Accessible via your IP address on port ${PORT}`);

  // Test DB connection on startup
  try {
    const connection = await db.getConnection();
    console.log('Database connected successfully!');
    connection.release();
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }

  // Auto-migrate: create analyzer_connection_logs if it doesn't exist
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS analyzer_connection_logs (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        machine_id   VARCHAR(100)             NOT NULL,
        machine_name VARCHAR(200)             DEFAULT NULL,
        model        VARCHAR(200)             DEFAULT NULL,
        lab_id       INT                      DEFAULT NULL,
        port         VARCHAR(100)             DEFAULT NULL,
        event        ENUM('ONLINE','OFFLINE') NOT NULL,
        ip_address   VARCHAR(45)              DEFAULT NULL,
        created_at   TIMESTAMP                DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_machine_id (machine_id),
        INDEX idx_lab_id     (lab_id),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ analyzer_connection_logs table ready.');
  } catch (err) {
    console.error('Migration error (analyzer_connection_logs):', err.message);
  }

  // Auto-migrate: VAPT #6 (account lockout) / #16 (compulsory password
  // change) columns on `users`. Guarded per-column since MySQL has no
  // "ADD COLUMN IF NOT EXISTS" and re-running ADD COLUMN on an existing
  // column would error on every boot.
  try {
    const [cols] = await db.query(`SHOW COLUMNS FROM users`);
    const existing = new Set(cols.map(c => c.Field));
    const wanted = [
      ['failed_login_attempts', 'INT NOT NULL DEFAULT 0'],
      ['locked_until', 'DATETIME NULL DEFAULT NULL'],
      ['password_change_required', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ];
    for (const [name, def] of wanted) {
      if (!existing.has(name)) {
        await db.query(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
        console.log(`✅ users.${name} column added.`);
      }
    }
  } catch (err) {
    console.error('Migration error (users lockout/password columns):', err.message);
  }
});
