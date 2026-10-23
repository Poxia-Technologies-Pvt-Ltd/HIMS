import db from '../config/db.js';
import * as bb from '../utils/bloodBank.js';

// Blood bank (tender #123): donors and donations, mandatory infection screening, component
// preparation, stock, requests, compatibility-checked issue, outcome and transfusion reactions.
// Every state change is also written to the audit trail by the application-wide middleware.

const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? Number(req.user.branch_id) : null);
const myBranch = (req) => Number(req.user?.branch_id) || null;
const scopeBranch = (req) => pinned(req) || (Number(req.query.branch_id) || null);
const fail = (res, e, what) => { console.error(`${what}:`, e); res.status(500).json({ success: false, message: `Server error ${what}` }); };
const bad = (res, message, extra = {}) => res.status(422).json({ success: false, message, ...extra });
const actor = (req) => Number(req.user?.id) || null;
const p2 = (n) => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;

async function sweepExpired(branch) {
  await db.query(`UPDATE bb_units SET status = 'Expired' WHERE expires_at < NOW() AND status IN ('Quarantine','Available','Reserved') ${branch ? 'AND branch_id = ?' : ''}`, branch ? [branch] : []);
}

// Numbers that must never repeat: retried on a clash.
async function withNumber(make, insert) {
  for (let i = 0; i < 6; i++) {
    const no = await make(i);
    try { return await insert(no); } catch (e) { if (e.code !== 'ER_DUP_ENTRY' || i === 5) throw e; }
  }
  return null;
}
const nextNo = async (table, col, prefix) => {
  const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} LIKE ?`, [`${prefix}%`]);
  return n;
};

// ── Overview ─────────────────────────────────────────────────────────────────────────────────
export const summary = async (req, res) => {
  try {
    const b = scopeBranch(req); await sweepExpired(b);
    const w = b ? 'AND branch_id = ?' : ''; const pr = b ? [b] : [];
    const [stock] = await db.query(`SELECT component, abo, rh, COUNT(*) AS n FROM bb_units WHERE status = 'Available' ${w} GROUP BY component, abo, rh`, pr);
    const [[c]] = await db.query(
      `SELECT SUM(status = 'Quarantine') AS quarantine, SUM(status = 'Available' AND expires_at < NOW() + INTERVAL 3 DAY) AS near_expiry,
              SUM(status = 'Reserved') AS reserved FROM bb_units WHERE 1=1 ${w}`, pr);
    const [[rq]] = await db.query(`SELECT SUM(status IN ('Requested','Ready','Partly issued')) AS open_requests, SUM(status IN ('Requested','Ready','Partly issued') AND urgency = 'Emergency') AS emergency FROM bb_requests WHERE 1=1 ${w}`, pr);
    const [[mo]] = await db.query(`SELECT COUNT(*) AS donations FROM bb_units WHERE parent_unit_id IS NULL AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') ${w}`, pr);
    res.json({ success: true, stock, quarantine: Number(c.quarantine || 0), near_expiry: Number(c.near_expiry || 0), reserved: Number(c.reserved || 0),
      open_requests: Number(rq.open_requests || 0), emergency: Number(rq.emergency || 0), donations_this_month: Number(mo.donations || 0) });
  } catch (e) { fail(res, e, 'loading the blood bank overview'); }
};

// ── Donors and donations ─────────────────────────────────────────────────────────────────────
export const listDonors = async (req, res) => {
  try {
    const b = scopeBranch(req); const q = String(req.query.q || '').trim();
    const [rows] = await db.query(
      `SELECT * FROM bb_donors WHERE 1=1 ${b ? 'AND branch_id = ?' : ''} ${q ? 'AND (donor_no = ? OR phone LIKE ? OR CONCAT_WS(" ", first_name, last_name) LIKE ?)' : ''} ORDER BY id DESC LIMIT 200`,
      [...(b ? [b] : []), ...(q ? [q, `%${q}%`, `%${q}%`] : [])]);
    res.json({ success: true, donors: rows });
  } catch (e) { fail(res, e, 'loading donors'); }
};

export const createDonor = async (req, res) => {
  try {
    const d = req.body || {};
    if (!String(d.first_name || '').trim() || !d.dob || !d.gender) return bad(res, 'Name, gender and date of birth are required.');
    const branch = myBranch(req);
    const id = await withNumber(
      async () => `D${branch}-${ymd()}-${String((await nextNo('bb_donors', 'donor_no', `D${branch}-${ymd()}`)) + 1).padStart(3, '0')}`,
      async (no) => {
        const [r] = await db.query(
          'INSERT INTO bb_donors (donor_no, first_name, last_name, gender, dob, phone, address, abo, rh, branch_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [no, String(d.first_name).trim(), String(d.last_name || '').trim() || null, d.gender, d.dob, String(d.phone || '').trim() || null, String(d.address || '').trim() || null,
            ['A', 'B', 'AB', 'O'].includes(d.abo) ? d.abo : 'Unknown', ['Pos', 'Neg'].includes(d.rh) ? d.rh : 'Unknown', branch, actor(req)]);
        return r.insertId;
      });
    res.status(201).json({ success: true, id });
  } catch (e) { fail(res, e, 'registering the donor'); }
};

export const deferDonor = async (req, res) => {
  try {
    const until = req.body?.until; const reason = String(req.body?.reason || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until || '') || !reason) return bad(res, 'A date and a reason are required.');
    const b = pinned(req);
    const [r] = await db.query(`UPDATE bb_donors SET deferred_until = ?, deferral_reason = ? WHERE id = ? ${b ? 'AND branch_id = ?' : ''}`, [until, reason.slice(0, 250), req.params.id, ...(b ? [b] : [])]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Donor not found.' });
    res.json({ success: true });
  } catch (e) { fail(res, e, 'deferring the donor'); }
};

// POST /donations { donor_id, hb, weight, systolic, diastolic, pulse, volume_ml }
export const recordDonation = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const b = pinned(req);
    const [[donor]] = await conn.query(`SELECT * FROM bb_donors WHERE id = ? ${b ? 'AND branch_id = ?' : ''}`, [req.body?.donor_id, ...(b ? [b] : [])]);
    if (!donor) return res.status(404).json({ success: false, message: 'Donor not found.' });
    const v = {}; for (const k of ['hb', 'weight', 'systolic', 'diastolic', 'pulse']) v[k] = req.body?.[k] === '' || req.body?.[k] == null ? null : Number(req.body[k]);
    const problems = bb.donorProblems(donor, v);
    if (problems.length) return bad(res, 'This donor cannot give blood today.', { problems });
    const now = new Date(); const branch = myBranch(req);
    const id = await withNumber(
      async () => `BB-${branch}-${ymd(now)}-${String((await nextNo('bb_units', 'unit_no', `BB-${branch}-${ymd(now)}-`)) + 1).padStart(4, '0')}`,
      async (no) => {
        await conn.beginTransaction();
        try {
          const [r] = await conn.query(
            `INSERT INTO bb_units (unit_no, donor_id, component, abo, rh, volume_ml, collected_at, expires_at, status, screening_json, branch_id, created_by)
             VALUES (?, ?, 'Whole Blood', ?, ?, ?, ?, ?, 'Quarantine', ?, ?, ?)`,
            [no, donor.id, donor.abo, donor.rh, Number(req.body?.volume_ml) || 450, now, bb.expiryFor('Whole Blood', now), JSON.stringify(v), branch, actor(req)]);
          await conn.query('UPDATE bb_donors SET last_donation_date = CURDATE() WHERE id = ?', [donor.id]);
          await conn.commit();
          return { id: r.insertId, no };
        } catch (e) { await conn.rollback(); throw e; }
      });
    res.status(201).json({ success: true, unit_id: id.id, unit_no: id.no, message: 'Donation recorded. The unit stays in quarantine until screening is complete.' });
  } catch (e) { fail(res, e, 'recording the donation'); } finally { conn.release(); }
};

// ── Units ────────────────────────────────────────────────────────────────────────────────────
export const listUnits = async (req, res) => {
  try {
    const b = scopeBranch(req); await sweepExpired(b);
    const where = ['1=1']; const params = [];
    if (b) { where.push('u.branch_id = ?'); params.push(b); }
    for (const [k, col] of [['status', 'u.status'], ['component', 'u.component'], ['abo', 'u.abo'], ['rh', 'u.rh']]) if (req.query[k]) { where.push(`${col} = ?`); params.push(req.query[k]); }
    if (req.query.q) { where.push('u.unit_no LIKE ?'); params.push(`%${req.query.q}%`); }
    const [rows] = await db.query(
      `SELECT u.*, CONCAT_WS(' ', d.first_name, d.last_name) AS donor_name, d.donor_no FROM bb_units u LEFT JOIN bb_donors d ON d.id = u.donor_id
        WHERE ${where.join(' AND ')} ORDER BY u.expires_at ASC LIMIT 500`, params);
    res.json({ success: true, units: rows });
  } catch (e) { fail(res, e, 'loading units'); }
};

async function loadUnit(conn, req, id, forUpdate = false) {
  const b = pinned(req);
  const [[u]] = await conn.query(`SELECT * FROM bb_units WHERE id = ? ${b ? 'AND branch_id = ?' : ''} ${forUpdate ? 'FOR UPDATE' : ''}`, [id, ...(b ? [b] : [])]);
  return u;
}

// POST /units/:id/screening { hiv, hbv, hcv, syphilis, malaria, abo, rh }
export const recordScreening = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const u = await loadUnit(conn, req, req.params.id, true);
    if (!u) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Unit not found.' }); }
    if (u.parent_unit_id) { await conn.rollback(); return bad(res, 'Screening is recorded on the donation (the original unit), not on a component.'); }
    const results = {}; for (const t of bb.TTI_TESTS) results[t] = String(req.body?.[t] || '').trim();
    const abo = ['A', 'B', 'AB', 'O'].includes(req.body?.abo) ? req.body.abo : u.abo;
    const rh = ['Pos', 'Neg'].includes(req.body?.rh) ? req.body.rh : u.rh;
    const tti = bb.ttiOutcome(results);
    const groupKnown = abo !== 'Unknown' && rh !== 'Unknown';
    const status = tti === 'Reactive' ? 'Discarded' : (tti === 'Cleared' && groupKnown && u.status === 'Quarantine' ? 'Available' : u.status);
    // the donation and every component made from it share the same screening and group; each row
    // changes status by its own state (a separated parent stays "Used", its components become Available)
    await conn.query(
      `UPDATE bb_units SET tti_json = ?, tti_status = ?, abo = ?, rh = ?,
              discard_reason = CASE WHEN ? = 'Reactive' AND status IN ('Quarantine','Available','Reserved') THEN 'Infection screening reactive' ELSE discard_reason END,
              status = CASE WHEN status IN ('Issued','Used','Expired','Discarded') THEN status
                            WHEN ? = 'Reactive' THEN 'Discarded'
                            WHEN ? = 'Cleared' AND ? = 1 AND status = 'Quarantine' THEN 'Available'
                            ELSE status END
        WHERE id = ? OR parent_unit_id = ?`, [JSON.stringify(results), tti, abo, rh, tti, tti, tti, groupKnown ? 1 : 0, u.id, u.id]);
    if (tti === 'Reactive' && u.donor_id) await conn.query("UPDATE bb_donors SET deferred_until = '2099-12-31', deferral_reason = 'Reactive screening result — counsel and refer' WHERE id = ?", [u.donor_id]);
    await conn.commit();
    res.json({ success: true, tti_status: tti, status, message: tti === 'Reactive' ? 'Reactive: the unit and its components are discarded and the donor is deferred.' : tti === 'Cleared' ? (groupKnown ? 'Cleared: the unit is available for issue.' : 'Cleared, but the blood group is not confirmed yet.') : 'Saved. All five tests are needed before the unit can be released.' });
  } catch (e) { await conn.rollback().catch(() => {}); fail(res, e, 'recording the screening'); } finally { conn.release(); }
};

// POST /units/:id/process { components: ['PRBC','FFP','Platelets'] }
const SUFFIX = { PRBC: 'R', FFP: 'F', Platelets: 'P', Cryoprecipitate: 'C' };
export const processUnit = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const wanted = [...new Set(req.body?.components || [])].filter((c) => bb.PROCESSABLE.includes(c));
    if (!wanted.length) return bad(res, 'Choose at least one component to prepare.');
    await conn.beginTransaction();
    const u = await loadUnit(conn, req, req.params.id, true);
    if (!u) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Unit not found.' }); }
    if (u.component !== 'Whole Blood' || !['Quarantine', 'Available'].includes(u.status)) { await conn.rollback(); return bad(res, 'Only a whole-blood unit that has not been issued or discarded can be separated.'); }
    const made = [];
    for (const c of wanted) {
      const no = `${u.unit_no}-${SUFFIX[c]}`;
      const status = u.tti_status === 'Cleared' && u.abo !== 'Unknown' && u.rh !== 'Unknown' ? 'Available' : 'Quarantine';
      // eslint-disable-next-line no-await-in-loop
      const [r] = await conn.query(
        `INSERT INTO bb_units (unit_no, donor_id, parent_unit_id, component, abo, rh, volume_ml, collected_at, expires_at, status, tti_status, tti_json, branch_id, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [no, u.donor_id, u.id, c, u.abo, u.rh, c === 'PRBC' ? 280 : c === 'Platelets' ? 60 : c === 'FFP' ? 200 : 30, u.collected_at, bb.expiryFor(c, u.collected_at), status, u.tti_status, u.tti_json ? JSON.stringify(u.tti_json) : null, u.branch_id, actor(req)]);
      made.push({ id: r.insertId, unit_no: no, component: c, status });
    }
    await conn.query("UPDATE bb_units SET status = 'Used', discard_reason = 'Separated into components' WHERE id = ?", [u.id]);
    await conn.commit();
    res.status(201).json({ success: true, components: made });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e.code === 'ER_DUP_ENTRY') return bad(res, 'Components have already been prepared from this unit.');
    fail(res, e, 'preparing components');
  } finally { conn.release(); }
};

export const discardUnit = async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return bad(res, 'A reason is required.');
    const b = pinned(req);
    const [r] = await db.query(`UPDATE bb_units SET status = 'Discarded', discard_reason = ? WHERE id = ? AND status IN ('Quarantine','Available','Reserved') ${b ? 'AND branch_id = ?' : ''}`, [reason.slice(0, 250), req.params.id, ...(b ? [b] : [])]);
    if (!r.affectedRows) return bad(res, 'This unit cannot be discarded (it is already issued, used, discarded or expired).');
    res.json({ success: true });
  } catch (e) { fail(res, e, 'discarding the unit'); }
};

// ── Requests and issue ───────────────────────────────────────────────────────────────────────
export const listRequests = async (req, res) => {
  try {
    const b = scopeBranch(req);
    const open = req.query.open === '1';
    const [rows] = await db.query(
      `SELECT r.*, (SELECT COUNT(*) FROM bb_issues i WHERE i.request_id = r.id AND i.outcome <> 'Returned') AS issued_units
         FROM bb_requests r WHERE 1=1 ${b ? 'AND r.branch_id = ?' : ''} ${open ? "AND r.status IN ('Requested','Ready','Partly issued')" : ''}
        ORDER BY FIELD(r.urgency,'Emergency','Urgent','Routine'), r.id DESC LIMIT 300`, b ? [b] : []);
    res.json({ success: true, requests: rows });
  } catch (e) { fail(res, e, 'loading requests'); }
};

export const createRequest = async (req, res) => {
  try {
    const d = req.body || {};
    if (!String(d.patient_name || '').trim() || !bb.COMPONENTS.includes(d.component)) return bad(res, 'Patient name and component are required.');
    const branch = myBranch(req);
    const id = await withNumber(
      async () => `REQ-${branch}-${ymd()}-${String((await nextNo('bb_requests', 'request_no', `REQ-${branch}-${ymd()}-`)) + 1).padStart(3, '0')}`,
      async (no) => {
        const [r] = await db.query(
          `INSERT INTO bb_requests (request_no, patient_id, patient_name, patient_abo, patient_rh, ward, clinician, component, units_requested, urgency, indication, branch_id, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [no, Number(d.patient_id) || null, String(d.patient_name).trim().slice(0, 160), ['A', 'B', 'AB', 'O'].includes(d.patient_abo) ? d.patient_abo : 'Unknown', ['Pos', 'Neg'].includes(d.patient_rh) ? d.patient_rh : 'Unknown',
            String(d.ward || '').slice(0, 80) || null, String(d.clinician || '').slice(0, 120) || null, d.component, Math.min(10, Math.max(1, Number(d.units_requested) || 1)),
            ['Routine', 'Urgent', 'Emergency'].includes(d.urgency) ? d.urgency : 'Routine', String(d.indication || '').slice(0, 250) || null, branch, actor(req)]);
        return r.insertId;
      });
    res.status(201).json({ success: true, id });
  } catch (e) { fail(res, e, 'saving the request'); }
};

export const cancelRequest = async (req, res) => {
  try {
    const b = pinned(req);
    const [r] = await db.query(`UPDATE bb_requests SET status = 'Cancelled' WHERE id = ? AND status IN ('Requested','Ready') ${b ? 'AND branch_id = ?' : ''}`, [req.params.id, ...(b ? [b] : [])]);
    if (!r.affectedRows) return bad(res, 'Only a request that has not had blood issued can be cancelled.');
    res.json({ success: true });
  } catch (e) { fail(res, e, 'cancelling the request'); }
};

// GET /requests/:id/units — what in stock can go to this patient, best first (identical group, then earliest expiry)
export const suitableUnits = async (req, res) => {
  try {
    const b = pinned(req); await sweepExpired(b);
    const [[rq]] = await db.query(`SELECT * FROM bb_requests WHERE id = ? ${b ? 'AND branch_id = ?' : ''}`, [req.params.id, ...(b ? [b] : [])]);
    if (!rq) return res.status(404).json({ success: false, message: 'Request not found.' });
    const [units] = await db.query("SELECT * FROM bb_units WHERE branch_id = ? AND component = ? AND status IN ('Available','Reserved') AND tti_status = 'Cleared' AND expires_at > NOW() ORDER BY expires_at", [rq.branch_id, rq.component]);
    const recipient = { abo: rq.patient_abo, rh: rq.patient_rh };
    const rank = { identical: 0, compatible: 1 };
    const list = units.map((u) => ({ ...u, compat: bb.compatibility(u, recipient) })).filter((u) => u.compat.ok)
      .sort((a, c) => rank[a.compat.level] - rank[c.compat.level] || new Date(a.expires_at) - new Date(c.expires_at));
    res.json({ success: true, units: list, recipient_group_known: recipient.abo !== 'Unknown' && recipient.rh !== 'Unknown' });
  } catch (e) { fail(res, e, 'finding units'); }
};

// POST /requests/:id/issue { unit_id, crossmatch, issued_to, override_reason }
export const issueUnit = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const b = pinned(req);
    const { unit_id, crossmatch, issued_to } = req.body || {};
    const override = String(req.body?.override_reason || '').trim();
    if (!['Compatible', 'Incompatible', 'Not done (emergency)'].includes(crossmatch)) return bad(res, 'Record the cross-match result.');
    if (crossmatch === 'Incompatible') return bad(res, 'An incompatible cross-match cannot be issued.');
    await conn.beginTransaction();
    const [[rq]] = await conn.query(`SELECT * FROM bb_requests WHERE id = ? ${b ? 'AND branch_id = ?' : ''} FOR UPDATE`, [req.params.id, ...(b ? [b] : [])]);
    if (!rq) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Request not found.' }); }
    if (['Issued', 'Cancelled'].includes(rq.status)) { await conn.rollback(); return bad(res, `This request is already ${rq.status.toLowerCase()}.`); }
    const u = await loadUnit(conn, req, unit_id, true);
    if (!u || u.branch_id !== rq.branch_id) { await conn.rollback(); return bad(res, 'Choose a unit from this blood bank.'); }
    if (!bb.ISSUABLE.has(u.status)) { await conn.rollback(); return bad(res, `This unit is ${u.status.toLowerCase()} and cannot be issued.`); }
    if (new Date(u.expires_at) <= new Date()) { await conn.rollback(); return bad(res, 'This unit has expired.'); }
    if (u.tti_status !== 'Cleared') { await conn.rollback(); return bad(res, 'Infection screening is not complete for this unit.'); }
    if (u.component !== rq.component) { await conn.rollback(); return bad(res, `This request is for ${rq.component}, not ${u.component}.`); }
    const compat = bb.compatibility(u, { abo: rq.patient_abo, rh: rq.patient_rh });
    let overridden = null;
    if (!compat.ok) {
      // The one exception: an emergency with the patient's group not yet known, using O-negative red cells.
      const universal = ['Whole Blood', 'PRBC'].includes(u.component) && u.abo === 'O' && u.rh === 'Neg';
      const unknownGroup = rq.patient_abo === 'Unknown' || rq.patient_rh === 'Unknown';
      if (rq.urgency === 'Emergency' && crossmatch === 'Not done (emergency)' && unknownGroup && universal && override) overridden = override;
      else { await conn.rollback(); return bad(res, compat.reason, { incompatible: true }); }
    }
    if (crossmatch === 'Not done (emergency)' && (rq.urgency !== 'Emergency' || !override)) { await conn.rollback(); return bad(res, 'Issuing without a cross-match is only for an emergency request, with the reason recorded.'); }
    await conn.query("UPDATE bb_units SET status = 'Issued' WHERE id = ?", [u.id]);
    const [ins] = await conn.query('INSERT INTO bb_issues (request_id, unit_id, crossmatch, override_reason, issued_to, issued_by, branch_id) VALUES (?,?,?,?,?,?,?)',
      [rq.id, u.id, crossmatch, overridden || (crossmatch === 'Not done (emergency)' ? override : null), String(issued_to || '').slice(0, 120) || null, actor(req), rq.branch_id]);
    const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM bb_issues WHERE request_id = ? AND outcome <> 'Returned'", [rq.id]);
    await conn.query('UPDATE bb_requests SET status = ? WHERE id = ?', [n >= rq.units_requested ? 'Issued' : 'Partly issued', rq.id]);
    await conn.commit();
    res.status(201).json({ success: true, issue_id: ins.insertId, warnings: compat.warnings || [], message: `Unit ${u.unit_no} issued.` });
  } catch (e) { await conn.rollback().catch(() => {}); fail(res, e, 'issuing the unit'); } finally { conn.release(); }
};

export const listIssues = async (req, res) => {
  try {
    const b = scopeBranch(req);
    const [rows] = await db.query(
      `SELECT i.*, u.unit_no, u.component, u.abo, u.rh, r.request_no, r.patient_name FROM bb_issues i JOIN bb_units u ON u.id = i.unit_id JOIN bb_requests r ON r.id = i.request_id
        WHERE 1=1 ${b ? 'AND i.branch_id = ?' : ''} ${req.query.pending === '1' ? "AND i.outcome = 'Issued'" : ''} ORDER BY i.id DESC LIMIT 300`, b ? [b] : []);
    res.json({ success: true, issues: rows });
  } catch (e) { fail(res, e, 'loading issues'); }
};

// POST /issues/:id/outcome { outcome: 'Transfused' | 'Returned' | 'Wasted', notes }
export const setOutcome = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const outcome = req.body?.outcome;
    if (!['Transfused', 'Returned', 'Wasted'].includes(outcome)) return bad(res, 'Choose Transfused, Returned or Wasted.');
    const b = pinned(req);
    await conn.beginTransaction();
    const [[i]] = await conn.query(`SELECT * FROM bb_issues WHERE id = ? ${b ? 'AND branch_id = ?' : ''} FOR UPDATE`, [req.params.id, ...(b ? [b] : [])]);
    if (!i) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Issue not found.' }); }
    if (i.outcome !== 'Issued') { await conn.rollback(); return bad(res, 'The outcome of this unit has already been recorded.'); }
    let final = outcome; let note = String(req.body?.notes || '').slice(0, 250) || null; let unitStatus = outcome === 'Transfused' ? 'Used' : 'Discarded';
    if (outcome === 'Returned') {
      const minutes = (Date.now() - new Date(i.issued_at).getTime()) / 60000;
      // outside the controlled cold chain for more than 30 minutes → cannot be used again
      if (minutes > 30) { final = 'Wasted'; unitStatus = 'Discarded'; note = `Returned after ${Math.round(minutes)} minutes (limit 30); cold chain not assured.`; } else unitStatus = 'Available';
    }
    await conn.query('UPDATE bb_issues SET outcome = ?, outcome_at = NOW(), notes = ? WHERE id = ?', [final, note, i.id]);
    await conn.query('UPDATE bb_units SET status = ?, discard_reason = ? WHERE id = ?', [unitStatus, unitStatus === 'Discarded' ? (note || 'Wasted') : null, i.unit_id]);
    if (final === 'Returned') await conn.query("UPDATE bb_requests SET status = 'Partly issued' WHERE id = ? AND status = 'Issued'", [i.request_id]);
    await conn.commit();
    res.json({ success: true, outcome: final, message: final !== outcome ? 'Recorded as wasted: the unit was out of the cold chain for more than 30 minutes.' : 'Saved.' });
  } catch (e) { await conn.rollback().catch(() => {}); fail(res, e, 'recording the outcome'); } finally { conn.release(); }
};

export const reportReaction = async (req, res) => {
  try {
    const d = req.body || {}; const b = pinned(req);
    if (!String(d.reaction_type || '').trim() || !['Mild', 'Moderate', 'Severe', 'Fatal'].includes(d.severity)) return bad(res, 'Reaction type and severity are required.');
    const [[i]] = await db.query(`SELECT i.*, r.patient_name FROM bb_issues i JOIN bb_requests r ON r.id = i.request_id WHERE i.id = ? ${b ? 'AND i.branch_id = ?' : ''}`, [d.issue_id, ...(b ? [b] : [])]);
    if (!i) return res.status(404).json({ success: false, message: 'Issue not found.' });
    await db.query('INSERT INTO bb_reactions (issue_id, unit_id, patient_name, reaction_type, severity, details, reported_by, branch_id) VALUES (?,?,?,?,?,?,?,?)',
      [i.id, i.unit_id, i.patient_name, String(d.reaction_type).slice(0, 80), d.severity, String(d.details || '').slice(0, 480) || null, actor(req), i.branch_id]);
    res.status(201).json({ success: true });
  } catch (e) { fail(res, e, 'recording the reaction'); }
};

export const listReactions = async (req, res) => {
  try {
    const b = scopeBranch(req);
    const [rows] = await db.query(`SELECT x.*, u.unit_no FROM bb_reactions x JOIN bb_units u ON u.id = x.unit_id WHERE 1=1 ${b ? 'AND x.branch_id = ?' : ''} ORDER BY x.id DESC LIMIT 200`, b ? [b] : []);
    res.json({ success: true, reactions: rows });
  } catch (e) { fail(res, e, 'loading reactions'); }
};
