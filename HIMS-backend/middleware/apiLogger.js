import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'api-requests.log');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const REDACT_KEYS = new Set(['password', 'new_password', 'old_password', 'token', 'authorization']);

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

// Long base64 blobs (CDAC PDF uploads, etc.) blow up the log file and add
// nothing useful to read — truncate anything over 500 chars instead of
// redacting it outright, so the shape/length is still visible.
function truncateLongStrings(value) {
  if (Array.isArray(value)) return value.map(truncateLongStrings);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = truncateLongStrings(v);
    return out;
  }
  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 500)}...<truncated, length=${value.length}>`;
  }
  return value;
}

// Every request/response that hits the backend — url, method, body, status,
// response — one JSON line per request, so a full click-by-click trail
// (fetch worklist, acknowledge, push result, CDAC calls, etc.) can be
// replayed from the log file instead of reproducing it live.
export function apiLogger(req, res, next) {
  const startedAt = Date.now();

  const originalJson = res.json.bind(res);
  let capturedBody;
  res.json = (body) => {
    capturedBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const entry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - startedAt,
      request_body: truncateLongStrings(redact(req.body)),
      response_body: truncateLongStrings(redact(capturedBody)),
    };
    fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', (err) => {
      if (err) console.error('apiLogger: failed to write log entry:', err.message);
    });
  });

  next();
}
