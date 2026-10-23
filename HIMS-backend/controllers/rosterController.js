import db from '../config/db.js';
import {
  readScope, writeScope, inScope, isISODate, isTime, nowIST, addDays, dateRange, weekdayOf, daysBetween,
  dutyInterval, overlaps, toMinutes, employeeForUser, holidaysBetween, fail,
} from '../utils/hr.js';
import { activeAppointmentsForEntry } from '../utils/opdSlots.js';

const DUTY_TYPES = ['OPD', 'IPD', 'Emergency', 'OT', 'On-Call', 'General', 'Weekly Off'];
// Rooms only one person can work at a time; wards and emergency take a team.
const EXCLUSIVE_ROOM_TYPES = ['OPD Cabin', 'Room', 'Procedure Room', 'OT', 'Office'];
const MAX_BULK_DAYS = 62;

const ENTRY_SELECT = `
  SELECT r.id, r.branch_id, r.employee_id, DATE_FORMAT(r.duty_date, '%Y-%m-%d') AS duty_date,
         r.shift_id, TIME_FORMAT(r.start_time, '%H:%i') AS start_time, TIME_FORMAT(r.end_time, '%H:%i') AS end_time,
         r.duty_type, r.room_id, r.department_id, r.consultation_fee, r.slot_minutes, r.patients_per_slot,
         r.online_booking, r.notes, r.status,
         e.employee_code, e.first_name, e.last_name, e.designation, e.staff_category, e.user_id,
         s.name AS shift_name, s.code AS shift_code, s.color AS shift_color,
         i.name AS room_name, i.room_number, i.type AS room_type, i.block, i.floor,
         COALESCE(dr.name, de.name) AS department_name
    FROM roster_entries r
    JOIN employees e          ON e.id = r.employee_id
    LEFT JOIN shifts s        ON s.id = r.shift_id
    LEFT JOIN infrastructure i ON i.id = r.room_id
    LEFT JOIN departments dr  ON dr.id = r.department_id
    LEFT JOIN departments de  ON de.id = e.department_id`;

// ── Shifts ────────────────────────────────────────────────────────────────────

export const listShifts = async (req, res) => {
  try {
    const scope = readScope(req);
    const [rows] = await db.query(
      `SELECT id, branch_id, name, code, TIME_FORMAT(start_time, '%H:%i') AS start_time, TIME_FORMAT(end_time, '%H:%i') AS end_time,
              break_minutes, color, is_active
         FROM shifts WHERE (branch_id IS NULL ${scope ? 'OR branch_id = ?' : ''}) ${req.query.all === '1' ? '' : 'AND is_active = 1'}
        ORDER BY start_time`,
      scope ? [scope] : []
    );
    res.json({ success: true, shifts: rows });
  } catch (e) {
    console.error('listShifts error:', e);
    fail(res, 500, 'Server error');
  }
};

const readShift = (b) => {
  const name = String(b.name || '').trim().slice(0, 60);
  const code = String(b.code || '').trim().toUpperCase().slice(0, 10);
  if (!name || !code) return [null, 'Shift name and code are required'];
  if (!isTime(b.start_time) || !isTime(b.end_time)) return [null, 'Start and end time are required'];
  if (b.start_time === b.end_time) return [null, 'Start and end time cannot be the same'];
  const color = /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '#1a6fd4';
  const brk = Math.max(0, Math.min(240, parseInt(b.break_minutes, 10) || 0));
  return [{ name, code, start_time: b.start_time, end_time: b.end_time, break_minutes: brk, color }, null];
};

export const createShift = async (req, res) => {
  try {
    const [s, err] = readShift(req.body);
    if (err) return fail(res, 400, err);
    // Central users create network-wide shifts unless they name a facility.
    const branchId = req.user.role_level === 'Central' ? (req.body.branch_id || null) : req.user.branch_id;
    const [r] = await db.query(
      'INSERT INTO shifts (branch_id, name, code, start_time, end_time, break_minutes, color) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [branchId, s.name, s.code, s.start_time, s.end_time, s.break_minutes, s.color]
    );
    res.status(201).json({ success: true, id: r.insertId });
  } catch (e) {
    console.error('createShift error:', e);
    fail(res, 500, 'Server error');
  }
};

const loadOwnShift = async (req, res) => {
  const [[shift]] = await db.query('SELECT * FROM shifts WHERE id = ?', [req.params.id]);
  if (!shift) { fail(res, 404, 'Shift not found'); return null; }
  // Network-wide shifts belong to Central; a facility edits only its own.
  if (shift.branch_id === null ? req.user.role_level !== 'Central' : !inScope(req, shift.branch_id)) {
    fail(res, 403, 'This shift is managed centrally'); return null;
  }
  return shift;
};

export const updateShift = async (req, res) => {
  try {
    const shift = await loadOwnShift(req, res);
    if (!shift) return;
    const [s, err] = readShift(req.body);
    if (err) return fail(res, 400, err);
    await db.query(
      'UPDATE shifts SET name = ?, code = ?, start_time = ?, end_time = ?, break_minutes = ?, color = ?, is_active = ? WHERE id = ?',
      [s.name, s.code, s.start_time, s.end_time, s.break_minutes, s.color, req.body.is_active === false || req.body.is_active === 0 ? 0 : 1, shift.id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('updateShift error:', e);
    fail(res, 500, 'Server error');
  }
};

// Retired, not deleted: past roster entries still point at it.
export const deleteShift = async (req, res) => {
  try {
    const shift = await loadOwnShift(req, res);
    if (!shift) return;
    await db.query('UPDATE shifts SET is_active = 0 WHERE id = ?', [shift.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('deleteShift error:', e);
    fail(res, 500, 'Server error');
  }
};

// ── Roster ────────────────────────────────────────────────────────────────────

// GET /api/roster?from&to&employee_id&department_id&duty_type&room_id
export const listRoster = async (req, res) => {
  try {
    const { from, to, employee_id, department_id, duty_type, room_id } = req.query;
    if (!isISODate(from) || !isISODate(to) || to < from) return fail(res, 400, 'Give a valid from/to date range');
    if (daysBetween(from, to) > 92) return fail(res, 400, 'Range is limited to three months');
    const scope = readScope(req);
    const where = ['r.duty_date BETWEEN ? AND ?', "r.status = 'Scheduled'"];
    const params = [from, to];
    if (scope) { where.push('r.branch_id = ?'); params.push(scope); }
    if (employee_id) { where.push('r.employee_id = ?'); params.push(employee_id); }
    if (department_id) { where.push('COALESCE(r.department_id, e.department_id) = ?'); params.push(department_id); }
    if (duty_type) { where.push('r.duty_type = ?'); params.push(duty_type); }
    if (room_id) { where.push('r.room_id = ?'); params.push(room_id); }
    const [entries] = await db.query(`${ENTRY_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.duty_date, r.start_time`, params);

    // Leave and holidays drawn on the same grid.
    const lp = [to, from];
    let lw = '';
    if (scope) { lw = ' AND lr.branch_id = ?'; lp.push(scope); }
    const [leaves] = await db.query(
      `SELECT lr.id, lr.employee_id, DATE_FORMAT(lr.from_date, '%Y-%m-%d') AS from_date, DATE_FORMAT(lr.to_date, '%Y-%m-%d') AS to_date,
              lr.half_day, lr.status, lt.code AS leave_code, lt.name AS leave_name
         FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.status IN ('Approved','Pending') AND lr.from_date <= ? AND lr.to_date >= ? ${lw}`,
      lp
    );
    const holidays = [...(await holidaysBetween(scope, from, to))].map(([holiday_date, holiday_name]) => ({ holiday_date, holiday_name }));
    res.json({ success: true, entries, leaves, holidays });
  } catch (e) {
    console.error('listRoster error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/roster/my?from&to — the signed-in employee's own duties.
export const myRoster = async (req, res) => {
  try {
    const emp = await employeeForUser(req.user.id);
    if (!emp) return res.json({ success: true, entries: [] });
    const from = isISODate(req.query.from) ? req.query.from : nowIST().date;
    const to = isISODate(req.query.to) ? req.query.to : addDays(from, 13);
    const [entries] = await db.query(
      `${ENTRY_SELECT} WHERE r.employee_id = ? AND r.duty_date BETWEEN ? AND ? AND r.status = 'Scheduled' ORDER BY r.duty_date, r.start_time`,
      [emp.id, from, to]
    );
    res.json({ success: true, entries });
  } catch (e) {
    console.error('myRoster error:', e);
    fail(res, 500, 'Server error');
  }
};

// Reads the duty definition shared by create and update. Returns [duty, error].
const readDuty = async (b, branchId) => {
  const duty = { duty_type: b.duty_type || 'General' };
  if (!DUTY_TYPES.includes(duty.duty_type)) return [null, 'Invalid duty type'];

  let shift = null;
  if (b.shift_id) {
    [[shift]] = await db.query(
      `SELECT id, TIME_FORMAT(start_time, '%H:%i') AS start_time, TIME_FORMAT(end_time, '%H:%i') AS end_time
         FROM shifts WHERE id = ? AND is_active = 1 AND (branch_id IS NULL OR branch_id = ?)`,
      [b.shift_id, branchId]
    );
    if (!shift) return [null, 'Shift not found'];
  }
  duty.shift_id = shift?.id || null;
  duty.start_time = b.start_time || shift?.start_time;
  duty.end_time = b.end_time || shift?.end_time;
  if (duty.duty_type === 'Weekly Off') { duty.start_time = '00:00'; duty.end_time = '00:00'; duty.shift_id = null; }
  else {
    if (!isTime(duty.start_time) || !isTime(duty.end_time)) return [null, 'Pick a shift or enter start and end time'];
    if (duty.start_time === duty.end_time) return [null, 'Start and end time cannot be the same'];
  }

  duty.room_id = b.room_id ? Number(b.room_id) : null;
  if (duty.room_id) {
    const [[room]] = await db.query('SELECT id, type, is_active FROM infrastructure WHERE id = ? AND branch_id = ?', [duty.room_id, branchId]);
    if (!room) return [null, 'Room not found in this facility'];
    if (!room.is_active) return [null, 'That room is marked inactive'];
    duty.room_type = room.type;
  }
  duty.department_id = b.department_id ? Number(b.department_id) : null;
  duty.notes = b.notes ? String(b.notes).slice(0, 255) : null;

  if (duty.duty_type === 'OPD') {
    if (toMinutes(duty.end_time) <= toMinutes(duty.start_time)) return [null, 'An OPD session must end on the same day it starts'];
    if (!duty.room_id) return [null, 'An OPD session needs a consultation room'];
    duty.consultation_fee = Math.max(0, Number(b.consultation_fee) || 0);
    duty.slot_minutes = Math.min(120, Math.max(5, parseInt(b.slot_minutes, 10) || 15));
    duty.patients_per_slot = Math.min(20, Math.max(1, parseInt(b.patients_per_slot, 10) || 1));
    duty.online_booking = b.online_booking === false || b.online_booking === 0 ? 0 : 1;
  } else {
    Object.assign(duty, { consultation_fee: 0, slot_minutes: 15, patients_per_slot: 1, online_booking: 0 });
  }
  return [duty, null];
};

// Everything that stops `employee` taking `duty` on `date`. `excludeId` skips
// the entry being edited.
const conflictsFor = async (conn, employee, date, duty, excludeId = 0) => {
  const reasons = [];
  if (employee.date_of_joining && date < employee.date_of_joining) reasons.push(`before joining date ${employee.date_of_joining}`);
  if (employee.date_of_leaving && date > employee.date_of_leaving) reasons.push(`after leaving date ${employee.date_of_leaving}`);

  const [[leave]] = await conn.query(
    `SELECT lt.code, lr.half_day FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.employee_id = ? AND lr.status = 'Approved' AND ? BETWEEN lr.from_date AND lr.to_date LIMIT 1`,
    [employee.id, date]
  );
  if (leave && leave.half_day === 'None') reasons.push(`on approved ${leave.code} leave`);

  if (duty.duty_type === 'Weekly Off') return reasons;
  const mine = dutyInterval(date, duty.start_time, duty.end_time);

  // Neighbouring days too, so a night shift that spills past midnight is caught.
  const [others] = await conn.query(
    `SELECT r.id, DATE_FORMAT(r.duty_date, '%Y-%m-%d') AS duty_date, TIME_FORMAT(r.start_time, '%H:%i') AS start_time,
            TIME_FORMAT(r.end_time, '%H:%i') AS end_time, r.duty_type
       FROM roster_entries r
      WHERE r.employee_id = ? AND r.status = 'Scheduled' AND r.id <> ? AND r.duty_type <> 'Weekly Off'
        AND r.duty_date BETWEEN ? AND ?`,
    [employee.id, excludeId, addDays(date, -1), addDays(date, 1)]
  );
  for (const o of others) {
    if (overlaps(mine, dutyInterval(o.duty_date, o.start_time, o.end_time))) {
      reasons.push(`already on ${o.duty_type} duty ${o.duty_date} ${o.start_time}–${o.end_time}`);
    }
  }

  if (duty.room_id && EXCLUSIVE_ROOM_TYPES.includes(duty.room_type)) {
    const [inRoom] = await conn.query(
      `SELECT r.id, DATE_FORMAT(r.duty_date, '%Y-%m-%d') AS duty_date, TIME_FORMAT(r.start_time, '%H:%i') AS start_time,
              TIME_FORMAT(r.end_time, '%H:%i') AS end_time, CONCAT(e.first_name, ' ', e.last_name) AS who
         FROM roster_entries r JOIN employees e ON e.id = r.employee_id
        WHERE r.room_id = ? AND r.status = 'Scheduled' AND r.id <> ? AND r.employee_id <> ?
          AND r.duty_date BETWEEN ? AND ?`,
      [duty.room_id, excludeId, employee.id, addDays(date, -1), addDays(date, 1)]
    );
    for (const o of inRoom) {
      if (overlaps(mine, dutyInterval(o.duty_date, o.start_time, o.end_time))) {
        reasons.push(`room taken by ${o.who} ${o.start_time}–${o.end_time}`);
      }
    }
  }
  return reasons;
};

const loadEmployees = async (ids, branchId) => {
  if (!ids.length) return [];
  const [rows] = await db.query(
    `SELECT id, first_name, last_name, status, user_id, staff_category,
            DATE_FORMAT(date_of_joining, '%Y-%m-%d') AS date_of_joining, DATE_FORMAT(date_of_leaving, '%Y-%m-%d') AS date_of_leaving
       FROM employees WHERE id IN (?) AND branch_id = ?`,
    [ids, branchId]
  );
  return rows;
};

// POST /api/roster
// { employee_ids[], from, to, weekdays?: ['Mon',…], shift_id | start_time+end_time, duty_type,
//   room_id?, department_id?, consultation_fee?, slot_minutes?, patients_per_slot?, online_booking?,
//   notes?, skip_conflicts? }
export const createRoster = async (req, res) => {
  try {
    const branchId = writeScope(req);
    if (!branchId) return fail(res, 400, 'Select the facility');
    const b = req.body;
    const ids = [...new Set((Array.isArray(b.employee_ids) ? b.employee_ids : [b.employee_id]).filter(Boolean).map(Number))];
    if (!ids.length) return fail(res, 400, 'Select at least one employee');
    const from = b.from || b.duty_date;
    const to = b.to || from;
    if (!isISODate(from) || !isISODate(to) || to < from) return fail(res, 400, 'Give a valid date or date range');
    if (daysBetween(from, to) >= MAX_BULK_DAYS) return fail(res, 400, `Assign at most ${MAX_BULK_DAYS} days at a time`);
    const weekdays = Array.isArray(b.weekdays) && b.weekdays.length ? b.weekdays : null;
    const dates = dateRange(from, to).filter((d) => !weekdays || weekdays.includes(weekdayOf(d)));
    if (!dates.length) return fail(res, 400, 'No dates match the selected weekdays');

    const [duty, err] = await readDuty(b, branchId);
    if (err) return fail(res, 400, err);

    const employees = await loadEmployees(ids, branchId);
    if (employees.length !== ids.length) return fail(res, 400, 'Some selected employees are not in this facility');
    const inactive = employees.filter((e) => e.status !== 'Active');
    if (inactive.length) return fail(res, 400, `Not active: ${inactive.map((e) => `${e.first_name} ${e.last_name}`).join(', ')}`);
    if (duty.duty_type === 'OPD') {
      const noLogin = employees.filter((e) => !e.user_id);
      if (noLogin.length) return fail(res, 400, `OPD duty needs a doctor login for appointments: ${noLogin.map((e) => `${e.first_name} ${e.last_name}`).join(', ')}`);
    }

    // Within one request each employee gets each date once, so the only
    // internal clash is several people sharing an exclusive room.
    if (duty.room_id && EXCLUSIVE_ROOM_TYPES.includes(duty.room_type) && employees.length > 1) {
      return fail(res, 400, 'A consultation room can be assigned to only one person per session');
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // Serialise roster writes per facility so two planners can't double-book in parallel.
      await conn.query('SELECT id FROM branches WHERE id = ? FOR UPDATE', [branchId]);
      const conflicts = [];
      const rows = [];
      for (const emp of employees) {
        for (const date of dates) {
          const reasons = await conflictsFor(conn, emp, date, duty);
          if (reasons.length) conflicts.push({ employee_id: emp.id, name: `${emp.first_name} ${emp.last_name}`, date, reasons });
          else rows.push([branchId, emp.id, date, duty.shift_id, duty.start_time, duty.end_time, duty.duty_type, duty.room_id,
            duty.department_id, duty.consultation_fee, duty.slot_minutes, duty.patients_per_slot, duty.online_booking, duty.notes, req.user.id]);
        }
      }
      if (conflicts.length && !b.skip_conflicts) {
        await conn.rollback();
        return fail(res, 409, `${conflicts.length} of ${conflicts.length + rows.length} duties clash`, { conflicts });
      }
      if (rows.length) {
        await conn.query(
          `INSERT INTO roster_entries (branch_id, employee_id, duty_date, shift_id, start_time, end_time, duty_type, room_id,
                                       department_id, consultation_fee, slot_minutes, patients_per_slot, online_booking, notes, created_by)
           VALUES ?`,
          [rows]
        );
      }
      await conn.commit();
      res.status(201).json({ success: true, created: rows.length, skipped: conflicts });
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('createRoster error:', e);
    fail(res, 500, 'Server error');
  }
};

const loadEntry = async (req, res) => {
  const [[entry]] = await db.query(
    `SELECT r.*, DATE_FORMAT(r.duty_date, '%Y-%m-%d') AS duty_date,
            TIME_FORMAT(r.start_time, '%H:%i') AS start_time, TIME_FORMAT(r.end_time, '%H:%i') AS end_time
       FROM roster_entries r WHERE r.id = ?`,
    [req.params.id]
  );
  if (!entry || !inScope(req, entry.branch_id)) { fail(res, 404, 'Duty not found'); return null; }
  return entry;
};

// PUT /api/roster/:id — change one duty. An OPD session that already has
// patients may not shrink past them or move to another doctor/day.
export const updateRosterEntry = async (req, res) => {
  try {
    const entry = await loadEntry(req, res);
    if (!entry) return;
    if (entry.status !== 'Scheduled') return fail(res, 400, 'This duty was cancelled');
    const b = { ...req.body };
    const date = b.duty_date || entry.duty_date;
    if (!isISODate(date)) return fail(res, 400, 'Invalid date');
    const base = { ...entry };
    // A new shift brings its own hours unless explicit times are given too.
    if (b.shift_id !== undefined && b.start_time === undefined) { delete base.start_time; delete base.end_time; }
    const [duty, err] = await readDuty({ ...base, ...b }, entry.branch_id);
    if (err) return fail(res, 400, err);
    const employeeId = Number(b.employee_id || entry.employee_id);

    const booked = entry.duty_type === 'OPD' ? await activeAppointmentsForEntry(entry.id) : [];
    if (booked.length) {
      if (employeeId !== entry.employee_id || date !== entry.duty_date || duty.duty_type !== 'OPD') {
        return fail(res, 409, `${booked.length} patients are booked on this session. Cancel or move them first.`, { appointments: booked });
      }
      const outside = booked.filter((a) => a.appt_time < duty.start_time || a.appt_time >= duty.end_time);
      if (outside.length) return fail(res, 409, `${outside.length} booked patients fall outside the new hours`, { appointments: outside });
    }

    const [[emp]] = await db.query(
      `SELECT id, status, user_id, DATE_FORMAT(date_of_joining, '%Y-%m-%d') AS date_of_joining,
              DATE_FORMAT(date_of_leaving, '%Y-%m-%d') AS date_of_leaving
         FROM employees WHERE id = ? AND branch_id = ?`,
      [employeeId, entry.branch_id]
    );
    if (!emp || emp.status !== 'Active') return fail(res, 400, 'Employee not found or not active');
    if (duty.duty_type === 'OPD' && !emp.user_id) return fail(res, 400, 'OPD duty needs a doctor login');
    const reasons = await conflictsFor(db, emp, date, duty, entry.id);
    if (reasons.length) return fail(res, 409, `Clashes: ${reasons.join('; ')}`, { conflicts: [{ date, reasons }] });

    await db.query(
      `UPDATE roster_entries SET employee_id = ?, duty_date = ?, shift_id = ?, start_time = ?, end_time = ?, duty_type = ?, room_id = ?,
              department_id = ?, consultation_fee = ?, slot_minutes = ?, patients_per_slot = ?, online_booking = ?, notes = ?
        WHERE id = ?`,
      [employeeId, date, duty.shift_id, duty.start_time, duty.end_time, duty.duty_type, duty.room_id, duty.department_id,
        duty.consultation_fee, duty.slot_minutes, duty.patients_per_slot, duty.online_booking, duty.notes, entry.id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('updateRosterEntry error:', e);
    fail(res, 500, 'Server error');
  }
};

// DELETE /api/roster/:id?cancel_appointments=1&reason=…
export const cancelRosterEntry = async (req, res) => {
  try {
    const entry = await loadEntry(req, res);
    if (!entry) return;
    const booked = entry.duty_type === 'OPD' ? await activeAppointmentsForEntry(entry.id) : [];
    if (booked.length && req.query.cancel_appointments !== '1') {
      return fail(res, 409, `${booked.length} patients are booked on this session`, { appointments: booked });
    }
    const reason = String(req.query.reason || 'Doctor unavailable').slice(0, 200);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`UPDATE roster_entries SET status = 'Cancelled' WHERE id = ?`, [entry.id]);
      if (booked.length) {
        await conn.query(
          `UPDATE appointments SET status = 'Cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?
            WHERE roster_entry_id = ? AND status = 'Scheduled'`,
          [nowIST().datetime, `user:${req.user.id}`, reason, entry.id]
        );
        await conn.query(
          `UPDATE patient_charges pc JOIN appointments a ON pc.source_type = 'Consultation' AND pc.source_id = a.id
            SET pc.status = 'Cancelled', pc.cancel_reason = ?
          WHERE a.roster_entry_id IN (?) AND a.status = 'Cancelled' AND pc.status = 'Unbilled'`,
          [reason, [entry.id]]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
    // The front desk calls these patients; the list goes back to them.
    res.json({ success: true, cancelled_appointments: booked });
  } catch (e) {
    console.error('cancelRosterEntry error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/roster/copy-week { source_week_start, target_week_start, employee_ids?, skip_conflicts? }
// Repeats one week's duties a week (or more) later. OPD settings come along.
export const copyWeek = async (req, res) => {
  try {
    const branchId = writeScope(req);
    if (!branchId) return fail(res, 400, 'Select the facility');
    const { source_week_start: src, target_week_start: dst } = req.body;
    if (!isISODate(src) || !isISODate(dst)) return fail(res, 400, 'Give both week start dates');
    const shift = daysBetween(src, dst);
    if (shift <= 0 || shift % 7 !== 0) return fail(res, 400, 'Target week must be a whole number of weeks after the source week');
    const ids = Array.isArray(req.body.employee_ids) && req.body.employee_ids.length ? req.body.employee_ids.map(Number) : null;

    const [source] = await db.query(
      `SELECT r.*, DATE_FORMAT(r.duty_date, '%Y-%m-%d') AS duty_date, TIME_FORMAT(r.start_time, '%H:%i') AS start_time,
              TIME_FORMAT(r.end_time, '%H:%i') AS end_time, i.type AS room_type,
              e.first_name, e.last_name, e.status AS emp_status,
              DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS date_of_joining, DATE_FORMAT(e.date_of_leaving, '%Y-%m-%d') AS date_of_leaving
         FROM roster_entries r JOIN employees e ON e.id = r.employee_id LEFT JOIN infrastructure i ON i.id = r.room_id
        WHERE r.branch_id = ? AND r.status = 'Scheduled' AND r.duty_date BETWEEN ? AND ? ${ids ? 'AND r.employee_id IN (?)' : ''}`,
      ids ? [branchId, src, addDays(src, 6), ids] : [branchId, src, addDays(src, 6)]
    );
    if (!source.length) return fail(res, 400, 'Nothing is rostered in the source week');

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('SELECT id FROM branches WHERE id = ? FOR UPDATE', [branchId]);
      const rows = [];
      const conflicts = [];
      for (const s of source) {
        const date = addDays(s.duty_date, shift);
        const emp = { id: s.employee_id, date_of_joining: s.date_of_joining, date_of_leaving: s.date_of_leaving };
        const reasons = s.emp_status !== 'Active' ? ['employee not active'] : await conflictsFor(conn, emp, date, s);
        if (reasons.length) { conflicts.push({ employee_id: s.employee_id, name: `${s.first_name} ${s.last_name}`, date, reasons }); continue; }
        rows.push([branchId, s.employee_id, date, s.shift_id, s.start_time, s.end_time, s.duty_type, s.room_id, s.department_id,
          s.consultation_fee, s.slot_minutes, s.patients_per_slot, s.online_booking, s.notes, req.user.id]);
      }
      if (conflicts.length && !req.body.skip_conflicts) {
        await conn.rollback();
        return fail(res, 409, `${conflicts.length} of ${source.length} duties clash in the target week`, { conflicts });
      }
      if (rows.length) {
        await conn.query(
          `INSERT INTO roster_entries (branch_id, employee_id, duty_date, shift_id, start_time, end_time, duty_type, room_id,
                                       department_id, consultation_fee, slot_minutes, patients_per_slot, online_booking, notes, created_by)
           VALUES ?`,
          [rows]
        );
      }
      await conn.commit();
      res.status(201).json({ success: true, created: rows.length, skipped: conflicts });
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('copyWeek error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/roster/on-duty?date&time — who is working where right now (room board, front desk).
export const onDutyNow = async (req, res) => {
  try {
    const scope = readScope(req);
    const now = nowIST();
    const date = isISODate(req.query.date) ? req.query.date : now.date;
    const time = isTime(req.query.time) ? req.query.time.slice(0, 5) : now.time.slice(0, 5);
    const params = [addDays(date, -1), date];
    let w = '';
    if (scope) { w = ' AND r.branch_id = ?'; params.push(scope); }
    const [rows] = await db.query(
      `${ENTRY_SELECT} WHERE r.duty_date BETWEEN ? AND ? AND r.status = 'Scheduled' AND r.duty_type <> 'Weekly Off' ${w}
       ORDER BY r.start_time`,
      params
    );
    const at = dutyInterval(date, time, time)[0];
    const onDuty = rows.filter((r) => {
      const [s, e] = dutyInterval(r.duty_date, r.start_time, r.end_time);
      return at >= s && at < e;
    });
    res.json({ success: true, date, time, on_duty: onDuty });
  } catch (e) {
    console.error('onDutyNow error:', e);
    fail(res, 500, 'Server error');
  }
};
