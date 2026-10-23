// Builds the generated appendices of the interface specification and the data dictionary from
// the code and the live database, so they never drift from the system:
//   node scripts/generate-doc-appendices.mjs [outDir]      (default ../docs/generated)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../config/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'docs', 'generated'));
fs.mkdirSync(out, { recursive: true });

// ── API endpoints: server.js mounts × each route file ────────────────────────────────────────
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
// identifier → { file, variable }: a default import is the file's `router`; a named import is the variable of that name.
const imports = {};
for (const m of server.matchAll(/import\s+([^;]+?)\s+from\s+'\.\/routes\/([\w.]+)'/g)) {
  const [, spec, file] = m;
  const def = spec.match(/^(\w+)/)?.[1];
  if (def && !spec.startsWith('{')) imports[def] = { file, variable: 'router' };
  for (const n of (spec.match(/\{([^}]*)\}/)?.[1] || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const [orig, alias] = n.split(/\s+as\s+/); imports[alias || orig] = { file, variable: orig };
  }
}
const mounts = [...server.matchAll(/app\.use\(\s*'([^']+)'\s*,\s*(\w+)(?:\(app\))?\s*\)/g)].map((m) => ({ prefix: m[1], ...(imports[m[2]] || {}) })).filter((m) => m.file);
const rows = [];
const rolesOf = (txt) => txt.replace(/['"]/g, '').split(',').map((x) => x.trim()).filter(Boolean);
for (const { prefix, file, variable } of mounts) {
  const src = fs.readFileSync(path.join(root, 'routes', file), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const guards = {};
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*authorizeRole\(\s*\[([^\]]*)\]/g)) guards[m[1]] = rolesOf(m[2]);
  const v = variable;
  const loginAt = src.search(new RegExp(`\\b${v}\\.use\\(\\s*authenticateToken`));
  const fileWide = src.match(new RegExp(`\\b${v}\\.use\\(\\s*authorizeRole\\(\\s*\\[([^\\]]*)\\]`));
  const fileWideRoles = fileWide ? rolesOf(fileWide[1]) : null;
  const re = new RegExp(`\\b${v}\\.(get|post|put|patch|delete)\\(\\s*['"\`]([^'"\`]*)['"\`]([^\\n]*)`, 'g');
  for (const m of src.matchAll(re)) {
    const rest = m[3];
    let access = (loginAt !== -1 && m.index > loginAt) || /authenticateToken/.test(rest) ? 'Signed-in user' : 'Public / own check';
    if (/deviceKey|DeviceKey/i.test(rest)) access = 'Device key or signed-in user';
    const inline = rest.match(/authorizeRole\(\s*\[([^\]]*)\]/);
    const named = Object.keys(guards).find((g) => new RegExp(`\\b${g}\\b`).test(rest));
    const roles = inline ? rolesOf(inline[1]) : named ? guards[named] : (fileWideRoles && access !== 'Public / own check' ? fileWideRoles : fileWideRoles && loginAt === -1 ? fileWideRoles : null);
    if (roles) access = 'Roles: ' + roles.join(', ');
    rows.push({ method: m[1].toUpperCase(), path: `${prefix}/${m[2]}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1'), access, module: prefix.split('/').filter(Boolean).slice(1).join('/') || '(root)' });
  }
}
rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
let md = `# Appendix — API endpoint index\n\nGenerated ${new Date().toISOString().slice(0, 10)} from the route files (${rows.length} endpoints). Access is as declared in code; business rules inside a handler (for example facility scoping) apply in addition.\n`;
let cur = '';
for (const r of rows) {
  if (r.module !== cur) { cur = r.module; md += `\n## ${cur === '(root)' ? 'Root-level endpoints' : '/api/' + cur}\n\n| Method | Path | Access |\n|---|---|---|\n`; }
  md += `| ${r.method} | ${r.path} | ${r.access} |\n`;
}
fs.writeFileSync(path.join(out, 'api-endpoints.md'), md);

// ── Data dictionary ──────────────────────────────────────────────────────────────────────────
const [[{ s }]] = await db.query('SELECT DATABASE() AS s');
const [cols] = await db.query(
  `SELECT c.TABLE_NAME t, c.COLUMN_NAME n, c.COLUMN_TYPE ty, c.IS_NULLABLE nu, c.COLUMN_KEY k, c.COLUMN_DEFAULT df, c.COLUMN_COMMENT cm, k.REFERENCED_TABLE_NAME rt, k.REFERENCED_COLUMN_NAME rc
     FROM information_schema.COLUMNS c LEFT JOIN information_schema.KEY_COLUMN_USAGE k
       ON k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL
    WHERE c.TABLE_SCHEMA = ? ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`, [s]);
const MODULES = [[/^(patients?|visits?|abha|appointments?)/, 'Patients & registration'], [/^(bills?|bill_|payment|invoice|free_scheme|billing|tests?_price)/, 'Billing & payments'],
  [/^(lab_|sample|critical|qc_|eqas|report|unmapped|analyzer|machine)/, 'Laboratory'], [/^(equipment|infrastructure)/, 'Equipment'],
  [/^(inventory|stock|vendor|purchase)/, 'Inventory'], [/^(users?|staff|roles?|duty|device_keys?|dsc|login|password|sessions?)/, 'Users, access & signing'],
  [/^(system_audit|audit|sync_integrity|privilege)/, 'Audit & governance'], [/^(branches|districts|states|departments|org)/, 'Organisation'],
  [/^(disease|surveillance|disaster)/, 'Surveillance'], [/^(queue|token|kiosk)/, 'Queue & kiosk']];
const moduleOf = (t) => MODULES.find(([re]) => re.test(t))?.[1] || 'Other';
const byTable = {};
for (const c of cols) (byTable[c.t] ||= []).push(c);
const groups = {};
for (const t of Object.keys(byTable)) (groups[moduleOf(t)] ||= []).push(t);
let dd = `# Appendix — Data dictionary\n\nGenerated ${new Date().toISOString().slice(0, 10)} from the database schema: ${Object.keys(byTable).length} tables, ${cols.length} columns.\n`;
for (const g of Object.keys(groups).sort()) {
  dd += `\n## ${g}\n`;
  for (const t of groups[g].sort()) {
    dd += `\n### ${t}\n\n| Column | Type | Null | Key | Default | Refers to |\n|---|---|---|---|---|---|\n`;
    for (const c of byTable[t]) dd += `| ${c.n} | ${c.ty} | ${c.nu === 'YES' ? 'yes' : 'no'} | ${c.k || ''} | ${c.df ?? ''} | ${c.rt ? `${c.rt}.${c.rc}` : ''} |\n`;
  }
}
fs.writeFileSync(path.join(out, 'data-dictionary.md'), dd);
console.log(`${rows.length} endpoints, ${Object.keys(byTable).length} tables → ${out}`);
process.exit(0);
