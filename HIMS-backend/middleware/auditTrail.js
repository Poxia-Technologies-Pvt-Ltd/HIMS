import crypto from 'crypto';
import db from '../config/db.js';

// System-wide audit trail (tender #103-106). Installed once in server.js, ahead
// of every route: for each state-changing API call — and a few sensitive reads
// (report PDFs, exports) — it writes one row to system_audit_log after the
// response has gone out: who (from req.user, set later by authenticateToken on
// the same req), from where, what, the outcome, and for master-data edits the
// row before and after the change.
//
// Rows are hash-chained (see migrations/2026_10_05_system_audit_log.sql). The
// chain is extended under a MySQL named lock, so it stays linear even with
// several backend processes writing at once. Writing never delays or fails
// the request itself: it runs after 'finish', and errors are only logged.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Reads worth recording: who looked at / printed / exported what.
const AUDITED_READS = [
  /^\/api\/lab\/generate-report-pdf\//,
  /^\/api\/patients\/portal\/reports\/[^/]+\/[^/]+\/pdf$/,
  /^\/api\/export\//,
  /^\/api\/fhir\/(?!metadata)/,
  /^\/api\/audit\/export$/,
];

// High-volume machine traffic that would drown the trail without adding to it.
const SKIPPED = [
  /^\/api\/auth\/captcha/,
  /^\/api\/lab\/analyzer-event$/,
  /^\/api\/whatsapp\/webhook$/,
  /^\/api\/payments\/razorpay\/webhook$/,
];

// Master-data rows whose full before/after is kept (tender #105).
const TRACKED = [
  { re: /^\/api\/lab\/tests\/(\d+)$/, table: 'lab_tests', entity: 'Lab test' },
  { re: /^\/api\/lab\/categories\/(\d+)$/, table: 'lab_categories', entity: 'Lab category' },
  { re: /^\/api\/lab\/containers\/(\d+)$/, table: 'sample_containers', entity: 'Sample container' },
  { re: /^\/api\/lab\/sample-types\/(\d+)$/, table: 'sample_types', entity: 'Sample type' },
  { re: /^\/api\/lab\/machines\/(\d+)$/, table: 'lab_machines', entity: 'Analyzer' },
  { re: /^\/api\/equipment\/registry\/(\d+)$/, table: 'lab_machines', entity: 'Analyzer' },
  { re: /^\/api\/equipment\/machines\/(\d+)\/install-location$/, table: 'lab_machines', entity: 'Analyzer' },
  { re: /^\/api\/lab\/verification-workflows\/(\d+)$/, table: 'lab_verification_workflows', key: 'category_id', entity: 'Verification workflow' },
  { re: /^\/api\/billing-packages\/(\d+)$/, table: 'billing_packages', entity: 'Billing package' },
  { re: /^\/api\/free-schemes\/(\d+)$/, table: 'free_schemes', entity: 'Free scheme' },
  { re: /^\/api\/departments\/(\d+)$/, table: 'departments', entity: 'Department' },
  { re: /^\/api\/staff\/(\d+)(\/[a-z-]+)?$/, table: 'users', entity: 'User', omit: ['password', 'signature_image'] },
  { re: /^\/api\/dev\/users\/(\d+)(\/[a-z-]+)?$/, table: 'users', entity: 'User', omit: ['password', 'signature_image'] },
  { re: /^\/api\/branches\/center\/(\d+)(\/[a-z-]+)?$/, table: 'branches', entity: 'Facility' },
  { re: /^\/api\/branches\/district\/(\d+)$/, table: 'districts', entity: 'District' },
  { re: /^\/api\/(?:v2\/)?inventory\/items\/(\d+)$/, table: 'inventory_item_master', entity: 'Inventory item' },
  { re: /^\/api\/quality\/materials\/(\d+)$/, table: 'qc_materials', entity: 'QC material' },
  { re: /^\/api\/disaster\/rules\/(\d+)$/, table: 'surveillance_diseases', entity: 'Surveillance rule' },
  { re: /^\/api\/settings$/, table: 'hospital_settings', entity: 'Hospital settings', single: true, omit: ['smtp_pass', 'logo_url'] },
];

const REDACT = new Set(['password', 'new_password', 'old_password', 'newpassword', 'currentpassword', 'confirmpassword',
  'token', 'otp', 'captchatext', 'smtp_pass', 'signature_image', 'photo_base64', 'media', 'logo_url', 'pdf', 'pdfbase64', 'file',
  // certificate files and their passwords must never reach the audit log
  'dsc_password', 'p12_base64', 'p12', 'pfx']);

function scrub(value, depth = 0) {
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT.has(k.toLowerCase()) ? '[REDACTED]' : scrub(v, depth + 1);
    }
    return out;
  }
  if (Buffer.isBuffer(value)) return `[binary ${value.length} bytes]`;
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…(${value.length})`;
  return value;
}

// Key-sorted JSON, so the hash is the same whether computed from the object
// written or the one MySQL hands back (JSON columns reorder keys).
export function canonical(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export function rowHash(prevHash, r) {
  const payload = canonical([
    prevHash, new Date(r.occurred_at).getTime(), r.user_id ?? null, r.user_name ?? null, r.user_role ?? null, r.branch_id ?? null,
    r.ip_address ?? null, r.user_agent ?? null, r.method, r.path, r.module ?? null, r.action, r.entity ?? null, r.entity_id ?? null, r.status_code ?? null, r.outcome,
    r.request_data ?? null, r.before_data ?? null, r.after_data ?? null,
  ]);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export const GENESIS_HASH = '0'.repeat(64);

// Small name cache: one users lookup per person per 5 minutes, not per call.
const names = new Map();
async function userName(id) {
  const hit = names.get(id);
  if (hit && hit.at > Date.now() - 300000) return hit.name;
  const [[u]] = await db.query("SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [id]);
  names.set(id, { name: u?.name || null, at: Date.now() });
  return u?.name || null;
}

async function snapshot(spec, id) {
  const [rows] = spec.single
    ? await db.query(`SELECT * FROM \`${spec.table}\` LIMIT 1`)
    : await db.query(`SELECT * FROM \`${spec.table}\` WHERE \`${spec.key || 'id'}\` = ? LIMIT 1`, [id]);
  if (!rows[0]) return null;
  const row = { ...rows[0] };
  for (const k of spec.omit || []) if (k in row) row[k] = '[REDACTED]';
  return scrub(row);
}

// /api/lab/tests/42 -> "PUT /api/lab/tests/:id"; sample ids and UUIDs (segments
// with a digit and a dash/underscore, e.g. LAB-CHCKAN-20260710-0002) -> :ref.
const templatePath = (p) => p
  .replace(/\/\d+(?=\/|$)/g, '/:id')
  .replace(/\/(?=[^/]*\d)[A-Z0-9]+(?:[-_][A-Z0-9]+)+(?=\/|$)/gi, '/:ref');

const moduleOf = (p) => {
  const m = p.match(/^\/api\/(?:v2\/)?([a-z0-9-]+)/i);
  return m ? m[1] : 'other';
};

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || null;

let chain = Promise.resolve();

async function writeEntry(entry) {
  const conn = await db.getConnection();
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK('system_audit_log_chain', 10) AS ok");
    if (!lock?.ok) throw new Error('could not take audit chain lock');
    try {
      const [[last]] = await conn.query('SELECT row_hash FROM system_audit_log ORDER BY id DESC LIMIT 1');
      const prev = last?.row_hash || GENESIS_HASH;
      const hash = rowHash(prev, entry);
      const json = (v) => (v == null ? null : JSON.stringify(v));
      await conn.query(
        `INSERT INTO system_audit_log (occurred_at, user_id, user_name, user_role, branch_id, ip_address, user_agent, method, path,
                                       module, action, entity, entity_id, status_code, outcome, request_data, before_data, after_data,
                                       prev_hash, row_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [entry.occurred_at, entry.user_id, entry.user_name, entry.user_role, entry.branch_id, entry.ip_address, entry.user_agent,
         entry.method, entry.path, entry.module, entry.action, entry.entity, entry.entity_id, entry.status_code, entry.outcome,
         json(entry.request_data), json(entry.before_data), json(entry.after_data), prev, hash]
      );
    } finally {
      await conn.query("SELECT RELEASE_LOCK('system_audit_log_chain')");
    }
  } finally {
    conn.release();
  }
}

export function auditTrail(req, res, next) {
  const path = req.path;
  if (!path.startsWith('/api/') || SKIPPED.some((re) => re.test(path))) return next();
  const isRead = !MUTATING.has(req.method);
  if (isRead && !AUDITED_READS.some((re) => re.test(path))) return next();

  // Whole milliseconds, which is exactly what TIMESTAMP(3) stores and hands back.
  const occurredAt = new Date();
  // Read now: the socket may already be released by the time 'finish' fires.
  const ip = clientIp(req);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 255) || null;
  const spec = !isRead && req.method !== 'POST' ? TRACKED.find((t) => t.re.test(path)) : null;
  const trackedId = spec && !spec.single ? path.match(spec.re)[1] : null;

  let responseBody;
  const originalJson = res.json.bind(res);
  res.json = (body) => { responseBody = body; return originalJson(body); };

  const proceed = (before) => {
    res.on('finish', () => {
      chain = chain.then(async () => {
        const user = req.user || {};
        const after = spec && res.statusCode < 400 && req.method !== 'DELETE'
          ? await snapshot(spec, trackedId).catch(() => null) : null;
        const createdId = responseBody && typeof responseBody === 'object'
          ? (responseBody.id ?? responseBody.insertId ?? responseBody.data?.id ?? null) : null;
        const entityId = trackedId || (path.match(/\/(\d+)(?:\/[a-z-]+)?$/) || [])[1] || (createdId != null ? String(createdId) : null)
          || req.params?.sampleId || req.body?.sample_id || req.body?.sampleId || null;
        const status = res.statusCode;
        await writeEntry({
          occurred_at: occurredAt,
          user_id: user.id || null,
          user_name: user.id ? await userName(user.id) : (user.device ? `Workstation: ${user.device}` : (req.body?.email || req.body?.phone ? 'Login attempt' : 'Public / kiosk')),
          user_role: user.role || null,
          branch_id: user.branch_id || null,
          ip_address: ip,
          user_agent: userAgent,
          method: req.method,
          path: path.slice(0, 255),
          module: moduleOf(path),
          action: `${req.method} ${templatePath(path)}`.slice(0, 120),
          entity: spec?.entity || null,
          entity_id: entityId != null ? String(entityId).slice(0, 80) : null,
          status_code: status,
          outcome: status < 400 ? 'Success' : (status === 401 || status === 403) ? 'Denied' : 'Failed',
          request_data: isRead ? scrub(req.query || {}) : scrub({ body: req.body || {}, query: req.query || {}, message: responseBody?.message }),
          before_data: before,
          after_data: after,
        });
      }).catch((e) => console.error('audit trail write failed:', e.message));
    });
    next();
  };

  if (spec) {
    snapshot(spec, trackedId).then(proceed, () => proceed(null));
  } else {
    proceed(null);
  }
}
