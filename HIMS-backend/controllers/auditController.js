import db from '../config/db.js';
import { rowHash, GENESIS_HASH } from '../middleware/auditTrail.js';

// Audit Trail page (tender #103-106): search the system-wide audit log, check
// the hash chain is unbroken, and export the evidence — available to
// Admin / Auditor roles directly, without vendor involvement.

function filters(q) {
  const where = ['1=1'];
  const params = [];
  if (q.from) { where.push('occurred_at >= ?'); params.push(`${q.from} 00:00:00`); }
  if (q.to) { where.push('occurred_at <= ?'); params.push(`${q.to} 23:59:59.999`); }
  if (q.module) { where.push('module = ?'); params.push(q.module); }
  if (q.outcome) { where.push('outcome = ?'); params.push(q.outcome); }
  if (q.method) { where.push('method = ?'); params.push(q.method); }
  if (q.user) { where.push('(user_name LIKE ? OR user_id = ?)'); params.push(`%${q.user}%`, Number(q.user) || 0); }
  if (q.entity_id) { where.push('entity_id = ?'); params.push(q.entity_id); }
  if (q.q) {
    where.push('(path LIKE ? OR action LIKE ? OR entity LIKE ? OR entity_id LIKE ? OR ip_address LIKE ?)');
    params.push(...Array(5).fill(`%${q.q}%`));
  }
  if (q.changes === '1') where.push('before_data IS NOT NULL');
  return { where: where.join(' AND '), params };
}

// GET /api/audit/sync-integrity — data an agent sent that arrived damaged, and how much was checked.
export const syncIntegrity = async (req, res) => {
  try {
    const [[m]] = await db.query("SELECT COUNT(*) AS n, MAX(occurred_at) AS last FROM sync_integrity_events WHERE occurred_at >= NOW() - INTERVAL 30 DAY");
    const [[c]] = await db.query("SELECT COUNT(*) AS n FROM lab_test_result WHERE capture_sha256 IS NOT NULL AND created_at >= NOW() - INTERVAL 30 DAY");
    const [recent] = await db.query('SELECT id, occurred_at, method, path, body_bytes, ip_address FROM sync_integrity_events ORDER BY id DESC LIMIT 20');
    res.json({ success: true, mismatches_30d: Number(m.n), last_mismatch: m.last, results_with_checksum_30d: Number(c.n), recent });
  } catch (error) {
    console.error('syncIntegrity error:', error);
    res.status(500).json({ success: false, message: 'Server error reading integrity records' });
  }
};

// GET /api/audit?from&to&module&outcome&method&user&q&changes&page
export const listAudit = async (req, res) => {
  try {
    const { where, params } = filters(req.query);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 100;
    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM system_audit_log WHERE ${where}`, params);
    const [rows] = await db.query(
      `SELECT id, occurred_at, user_id, user_name, user_role, branch_id, ip_address, method, path, module, action, entity, entity_id,
              status_code, outcome, request_data, before_data, after_data, row_hash
         FROM system_audit_log WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );
    const [modules] = await db.query('SELECT DISTINCT module FROM system_audit_log WHERE module IS NOT NULL ORDER BY module');
    res.json({ success: true, total: Number(total), page, pages: Math.max(1, Math.ceil(total / limit)), rows, modules: modules.map((m) => m.module) });
  } catch (error) {
    console.error('listAudit error:', error);
    res.status(500).json({ success: false, message: 'Server error reading the audit trail' });
  }
};

// GET /api/audit/verify — recompute the whole hash chain, in batches.
export const verifyAudit = async (req, res) => {
  try {
    let prev = GENESIS_HASH;
    let lastId = 0;
    let checked = 0;
    for (;;) {
      const [rows] = await db.query('SELECT * FROM system_audit_log WHERE id > ? ORDER BY id LIMIT 2000', [lastId]);
      if (!rows.length) break;
      for (const r of rows) {
        if (r.prev_hash !== prev) {
          return res.json({ success: true, intact: false, checked, broken_at: r.id, reason: 'Entry does not link to the one before it (an entry was removed or inserted)' });
        }
        if (rowHash(prev, r) !== r.row_hash) {
          return res.json({ success: true, intact: false, checked, broken_at: r.id, reason: 'Entry content no longer matches its hash (it was altered)' });
        }
        prev = r.row_hash;
        checked += 1;
      }
      lastId = rows[rows.length - 1].id;
    }
    res.json({ success: true, intact: true, checked, last_hash: prev });
  } catch (error) {
    console.error('verifyAudit error:', error);
    res.status(500).json({ success: false, message: 'Server error verifying the audit trail' });
  }
};

const csvCell = (v) => {
  if (v == null) return '';
  const s = typeof v === 'object' ? (v instanceof Date ? v.toISOString() : JSON.stringify(v)) : String(v);
  // Neutralise spreadsheet formula injection as well as quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

// GET /api/audit/export — same filters, CSV, capped at 50,000 rows per file.
export const exportAudit = async (req, res) => {
  try {
    const { where, params } = filters(req.query);
    const [rows] = await db.query(`SELECT * FROM system_audit_log WHERE ${where} ORDER BY id LIMIT 50000`, params);
    const cols = ['id', 'occurred_at', 'user_id', 'user_name', 'user_role', 'branch_id', 'ip_address', 'method', 'path', 'module', 'action',
      'entity', 'entity_id', 'status_code', 'outcome', 'request_data', 'before_data', 'after_data', 'prev_hash', 'row_hash'];
    const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-trail-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\uFEFF${lines.join('\r\n')}`);
  } catch (error) {
    console.error('exportAudit error:', error);
    res.status(500).json({ success: false, message: 'Server error exporting the audit trail' });
  }
};
