import db from '../config/db.js';

// Government data access without vendor involvement (tender #85-87, #125-127):
// any table as CSV, the data dictionary generated from the live schema, and
// the catalogue of every API endpoint. Secrets are blanked in exports; every
// export is itself recorded by the audit trail (/api/export/ is an audited read).

const REDACTED_COLUMNS = {
  users: ['password', 'signature_image'],
  hospital_settings: ['smtp_pass'],
  patients: ['abha_token', 'abha_x_token', 'photo_base64'],
  device_api_keys: ['key_hash'],
};

const schemaName = async () => (await db.query('SELECT DATABASE() AS db'))[0][0].db;

export const listTables = async (req, res) => {
  try {
    const schema = await schemaName();
    const [rows] = await db.query(
      `SELECT t.TABLE_NAME AS name, t.TABLE_ROWS AS approx_rows, t.TABLE_COMMENT AS comment,
              ROUND((t.DATA_LENGTH + t.INDEX_LENGTH) / 1048576, 2) AS size_mb, t.UPDATE_TIME AS updated_at
         FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE' ORDER BY t.TABLE_NAME`, [schema]);
    res.json({
      success: true,
      tables: rows.map((r) => ({ ...r, redacted: REDACTED_COLUMNS[r.name] || [] })),
    });
  } catch (error) {
    console.error('listTables error:', error);
    res.status(500).json({ success: false, message: 'Server error listing tables' });
  }
};

const csvCell = (v) => {
  if (v == null) return '';
  let s;
  if (v instanceof Date) s = Number.isNaN(v.getTime()) ? '' : v.toISOString();
  else if (Buffer.isBuffer(v)) s = v.toString('base64');
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
};

// GET /api/export/table/:name — the whole table as CSV, streamed in batches.
export const exportTable = async (req, res) => {
  try {
    const schema = await schemaName();
    const name = String(req.params.name || '');
    const [[exists]] = await db.query(
      "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'", [schema, name]);
    if (!exists.n) return res.status(404).json({ success: false, message: 'Table not found' });

    const [cols] = await db.query(
      'SELECT COLUMN_NAME AS c, COLUMN_KEY AS k FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      [schema, name]);
    const columns = cols.map((c) => c.c);
    const redacted = new Set(REDACTED_COLUMNS[name] || []);
    const order = cols.filter((c) => c.k === 'PRI').map((c) => `\`${c.c}\``).join(', ') || `\`${columns[0]}\``;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write(`\uFEFF${columns.join(',')}\r\n`);
    const BATCH = 5000;
    for (let offset = 0; ; offset += BATCH) {
      // eslint-disable-next-line no-await-in-loop
      const [rows] = await db.query(`SELECT * FROM \`${name}\` ORDER BY ${order} LIMIT ? OFFSET ?`, [BATCH, offset]);
      if (!rows.length) break;
      res.write(rows.map((r) => columns.map((c) => (redacted.has(c) ? '[REDACTED]' : csvCell(r[c]))).join(',')).join('\r\n') + '\r\n');
      if (rows.length < BATCH) break;
    }
    res.end();
  } catch (error) {
    console.error('exportTable error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Server error exporting table' });
    else res.end();
  }
};

// GET /api/export/data-dictionary — every column of every table, as CSV.
export const dataDictionary = async (req, res) => {
  try {
    const schema = await schemaName();
    const [rows] = await db.query(
      `SELECT c.TABLE_NAME, c.ORDINAL_POSITION, c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_KEY, c.COLUMN_DEFAULT, c.EXTRA, c.COLUMN_COMMENT,
              k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME
         FROM information_schema.COLUMNS c
         LEFT JOIN information_schema.KEY_COLUMN_USAGE k
           ON k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL
        WHERE c.TABLE_SCHEMA = ? ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`, [schema]);
    const head = ['table', 'position', 'column', 'type', 'nullable', 'key', 'default', 'extra', 'comment', 'references'];
    const lines = rows.map((r) => [r.TABLE_NAME, r.ORDINAL_POSITION, r.COLUMN_NAME, r.COLUMN_TYPE, r.IS_NULLABLE, r.COLUMN_KEY, r.COLUMN_DEFAULT,
      r.EXTRA, r.COLUMN_COMMENT, r.REFERENCED_TABLE_NAME ? `${r.REFERENCED_TABLE_NAME}.${r.REFERENCED_COLUMN_NAME}` : ''].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="data-dictionary-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\uFEFF${head.join(',')}\r\n${lines.join('\r\n')}`);
  } catch (error) {
    console.error('dataDictionary error:', error);
    res.status(500).json({ success: false, message: 'Server error building the data dictionary' });
  }
};

// Every route registered on the Express app, with its mount path — the API
// catalogue. Express 4 keeps mount paths only as regexps on router layers.
const mountPath = (layer) => {
  if (!layer.regexp || layer.regexp.fast_slash) return '';
  const m = layer.regexp.source.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)$/);
  return m ? `/${m[1].replace(/\\\//g, '/')}` : '';
};

export function apiCatalogue(app) {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]).map((m) => m.toUpperCase());
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const p of paths) for (const method of methods) out.push({ method, path: `${prefix}${p}`.replace(/\/+/g, '/') });
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + mountPath(layer));
      }
    }
  };
  walk(app._router?.stack || [], '');
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
