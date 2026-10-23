import db from '../config/db.js';
import { readScope, isISODate, isTime, fail } from '../utils/hr.js';
import { slotsForEntry } from '../utils/opdSlots.js';

// Doctor availability for OP booking, read from the duty roster's OPD
// sessions (roster_entries). The roster itself is managed under /api/roster.
// Doctors are identified by their login id (users.id), which is what
// appointments.doctor_id and consultations key on.

const OPD_SELECT = `
  SELECT r.id AS roster_entry_id, DATE_FORMAT(r.duty_date, '%Y-%m-%d') AS duty_date,
         TIME_FORMAT(r.start_time, '%H:%i') AS start_time, TIME_FORMAT(r.end_time, '%H:%i') AS end_time,
         r.consultation_fee, r.slot_minutes, r.patients_per_slot, r.online_booking, r.branch_id,
         u.id, e.id AS employee_id, e.first_name, e.last_name, e.designation, e.qualification,
         COALESCE(dr.name, de.name) AS department, COALESCE(r.department_id, e.department_id) AS department_id,
         i.name AS room_name, i.room_number, i.block, i.floor
    FROM roster_entries r
    JOIN employees e ON e.id = r.employee_id
    JOIN users u     ON u.id = e.user_id
    LEFT JOIN departments dr   ON dr.id = r.department_id
    LEFT JOIN departments de   ON de.id = e.department_id
    LEFT JOIN infrastructure i ON i.id = r.room_id
   WHERE r.duty_type = 'OPD' AND r.status = 'Scheduled' AND e.status = 'Active'`;

// GET /api/duty?from&to — OPD sessions in a range.
export const getDutySchedules = async (req, res) => {
  try {
    const scope = readScope(req);
    const params = [];
    let q = OPD_SELECT;
    if (scope) { q += ' AND r.branch_id = ?'; params.push(scope); }
    if (isISODate(req.query.from)) { q += ' AND r.duty_date >= ?'; params.push(req.query.from); }
    if (isISODate(req.query.to)) { q += ' AND r.duty_date <= ?'; params.push(req.query.to); }
    const [rows] = await db.query(`${q} ORDER BY r.duty_date, r.start_time`, params);
    res.json({ success: true, schedules: rows });
  } catch (error) {
    console.error('Error fetching OPD schedules:', error);
    fail(res, 500, 'Server error fetching schedules');
  }
};

// GET /api/duty/available?date&time&department — doctors whose OPD session covers that time
// (or, without time, any OPD session that day).
export const getAvailableDoctors = async (req, res) => {
  try {
    const { date, time, department, department_id } = req.query;
    if (!isISODate(date)) return fail(res, 400, 'A valid date is required');
    const scope = readScope(req);
    let q = `${OPD_SELECT} AND r.duty_date = ?`;
    const params = [date];
    if (time) {
      if (!isTime(time)) return fail(res, 400, 'Invalid time');
      q += ' AND ? >= r.start_time AND ? < r.end_time';
      params.push(time, time);
    }
    if (scope) { q += ' AND r.branch_id = ?'; params.push(scope); }
    if (department_id) { q += ' AND COALESCE(r.department_id, e.department_id) = ?'; params.push(department_id); }
    else if (department) { q += ' AND COALESCE(dr.name, de.name) = ?'; params.push(department); }
    const [rows] = await db.query(`${q} ORDER BY department, e.first_name, r.start_time`, params);
    // `price` kept for the registration-desk booking form, which reads it.
    res.json({ success: true, doctors: rows.map((r) => ({ ...r, price: r.consultation_fee })) });
  } catch (error) {
    console.error('Error fetching available doctors:', error);
    fail(res, 500, 'Server error fetching availability');
  }
};

// GET /api/duty/slots?doctor_id=<users.id>&date — slots across the doctor's OPD sessions that day.
export const getDutySlots = async (req, res) => {
  try {
    const { doctor_id, date } = req.query;
    if (!doctor_id || !isISODate(date)) return fail(res, 400, 'doctor_id and date required');
    const scope = readScope(req);
    const params = [doctor_id, date];
    let q = `${OPD_SELECT} AND u.id = ? AND r.duty_date = ?`;
    if (scope) { q += ' AND r.branch_id = ?'; params.push(scope); }
    const [sessions] = await db.query(`${q} ORDER BY r.start_time`, params);
    const slots = [];
    for (const s of sessions) {
      const list = await slotsForEntry({ ...s, id: s.roster_entry_id });
      list.forEach((sl) => slots.push({ ...sl, roster_entry_id: s.roster_entry_id }));
    }
    res.json({ success: true, slots, sessions, hasDuty: sessions.length > 0 });
  } catch (error) {
    console.error('Error fetching duty slots:', error);
    fail(res, 500, 'Server error');
  }
};
