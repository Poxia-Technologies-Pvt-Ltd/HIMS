import db from '../config/db.js';
import { normalizeRole } from '../middleware/auth.js';
import {
  HR_ADMIN_ROLES, ROSTER_ROLES, readScope, writeScope, inScope, isISODate, isTime, isPeriod, nowIST, addDays,
  daysInMonth, getHrSettings, employeeForUser, distanceMetres, fail,
} from '../utils/hr.js';
import { computeAttendance } from '../utils/attendanceCalc.js';

const canSeeTeam = (req) => [...HR_ADMIN_ROLES, ...ROSTER_ROLES].includes(normalizeRole(req.user?.role));

const periodBounds = (period) => [`${period}-01`, `${period}-${String(daysInMonth(period)).padStart(2, '0')}`];

// A finalised payroll freezes attendance for that month.
const payrollLocked = async (branchId, date) => {
  const [[run]] = await db.query(
    `SELECT status FROM payroll_runs WHERE branch_id = ? AND period = ? AND status <> 'Draft'`,
    [branchId, date.slice(0, 7)]
  );
  return !!run;
};

// The duty day an IN punch belongs to: today, unless a night duty that started
// yesterday is still running.
const attendanceDateForIn = async (empId, now) => {
  const [[night]] = await db.query(
    `SELECT id FROM roster_entries
      WHERE employee_id = ? AND duty_date = ? AND status = 'Scheduled' AND end_time <= start_time AND ? < end_time`,
    [empId, addDays(now.date, -1), now.time]
  );
  return night ? addDays(now.date, -1) : now.date;
};

const lastOpenIn = async (empId) => {
  const [[last]] = await db.query(
    `SELECT id, punch_type, DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
            DATE_FORMAT(punched_at, '%Y-%m-%d %H:%i:%s') AS punched_at
       FROM attendance_punches WHERE employee_id = ? ORDER BY punched_at DESC, id DESC LIMIT 1`,
    [empId]
  );
  return last;
};

// An IN left open longer than this is a forgotten punch, not an ongoing duty.
const MAX_OPEN_HOURS = 20;

// GET /api/attendance/me/today
export const myToday = async (req, res) => {
  try {
    const emp = await employeeForUser(req.user.id);
    if (!emp) return fail(res, 404, 'No employee record is linked to your login');
    const now = nowIST();
    const last = await lastOpenIn(emp.id);
    const openHours = last?.punch_type === 'IN' ? (Date.parse(now.datetime.replace(' ', 'T')) - Date.parse(last.punched_at.replace(' ', 'T'))) / 3600000 : null;
    const isOpen = last?.punch_type === 'IN' && openHours < MAX_OPEN_HOURS;
    const [punches] = await db.query(
      `SELECT id, punch_type, DATE_FORMAT(punched_at, '%Y-%m-%d %H:%i:%s') AS punched_at, source, distance_m
         FROM attendance_punches WHERE employee_id = ? AND attendance_date = ? ORDER BY punched_at`,
      [emp.id, isOpen ? last.attendance_date : now.date]
    );
    const [duties] = await db.query(
      `SELECT r.duty_type, TIME_FORMAT(r.start_time, '%H:%i') AS start_time, TIME_FORMAT(r.end_time, '%H:%i') AS end_time,
              i.name AS room_name, s.name AS shift_name
         FROM roster_entries r LEFT JOIN infrastructure i ON i.id = r.room_id LEFT JOIN shifts s ON s.id = r.shift_id
        WHERE r.employee_id = ? AND r.duty_date = ? AND r.status = 'Scheduled' ORDER BY r.start_time`,
      [emp.id, now.date]
    );
    const settings = await getHrSettings(emp.branch_id);
    const [[branch]] = await db.query('SELECT branch_name, latitude, longitude FROM branches WHERE id = ?', [emp.branch_id]);
    res.json({
      success: true,
      employee: { id: emp.id, name: `${emp.first_name} ${emp.last_name}`, employee_code: emp.employee_code },
      now: now.datetime,
      next_action: isOpen ? 'OUT' : 'IN',
      open_since: isOpen ? last.punched_at : null,
      punches,
      duties,
      geofence: {
        enforced: settings.geofence_radius_m !== null && branch?.latitude !== null && branch?.latitude !== undefined,
        radius_m: settings.geofence_radius_m,
        facility: branch?.branch_name,
      },
    });
  } catch (e) {
    console.error('myToday error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/attendance/punch { latitude, longitude, accuracy, source }
export const punch = async (req, res) => {
  try {
    const emp = await employeeForUser(req.user.id);
    if (!emp) return fail(res, 404, 'No employee record is linked to your login');
    if (emp.status !== 'Active') return fail(res, 403, 'Your employee record is not active');
    const now = nowIST();
    const lat = req.body.latitude === undefined || req.body.latitude === null ? null : Number(req.body.latitude);
    const lng = req.body.longitude === undefined || req.body.longitude === null ? null : Number(req.body.longitude);
    if ((lat !== null && (Number.isNaN(lat) || Math.abs(lat) > 90)) || (lng !== null && (Number.isNaN(lng) || Math.abs(lng) > 180))) {
      return fail(res, 400, 'Invalid location');
    }

    // Geo-fence: when the facility has coordinates and a radius, the punch must come from inside it.
    const settings = await getHrSettings(emp.branch_id);
    const [[branch]] = await db.query('SELECT latitude, longitude FROM branches WHERE id = ?', [emp.branch_id]);
    let distance = null;
    if (branch?.latitude !== null && branch?.latitude !== undefined && lat !== null && lng !== null) {
      distance = distanceMetres(Number(branch.latitude), Number(branch.longitude), lat, lng);
    }
    if (settings.geofence_radius_m !== null && branch?.latitude !== null && branch?.latitude !== undefined) {
      if (distance === null) return fail(res, 400, 'Location is required to mark attendance. Allow location access and try again.');
      const accuracy = Math.min(Number(req.body.accuracy) || 0, 100);
      if (distance - accuracy > settings.geofence_radius_m) {
        return fail(res, 403, `You are ${distance} m from the facility. Attendance can be marked only within ${settings.geofence_radius_m} m.`, { distance_m: distance });
      }
    }

    const last = await lastOpenIn(emp.id);
    const openHours = last?.punch_type === 'IN' ? (Date.parse(now.datetime.replace(' ', 'T')) - Date.parse(last.punched_at.replace(' ', 'T'))) / 3600000 : null;
    const type = last?.punch_type === 'IN' && openHours < MAX_OPEN_HOURS ? 'OUT' : 'IN';
    // Guard against a double tap.
    if (last && (Date.parse(now.datetime.replace(' ', 'T')) - Date.parse(last.punched_at.replace(' ', 'T'))) < 60000) {
      return fail(res, 429, 'You just punched. Wait a minute before punching again.');
    }
    const attDate = type === 'OUT' ? last.attendance_date : await attendanceDateForIn(emp.id, now);
    if (await payrollLocked(emp.branch_id, attDate)) return fail(res, 409, 'Payroll for this month is already finalised');

    const source = req.body.source === 'Mobile' ? 'Mobile' : 'Web';
    await db.query(
      `INSERT INTO attendance_punches (branch_id, employee_id, attendance_date, punch_type, punched_at, source,
                                       latitude, longitude, accuracy_m, distance_m, ip_address, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp.branch_id, emp.id, attDate, type, now.datetime, source, lat, lng,
        req.body.accuracy ? Math.round(Number(req.body.accuracy)) : null, distance, req.ip || null, req.user.id]
    );
    res.status(201).json({ success: true, punch_type: type, punched_at: now.datetime, attendance_date: attDate, distance_m: distance });
  } catch (e) {
    console.error('punch error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/attendance/me?period=YYYY-MM
export const myMonth = async (req, res) => {
  try {
    const emp = await employeeForUser(req.user.id);
    if (!emp) return fail(res, 404, 'No employee record is linked to your login');
    const period = isPeriod(req.query.period) ? req.query.period : nowIST().date.slice(0, 7);
    const [from, to] = periodBounds(period);
    const calc = (await computeAttendance([emp.id], from, to)).get(emp.id);
    res.json({ success: true, period, ...calc });
  } catch (e) {
    console.error('myMonth error:', e);
    fail(res, 500, 'Server error');
  }
};

const activeEmployees = async (req, extraWhere = '', extraParams = []) => {
  const scope = readScope(req);
  const params = [];
  let where = `WHERE e.status = 'Active'`;
  if (scope) { where += ' AND e.branch_id = ?'; params.push(scope); }
  const [rows] = await db.query(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.designation, e.staff_category, e.department_id,
            d.name AS department_name, e.branch_id
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
       ${where} ${extraWhere} ORDER BY d.name, e.first_name`,
    [...params, ...extraParams]
  );
  return rows;
};

// GET /api/attendance/register?date=YYYY-MM-DD&department_id — one day, everyone.
export const dailyRegister = async (req, res) => {
  try {
    if (!canSeeTeam(req)) return fail(res, 403, 'Access denied');
    const date = isISODate(req.query.date) ? req.query.date : nowIST().date;
    const emps = await activeEmployees(req, req.query.department_id ? 'AND e.department_id = ?' : '', req.query.department_id ? [req.query.department_id] : []);
    const calc = await computeAttendance(emps.map((e) => e.id), date, date);
    const rows = emps.map((e) => ({ ...e, ...(calc.get(e.id)?.days[0] || {}) }));
    const tally = {};
    rows.forEach((r) => { tally[r.status] = (tally[r.status] || 0) + 1; });
    res.json({ success: true, date, rows, tally });
  } catch (e) {
    console.error('dailyRegister error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/attendance/monthly?period=YYYY-MM&employee_id — summary for all, or day-by-day for one.
export const monthlyReport = async (req, res) => {
  try {
    if (!canSeeTeam(req)) return fail(res, 403, 'Access denied');
    const period = isPeriod(req.query.period) ? req.query.period : nowIST().date.slice(0, 7);
    const [from, to] = periodBounds(period);
    if (req.query.employee_id) {
      const [[emp]] = await db.query(
        `SELECT e.id, e.branch_id, e.employee_code, e.first_name, e.last_name, e.designation FROM employees e WHERE e.id = ?`,
        [req.query.employee_id]
      );
      if (!emp || !inScope(req, emp.branch_id)) return fail(res, 404, 'Employee not found');
      const calc = (await computeAttendance([emp.id], from, to)).get(emp.id);
      const [punches] = await db.query(
        `SELECT id, DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date, punch_type,
                DATE_FORMAT(punched_at, '%Y-%m-%d %H:%i:%s') AS punched_at, source, distance_m, note
           FROM attendance_punches WHERE employee_id = ? AND attendance_date BETWEEN ? AND ? ORDER BY punched_at`,
        [emp.id, from, to]
      );
      return res.json({ success: true, period, employee: emp, ...calc, punches, locked: await payrollLocked(emp.branch_id, from) });
    }
    const emps = await activeEmployees(req);
    const calc = await computeAttendance(emps.map((e) => e.id), from, to);
    res.json({ success: true, period, rows: emps.map((e) => ({ ...e, ...(calc.get(e.id)?.summary || {}) })) });
  } catch (e) {
    console.error('monthlyReport error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/attendance/manual { employee_id, date, in_time?, out_time?, note }
// HR correction for a missed or wrong punch. An out_time earlier than in_time
// is taken as the next morning (night duty).
export const manualPunch = async (req, res) => {
  try {
    const { employee_id, date, in_time, out_time } = req.body;
    const note = String(req.body.note || '').trim().slice(0, 255);
    if (!employee_id || !isISODate(date)) return fail(res, 400, 'Employee and date are required');
    if (!in_time && !out_time) return fail(res, 400, 'Give an in time, an out time or both');
    if ((in_time && !isTime(in_time)) || (out_time && !isTime(out_time))) return fail(res, 400, 'Times must be HH:MM');
    if (!note) return fail(res, 400, 'Give the reason for the correction');
    if (date > nowIST().date) return fail(res, 400, 'Cannot record attendance for a future date');
    const [[emp]] = await db.query('SELECT id, branch_id FROM employees WHERE id = ?', [employee_id]);
    if (!emp || !inScope(req, emp.branch_id)) return fail(res, 404, 'Employee not found');
    if (await payrollLocked(emp.branch_id, date)) return fail(res, 409, 'Payroll for this month is already finalised');

    const rows = [];
    const t = (x) => (x.length === 5 ? `${x}:00` : x);
    if (in_time) rows.push([emp.branch_id, emp.id, date, 'IN', `${date} ${t(in_time)}`, 'Manual', note, req.user.id]);
    if (out_time) {
      const outDate = in_time && out_time <= in_time ? addDays(date, 1) : date;
      rows.push([emp.branch_id, emp.id, date, 'OUT', `${outDate} ${t(out_time)}`, 'Manual', note, req.user.id]);
    }
    await db.query(
      `INSERT INTO attendance_punches (branch_id, employee_id, attendance_date, punch_type, punched_at, source, note, created_by) VALUES ?`,
      [rows]
    );
    res.status(201).json({ success: true, added: rows.length });
  } catch (e) {
    console.error('manualPunch error:', e);
    fail(res, 500, 'Server error');
  }
};

// DELETE /api/attendance/punch/:id
export const deletePunch = async (req, res) => {
  try {
    const [[p]] = await db.query(
      `SELECT id, branch_id, DATE_FORMAT(attendance_date, '%Y-%m-%d') AS d FROM attendance_punches WHERE id = ?`,
      [req.params.id]
    );
    if (!p || !inScope(req, p.branch_id)) return fail(res, 404, 'Punch not found');
    if (await payrollLocked(p.branch_id, p.d)) return fail(res, 409, 'Payroll for this month is already finalised');
    await db.query('DELETE FROM attendance_punches WHERE id = ?', [p.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('deletePunch error:', e);
    fail(res, 500, 'Server error');
  }
};

// ── HR settings (attendance + payroll rules) ──────────────────────────────────

// GET /api/attendance/settings
export const getSettings = async (req, res) => {
  try {
    const branchId = writeScope(req);
    const settings = await getHrSettings(branchId);
    const [[own]] = await db.query('SELECT branch_id FROM hr_settings WHERE branch_id = ?', [branchId || 0]);
    const [[branch]] = branchId ? await db.query('SELECT id, branch_name, latitude, longitude FROM branches WHERE id = ?', [branchId]) : [[null]];
    res.json({ success: true, settings: { ...settings, weekly_off: settings.weekly_off.join(',') }, customised: !!own, branch });
  } catch (e) {
    console.error('getSettings error:', e);
    fail(res, 500, 'Server error');
  }
};

const SETTING_LIMITS = {
  late_grace_minutes: [0, 240], half_day_ratio: [0.1, 1], geofence_radius_m: [20, 20000],
  pf_employee_pct: [0, 100], pf_employer_pct: [0, 100], pf_wage_ceiling: [0, 1e7],
  esi_employee_pct: [0, 100], esi_employer_pct: [0, 100], esi_gross_ceiling: [0, 1e7],
  pt_threshold: [0, 1e7], pt_amount: [0, 1e5], pt_february_amount: [0, 1e5], ot_multiplier: [0, 10],
};

// PUT /api/attendance/settings — facility settings; Central with no facility edits the defaults.
export const saveSettings = async (req, res) => {
  try {
    const branchId = req.user.role_level === 'Central' ? Number(req.body.branch_id || 0) : Number(req.user.branch_id);
    const b = req.body;
    const vals = {};
    for (const [k, [min, max]] of Object.entries(SETTING_LIMITS)) {
      if (b[k] === undefined) continue;
      if (k === 'geofence_radius_m' && (b[k] === null || b[k] === '')) { vals[k] = null; continue; }
      const n = Number(b[k]);
      if (Number.isNaN(n) || n < min || n > max) return fail(res, 400, `${k.replace(/_/g, ' ')} must be between ${min} and ${max}`);
      vals[k] = n;
    }
    if (b.weekly_off !== undefined) {
      const days = String(b.weekly_off).split(',').map((d) => d.trim()).filter(Boolean);
      if (!days.every((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].includes(d))) return fail(res, 400, 'Weekly off must be days like Sun or Sat,Sun');
      vals.weekly_off = days.join(',');
    }
    if (b.lop_basis !== undefined) {
      if (!['Calendar', 'Fixed30'].includes(b.lop_basis)) return fail(res, 400, 'Invalid LOP basis');
      vals.lop_basis = b.lop_basis;
    }
    // A facility's first save starts from the network defaults.
    const current = await getHrSettings(branchId);
    const merged = { ...current, weekly_off: current.weekly_off.join(','), ...vals };
    const cols = ['weekly_off', 'lop_basis', ...Object.keys(SETTING_LIMITS)];
    await db.query(
      `INSERT INTO hr_settings (branch_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c} = VALUES(${c})`).join(', ')}`,
      [branchId, ...cols.map((c) => merged[c])]
    );
    // Facility coordinates for the geo-fence.
    if (branchId && b.latitude !== undefined && b.longitude !== undefined) {
      const lat = b.latitude === null || b.latitude === '' ? null : Number(b.latitude);
      const lng = b.longitude === null || b.longitude === '' ? null : Number(b.longitude);
      if ((lat !== null && (Number.isNaN(lat) || Math.abs(lat) > 90)) || (lng !== null && (Number.isNaN(lng) || Math.abs(lng) > 180))) {
        return fail(res, 400, 'Invalid facility coordinates');
      }
      await db.query('UPDATE branches SET latitude = ?, longitude = ? WHERE id = ?', [lat, lng, branchId]);
    }
    res.json({ success: true });
  } catch (e) {
    console.error('saveSettings error:', e);
    fail(res, 500, 'Server error');
  }
};
