import db from '../config/db.js';
import { flagResult, qcCurrent } from '../utils/poct.js';

// Point-of-care testing (tender #123): bedside devices such as glucometers and rapid-test readers.
// A result can only be recorded by a certified operator on a device whose quality control is
// current; otherwise it needs a reason, which stays with the result.

const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? Number(req.user.branch_id) : null);
const myBranch = (req) => Number(req.user?.branch_id) || null;
const scopeBranch = (req) => pinned(req) || (Number(req.query.branch_id) || null);
const fail = (res, e, what) => { console.error(`${what}:`, e); res.status(500).json({ success: false, message: `Server error ${what}` }); };
const bad = (res, message, status = 422, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const nn = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

async function deviceFor(req, id) {
  const b = pinned(req);
  const [[d]] = await db.query(`SELECT * FROM poct_devices WHERE id = ? ${b ? 'AND branch_id = ?' : ''}`, [id, ...(b ? [b] : [])]);
  return d;
}

export const listDevices = async (req, res) => {
  try {
    const b = scopeBranch(req);
    const [rows] = await db.query(
      `SELECT d.*,
              (SELECT JSON_OBJECT('passed', q.passed, 'performed_at', q.performed_at, 'level', q.level) FROM poct_qc q WHERE q.device_id = d.id ORDER BY q.performed_at DESC, q.id DESC LIMIT 1) AS latest_qc,
              (SELECT COUNT(*) FROM poct_operators o WHERE o.device_id = d.id AND o.certified_until >= CURDATE()) AS certified_operators
         FROM poct_devices d WHERE 1=1 ${b ? 'AND d.branch_id = ?' : ''} ORDER BY d.status, d.name`, b ? [b] : []);
    const devices = rows.map((d) => {
      const latest = typeof d.latest_qc === 'string' ? JSON.parse(d.latest_qc) : d.latest_qc;
      return { ...d, latest_qc: latest, qc: qcCurrent(latest ? { passed: !!latest.passed, performed_at: latest.performed_at } : null, d.qc_interval_hours) };
    });
    res.json({ success: true, devices });
  } catch (e) { fail(res, e, 'loading devices'); }
};

export const saveDevice = async (req, res) => {
  try {
    const d = req.body || {};
    if (!String(d.name || '').trim()) return bad(res, 'A device name is required.');
    const vals = [String(d.name).trim().slice(0, 120), String(d.model || '').slice(0, 120) || null, String(d.serial_no || '').slice(0, 80) || null, String(d.location || '').slice(0, 120) || null,
      String(d.tests || '').slice(0, 500) || null, d.status === 'Inactive' ? 'Inactive' : 'Active', Math.min(168, Math.max(1, Number(d.qc_interval_hours) || 24))];
    if (req.params.id) {
      const cur = await deviceFor(req, req.params.id);
      if (!cur) return res.status(404).json({ success: false, message: 'Device not found.' });
      await db.query('UPDATE poct_devices SET name=?, model=?, serial_no=?, location=?, tests=?, status=?, qc_interval_hours=? WHERE id = ?', [...vals, cur.id]);
      return res.json({ success: true });
    }
    const [r] = await db.query('INSERT INTO poct_devices (name, model, serial_no, location, tests, status, qc_interval_hours, branch_id) VALUES (?,?,?,?,?,?,?,?)', [...vals, myBranch(req)]);
    res.status(201).json({ success: true, id: r.insertId });
  } catch (e) { fail(res, e, 'saving the device'); }
};

export const listOperators = async (req, res) => {
  try {
    const d = await deviceFor(req, req.params.id);
    if (!d) return res.status(404).json({ success: false, message: 'Device not found.' });
    const [rows] = await db.query(
      `SELECT o.id, o.user_id, o.certified_until, CONCAT_WS(' ', u.first_name, u.last_name) AS name FROM poct_operators o JOIN users u ON u.id = o.user_id WHERE o.device_id = ? ORDER BY name`, [d.id]);
    res.json({ success: true, operators: rows });
  } catch (e) { fail(res, e, 'loading operators'); }
};

export const certifyOperator = async (req, res) => {
  try {
    const d = await deviceFor(req, req.params.id);
    if (!d) return res.status(404).json({ success: false, message: 'Device not found.' });
    const until = req.body?.certified_until;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until || '') || !Number(req.body?.user_id)) return bad(res, 'Choose a staff member and a certification end date.');
    const [[u]] = await db.query('SELECT id FROM users WHERE id = ? AND branch_id = ?', [req.body.user_id, d.branch_id]);
    if (!u) return bad(res, 'That staff member is not at this facility.');
    await db.query('INSERT INTO poct_operators (device_id, user_id, certified_until) VALUES (?,?,?) ON DUPLICATE KEY UPDATE certified_until = VALUES(certified_until)', [d.id, u.id, until]);
    res.json({ success: true });
  } catch (e) { fail(res, e, 'saving the certification'); }
};

export const removeOperator = async (req, res) => {
  try {
    const d = await deviceFor(req, req.params.id);
    if (!d) return res.status(404).json({ success: false, message: 'Device not found.' });
    await db.query('DELETE FROM poct_operators WHERE device_id = ? AND user_id = ?', [d.id, Number(req.params.userId) || 0]);
    res.json({ success: true });
  } catch (e) { fail(res, e, 'removing the certification'); }
};

export const recordQc = async (req, res) => {
  try {
    const d = await deviceFor(req, req.params.id);
    if (!d) return res.status(404).json({ success: false, message: 'Device not found.' });
    const q = req.body || {};
    if (!String(q.level || '').trim() || typeof q.passed !== 'boolean') return bad(res, 'Record the control level and whether it passed.');
    await db.query('INSERT INTO poct_qc (device_id, level, lot_no, expected, observed, passed, note, performed_by) VALUES (?,?,?,?,?,?,?,?)',
      [d.id, String(q.level).slice(0, 30), String(q.lot_no || '').slice(0, 60) || null, String(q.expected || '').slice(0, 60) || null, String(q.observed || '').slice(0, 60) || null, q.passed ? 1 : 0, String(q.note || '').slice(0, 250) || null, req.user?.id || null]);
    res.status(201).json({ success: true });
  } catch (e) { fail(res, e, 'recording quality control'); }
};

export const listQc = async (req, res) => {
  try {
    const d = await deviceFor(req, req.params.id);
    if (!d) return res.status(404).json({ success: false, message: 'Device not found.' });
    const [rows] = await db.query('SELECT q.*, CONCAT_WS(" ", u.first_name, u.last_name) AS by_name FROM poct_qc q LEFT JOIN users u ON u.id = q.performed_by WHERE q.device_id = ? ORDER BY q.performed_at DESC, q.id DESC LIMIT 100', [d.id]);
    res.json({ success: true, qc: rows });
  } catch (e) { fail(res, e, 'loading quality control'); }
};

// POST /results
export const recordResult = async (req, res) => {
  try {
    const r = req.body || {};
    const d = await deviceFor(req, r.device_id);
    if (!d || d.status !== 'Active') return bad(res, 'Choose an active device at this facility.');
    if (!String(r.patient_name || '').trim() || !String(r.test_name || '').trim() || String(r.value ?? '').trim() === '') return bad(res, 'Patient, test and result are required.');

    // 1. Is this person certified to use this device? (If nobody is listed the device is open to all staff.)
    const [ops] = await db.query('SELECT user_id, certified_until FROM poct_operators WHERE device_id = ?', [d.id]);
    if (ops.length) {
      const mine = ops.find((o) => o.user_id === req.user?.id);
      if (!mine || new Date(mine.certified_until) < new Date(new Date().toDateString())) return bad(res, 'You are not currently certified to use this device.', 403);
    }
    // 2. Is the device's quality control current?
    const [[latest]] = await db.query('SELECT passed, performed_at FROM poct_qc WHERE device_id = ? ORDER BY performed_at DESC, id DESC LIMIT 1', [d.id]);
    const qc = qcCurrent(latest ? { passed: !!latest.passed, performed_at: latest.performed_at } : null, d.qc_interval_hours);
    const override = String(r.qc_override_reason || '').trim();
    if (!qc.ok && !override) return bad(res, qc.reason, 409, { qc_required: true });

    const limits = { ref_low: nn(r.ref_low), ref_high: nn(r.ref_high), crit_low: nn(r.crit_low), crit_high: nn(r.crit_high) };
    const flag = flagResult(r.value, limits);
    const [[u]] = await db.query("SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [req.user?.id || 0]);
    const [ins] = await db.query(
      `INSERT INTO poct_results (branch_id, device_id, patient_id, patient_name, test_name, lot_no, value, unit, ref_low, ref_high, crit_low, crit_high, flag, qc_override_reason, comment, performed_by, performed_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [d.branch_id, d.id, Number(r.patient_id) || null, String(r.patient_name).trim().slice(0, 160), String(r.test_name).trim().slice(0, 120), String(r.lot_no || '').slice(0, 60) || null,
        String(r.value).trim().slice(0, 60), String(r.unit || '').slice(0, 30) || null, limits.ref_low, limits.ref_high, limits.crit_low, limits.crit_high, flag,
        qc.ok ? null : override.slice(0, 250), String(r.comment || '').slice(0, 250) || null, req.user?.id || null, u?.name || null]);
    res.status(201).json({ success: true, id: ins.insertId, flag, critical: flag.startsWith('Critical'), qc_warning: qc.ok ? null : qc.reason });
  } catch (e) { fail(res, e, 'saving the result'); }
};

export const listResults = async (req, res) => {
  try {
    const b = scopeBranch(req);
    const where = ['1=1']; const params = [];
    if (b) { where.push('r.branch_id = ?'); params.push(b); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) { where.push('DATE(r.performed_at) >= ?'); params.push(req.query.from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) { where.push('DATE(r.performed_at) <= ?'); params.push(req.query.to); }
    if (req.query.device_id) { where.push('r.device_id = ?'); params.push(Number(req.query.device_id) || 0); }
    if (req.query.flag) { where.push('r.flag = ?'); params.push(req.query.flag); }
    if (req.query.q) { where.push('(r.patient_name LIKE ? OR r.test_name LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    const [rows] = await db.query(
      `SELECT r.*, d.name AS device_name FROM poct_results r JOIN poct_devices d ON d.id = r.device_id WHERE ${where.join(' AND ')} ORDER BY r.performed_at DESC, r.id DESC LIMIT 500`, params);
    res.json({ success: true, results: rows });
  } catch (e) { fail(res, e, 'loading results'); }
};
