import db from '../config/db.js';
import * as F from '../utils/fhirMapper.js';

// HL7 FHIR R4 read API (tender #83, #87) mounted at /api/fhir. Read and search only; a credential
// sees exactly the facilities it would see in the application (state → all, district → own
// district, facility → own facility, integration key → its facility).

const FHIR_JSON = 'application/fhir+json; charset=utf-8';
const MAX_COUNT = 100;

const send = (res, status, body) => res.status(status).set('Content-Type', FHIR_JSON).send(JSON.stringify(body));
const problem = (res, status, code, text) => send(res, status, F.operationOutcome(status >= 500 ? 'fatal' : 'error', code, text));

// Facility ids this caller may read; null means every facility.
async function allowedBranches(req) {
  const level = req.user?.role_level;
  if (req.user?.isDeviceKey) return req.user.branch_id ? [Number(req.user.branch_id)] : [0];
  if (level === 'Central') return null;
  const [[own]] = await db.query('SELECT id, district_id FROM branches WHERE id = ?', [req.user?.branch_id]);
  if (!own) return [0];
  if (level === 'Sub-Central' && own.district_id) {
    const [rows] = await db.query('SELECT id FROM branches WHERE district_id = ?', [own.district_id]);
    return rows.map((r) => r.id);
  }
  return [own.id];
}

// A search parameter value may be "system|value"; the system part is ignored, the value is matched.
const tokenValue = (v) => String(v ?? '').split('|').pop().trim();
const bad = (msg) => Object.assign(new Error(msg), { status: 400, fhir: true });

function dateClause(col, raw, wholeDay = true) {
  const m = String(raw).match(/^(eq|ne|gt|lt|ge|le)?(\d{4}-\d{2}-\d{2})(?:T[\d:.]+Z?)?$/);
  if (!m) throw bad(`Invalid date parameter "${raw}".`);
  const [, op = 'eq', day] = m;
  const c = wholeDay ? `DATE(${col})` : col;
  const sql = { eq: `${c} = ?`, ne: `${c} <> ?`, gt: `${c} > ?`, lt: `${c} < ?`, ge: `${c} >= ?`, le: `${c} <= ?` }[op];
  return { sql, params: [day] };
}

function paging(req) {
  const count = Math.min(MAX_COUNT, Math.max(1, Number(req.query._count) || 20));
  const page = Math.max(1, Number(req.query._page) || 1);
  return { count, page, offset: (page - 1) * count };
}
const selfUrl = (req) => `${req.baseUrl}${req.path}?${new URLSearchParams(Object.entries(req.query).filter(([, v]) => typeof v === 'string')).toString()}`;
const nextUrl = (req, page, has) => {
  if (!has) return undefined;
  const q = new URLSearchParams(Object.entries(req.query).filter(([, v]) => typeof v === 'string'));
  q.set('_page', String(page + 1));
  return `${req.baseUrl}${req.path}?${q.toString()}`;
};

const handler = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e.fhir) return problem(res, e.status || 400, 'invalid', e.message);
    console.error('FHIR error:', e);
    return problem(res, 500, 'exception', 'The server could not complete the request.');
  }
};

const scopeSql = (ids, col) => (ids ? { sql: `AND ${col} IN (?)`, params: [ids.length ? ids : [0]] } : { sql: '', params: [] });

// ── Patient ──────────────────────────────────────────────────────────────────────────────────
async function searchPatients(req, ids) {
  const where = ['1=1']; const params = [];
  const s = scopeSql(ids, 'p.branch_id'); where.push(s.sql.replace(/^AND /, '') || '1=1'); params.push(...s.params);
  const q = req.query;
  if (q._id) { where.push('p.id = ?'); params.push(Number(q._id) || 0); }
  if (q.identifier) { const v = tokenValue(q.identifier); where.push('(p.reg_no = ? OR p.abha_id = ? OR p.abha_address = ?)'); params.push(v, v, v); }
  if (q.name) { where.push("CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name) LIKE ?"); params.push(`%${q.name}%`); }
  if (q.family) { where.push('p.last_name LIKE ?'); params.push(`${q.family}%`); }
  if (q.given) { where.push('(p.first_name LIKE ? OR p.middle_name LIKE ?)'); params.push(`${q.given}%`, `${q.given}%`); }
  if (q.gender) { where.push('LOWER(p.gender) = ?'); params.push(tokenValue(q.gender).toLowerCase()); }
  if (q.birthdate) { const d = dateClause('p.dob', q.birthdate); where.push(d.sql); params.push(...d.params); }
  if (q.phone) { const digits = tokenValue(q.phone).replace(/\D/g, '').slice(-10); where.push("RIGHT(REGEXP_REPLACE(COALESCE(p.telephone, ''), '[^0-9]', ''), 10) = ?"); params.push(digits); }
  return { where: where.join(' AND '), params };
}

const listResource = (table, build, mapper) => handler(async (req, res) => {
  const ids = await allowedBranches(req);
  const { count, page, offset } = paging(req);
  const { sql, params, countSql } = await build(req, ids);
  const [[{ n }]] = await db.query(countSql, params);
  const [rows] = await db.query(`${sql} LIMIT ? OFFSET ?`, [...params, count, offset]);
  const resources = await mapper(rows, req);
  send(res, 200, F.searchBundle({ resources, total: Number(n), selfUrl: selfUrl(req), nextUrl: nextUrl(req, page, offset + rows.length < Number(n)) }));
});

export const patients = listResource('patients', async (req, ids) => {
  const { where, params } = await searchPatients(req, ids);
  return { sql: `SELECT p.* FROM patients p WHERE ${where} ORDER BY p.id`, countSql: `SELECT COUNT(*) AS n FROM patients p WHERE ${where}`, params };
}, (rows) => rows.map(F.patient));

export const patientRead = handler(async (req, res) => {
  const ids = await allowedBranches(req);
  const s = scopeSql(ids, 'branch_id');
  const [[row]] = await db.query(`SELECT * FROM patients WHERE id = ? ${s.sql}`, [Number(req.params.id) || 0, ...s.params]);
  if (!row) return problem(res, 404, 'not-found', 'Patient not found.');
  send(res, 200, F.patient(row));
});

// ── ServiceRequest ───────────────────────────────────────────────────────────────────────────
const SR_FROM = `FROM bill_items bi JOIN bills b ON b.id = bi.bill_id LEFT JOIN lab_tests lt ON lt.id = bi.service_id`;
const SR_COLS = `bi.id, bi.service_name, bi.service_code, bi.status, bi.lab_barcode, bi.short_id, bi.sample_id, bi.created_at, bi.updated_at,
  b.patient_id, b.patient_name, b.branch_id, b.priority, b.referring_clinician, b.clinical_notes, b.created_at AS bill_created_at,
  lt.test_code, lt.loinc_code, lt.loinc_display`;

function srWhere(req, ids) {
  const where = ["bi.service_type = 'Laboratory'"]; const params = [];
  const s = scopeSql(ids, 'b.branch_id'); if (s.sql) { where.push(s.sql.replace(/^AND /, '')); params.push(...s.params); }
  const q = req.query;
  if (q._id) { where.push('bi.id = ?'); params.push(Number(q._id) || 0); }
  if (q.patient) { where.push('b.patient_id = ?'); params.push(Number(String(q.patient).replace(/^Patient\//, '')) || 0); }
  if (q.status) {
    const items = tokenValue(q.status).split(',').flatMap((st) => F.srStatusToItemStatuses(st.trim()));
    where.push('bi.status IN (?)'); params.push(items.length ? items : ['__none__']);
  }
  if (q.authored) { const d = dateClause('b.created_at', q.authored); where.push(d.sql); params.push(...d.params); }
  if (q.identifier) { const v = tokenValue(q.identifier); where.push('(bi.lab_barcode = ? OR bi.short_id = ? OR bi.sample_id = ?)'); params.push(v, v, v); }
  if (q.code) { const v = tokenValue(q.code); where.push('(lt.loinc_code = ? OR lt.test_code = ? OR bi.service_code = ?)'); params.push(v, v, v); }
  return { where: where.join(' AND '), params };
}

export const serviceRequests = listResource('bill_items', async (req, ids) => {
  const { where, params } = srWhere(req, ids);
  return { sql: `SELECT ${SR_COLS} ${SR_FROM} WHERE ${where} ORDER BY bi.id`, countSql: `SELECT COUNT(*) AS n ${SR_FROM} WHERE ${where}`, params };
}, (rows) => rows.map(F.serviceRequest));

export const serviceRequestRead = handler(async (req, res) => {
  const ids = await allowedBranches(req);
  const { where, params } = srWhere({ query: { _id: req.params.id } }, ids);
  const [[row]] = await db.query(`SELECT ${SR_COLS} ${SR_FROM} WHERE ${where}`, params);
  if (!row) return problem(res, 404, 'not-found', 'ServiceRequest not found.');
  send(res, 200, F.serviceRequest(row));
});

// ── Specimen ─────────────────────────────────────────────────────────────────────────────────
const SP_FROM = `FROM lab_samples ls
  LEFT JOIN (SELECT sample_id, MIN(id) AS request_id, MIN(bill_id) AS bill_id, MIN(service_id) AS service_id FROM bill_items WHERE sample_id IS NOT NULL GROUP BY sample_id) bi ON bi.sample_id = ls.sample_id
  LEFT JOIN bills b ON b.id = bi.bill_id LEFT JOIN lab_tests lt ON lt.id = bi.service_id`;
const SP_COLS = `ls.sample_id, ls.stage, ls.parent_sample_id, ls.collected_at, ls.received_at, ls.updated_at, b.patient_id, bi.request_id, lt.sample_type, lt.tube_color`;

function spWhere(req, ids) {
  const where = ['1=1']; const params = [];
  const s = scopeSql(ids, 'ls.branch_id'); if (s.sql) { where.push(s.sql.replace(/^AND /, '')); params.push(...s.params); }
  if (req.query._id) { where.push('ls.sample_id = ?'); params.push(String(req.query._id)); }
  if (req.query.identifier) { where.push('ls.sample_id = ?'); params.push(tokenValue(req.query.identifier)); }
  if (req.query.patient) { where.push('b.patient_id = ?'); params.push(Number(String(req.query.patient).replace(/^Patient\//, '')) || 0); }
  return { where: where.join(' AND '), params };
}
export const specimens = listResource('lab_samples', async (req, ids) => {
  const { where, params } = spWhere(req, ids);
  return { sql: `SELECT ${SP_COLS} ${SP_FROM} WHERE ${where} ORDER BY ls.sample_id`, countSql: `SELECT COUNT(*) AS n ${SP_FROM} WHERE ${where}`, params };
}, (rows) => rows.map(F.specimen));
export const specimenRead = handler(async (req, res) => {
  const ids = await allowedBranches(req);
  const { where, params } = spWhere({ query: { _id: req.params.id } }, ids);
  const [[row]] = await db.query(`SELECT ${SP_COLS} ${SP_FROM} WHERE ${where}`, params);
  if (!row) return problem(res, 404, 'not-found', 'Specimen not found.');
  send(res, 200, F.specimen(row));
});

// ── DiagnosticReport and Observation (both come from lab_test_result) ────────────────────────
const LR_FROM = `FROM lab_test_result tr
  LEFT JOIN lab_tests lt ON lt.id = tr.test_id
  LEFT JOIN bill_items bi ON bi.id = tr.bill_item_id LEFT JOIN bills b ON b.id = bi.bill_id`;
const LR_COLS = `tr.id, tr.sample_id, tr.test_name, tr.results_json, tr.status, tr.tested_at, tr.verified_at, tr.approved_at, tr.updated_at, tr.branch_id, tr.has_critical,
  tr.bill_item_id, COALESCE(tr.patient_id, b.patient_id) AS patient_id, lt.test_code, lt.loinc_code, lt.loinc_display`;
const REPORT_STATUS_TO_DB = { final: ['Approved'], preliminary: ['Test Done', 'Verified'], registered: ['Pending'] };

function lrWhere(req, ids) {
  const where = ['1=1']; const params = [];
  const s = scopeSql(ids, 'tr.branch_id'); if (s.sql) { where.push(s.sql.replace(/^AND /, '')); params.push(...s.params); }
  const q = req.query;
  if (q._id) { where.push('tr.id = ?'); params.push(Number(String(q._id).split('-')[0]) || 0); }
  if (q.patient) { where.push('COALESCE(tr.patient_id, b.patient_id) = ?'); params.push(Number(String(q.patient).replace(/^Patient\//, '')) || 0); }
  if (q.status) {
    const dbs = tokenValue(q.status).split(',').flatMap((st) => REPORT_STATUS_TO_DB[st.trim()] || []);
    where.push('tr.status IN (?)'); params.push(dbs.length ? dbs : ['__none__']);
  }
  if (q.date) { const d = dateClause('tr.tested_at', q.date); where.push(d.sql); params.push(...d.params); }
  if (q.identifier) { where.push('tr.sample_id = ?'); params.push(tokenValue(q.identifier)); }
  if (q.code && req.fhirResource === 'DiagnosticReport') { const v = tokenValue(q.code); where.push('(lt.loinc_code = ? OR lt.test_code = ?)'); params.push(v, v); }
  return { where: where.join(' AND '), params };
}
const paramsOf = (row) => {
  try { const v = typeof row.results_json === 'string' ? JSON.parse(row.results_json) : row.results_json; return Array.isArray(v) ? v : []; } catch { return []; }
};

export const diagnosticReports = (req, res, next) => { req.fhirResource = 'DiagnosticReport'; return listResource('lab_test_result', async (rq, ids) => {
  const { where, params } = lrWhere(rq, ids);
  return { sql: `SELECT ${LR_COLS} ${LR_FROM} WHERE ${where} ORDER BY tr.id`, countSql: `SELECT COUNT(*) AS n ${LR_FROM} WHERE ${where}`, params };
}, (rows) => rows.map((r) => F.diagnosticReport(r, paramsOf(r))))(req, res, next); };

export const diagnosticReportRead = handler(async (req, res) => {
  const ids = await allowedBranches(req);
  const { where, params } = lrWhere({ query: { _id: req.params.id } }, ids);
  const [[row]] = await db.query(`SELECT ${LR_COLS} ${LR_FROM} WHERE ${where}`, params);
  if (!row) return problem(res, 404, 'not-found', 'DiagnosticReport not found.');
  send(res, 200, F.diagnosticReport(row, paramsOf(row)));
});

export const observations = handler(async (req, res) => {
  const ids = await allowedBranches(req);
  const { count, page, offset } = paging(req);
  const { where, params } = lrWhere(req, ids);
  const code = req.query.code ? tokenValue(req.query.code).toLowerCase() : null;
  // Paged by result row (one row carries many parameters), so no total is reported.
  const [rows] = await db.query(`SELECT ${LR_COLS} ${LR_FROM} WHERE ${where} ORDER BY tr.id LIMIT ? OFFSET ?`, [...params, count, offset]);
  const resources = [];
  for (const row of rows) paramsOf(row).forEach((p, i) => { if (!code || String(p.parameter_name).toLowerCase() === code) resources.push(F.observation(row, p, i)); });
  const bundle = F.searchBundle({ resources, total: undefined, selfUrl: selfUrl(req), nextUrl: nextUrl(req, page, rows.length === count) });
  send(res, 200, bundle);
});

export const observationRead = handler(async (req, res) => {
  const parsed = F.parseObservationId(req.params.id);
  if (!parsed) return problem(res, 404, 'not-found', 'Observation not found.');
  const ids = await allowedBranches(req);
  const { where, params } = lrWhere({ query: { _id: String(parsed.resultId) } }, ids);
  const [[row]] = await db.query(`SELECT ${LR_COLS} ${LR_FROM} WHERE ${where}`, params);
  const p = row && paramsOf(row)[parsed.index];
  if (!p) return problem(res, 404, 'not-found', 'Observation not found.');
  send(res, 200, F.observation(row, p, parsed.index));
});

// ── Organization ─────────────────────────────────────────────────────────────────────────────
const ORG_FROM = 'FROM branches b LEFT JOIN districts d ON d.id = b.district_id';
function orgWhere(req, ids) {
  const where = ['1=1']; const params = [];
  const s = scopeSql(ids, 'b.id'); if (s.sql) { where.push(s.sql.replace(/^AND /, '')); params.push(...s.params); }
  if (req.query._id) { where.push('b.id = ?'); params.push(Number(req.query._id) || 0); }
  if (req.query.name) { where.push('b.branch_name LIKE ?'); params.push(`%${req.query.name}%`); }
  if (req.query.identifier) { where.push('b.hospital_code = ?'); params.push(tokenValue(req.query.identifier)); }
  return { where: where.join(' AND '), params };
}
export const organizations = listResource('branches', async (req, ids) => {
  const { where, params } = orgWhere(req, ids);
  return { sql: `SELECT b.id, b.branch_name, b.hospital_code, b.status, d.name AS district ${ORG_FROM} WHERE ${where} ORDER BY b.id`, countSql: `SELECT COUNT(*) AS n ${ORG_FROM} WHERE ${where}`, params };
}, (rows) => rows.map(F.organization));
export const organizationRead = handler(async (req, res) => {
  const ids = await allowedBranches(req);
  const { where, params } = orgWhere({ query: { _id: req.params.id } }, ids);
  const [[row]] = await db.query(`SELECT b.id, b.branch_name, b.hospital_code, b.status, d.name AS district ${ORG_FROM} WHERE ${where}`, params);
  if (!row) return problem(res, 404, 'not-found', 'Organization not found.');
  send(res, 200, F.organization(row));
});

// ── Patient/$everything ──────────────────────────────────────────────────────────────────────
export const patientEverything = handler(async (req, res) => {
  const ids = await allowedBranches(req);
  const pid = Number(req.params.id) || 0;
  const s = scopeSql(ids, 'branch_id');
  const [[p]] = await db.query(`SELECT * FROM patients WHERE id = ? ${s.sql}`, [pid, ...s.params]);
  if (!p) return problem(res, 404, 'not-found', 'Patient not found.');
  const sr = srWhere({ query: { patient: String(pid) } }, ids);
  const [reqs] = await db.query(`SELECT ${SR_COLS} ${SR_FROM} WHERE ${sr.where} ORDER BY bi.id LIMIT 500`, sr.params);
  const lr = lrWhere({ query: { patient: String(pid) } }, ids);
  const [results] = await db.query(`SELECT ${LR_COLS} ${LR_FROM} WHERE ${lr.where} ORDER BY tr.id LIMIT 500`, lr.params);
  const sp = spWhere({ query: { patient: String(pid) } }, ids);
  const [samples] = await db.query(`SELECT ${SP_COLS} ${SP_FROM} WHERE ${sp.where} ORDER BY ls.sample_id LIMIT 500`, sp.params);
  const resources = [F.patient(p), ...reqs.map(F.serviceRequest), ...samples.map(F.specimen)];
  for (const r of results) {
    const ps = paramsOf(r);
    resources.push(F.diagnosticReport(r, ps), ...ps.map((x, i) => F.observation(r, x, i)));
  }
  send(res, 200, F.searchBundle({ resources, total: resources.length, selfUrl: selfUrl(req) }));
});

// ── Capability statement (public) ────────────────────────────────────────────────────────────
export const metadata = (req, res) => send(res, 200, F.capabilityStatement(`${req.protocol}://${req.get('host')}${req.baseUrl}`));
