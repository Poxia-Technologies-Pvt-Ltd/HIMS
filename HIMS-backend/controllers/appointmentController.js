import db from '../config/db.js';
import { normalizeRole } from '../middleware/auth.js';
import { FRONT_DESK_ROLES, readScope, inScope, isISODate, isTime, nowIST, addDays, toMinutes, fromMinutes, fail } from '../utils/hr.js';
import { slotTimes, slotsForEntry } from '../utils/opdSlots.js';
import { createConsultationCharge, moveConsultationCharge, cancelConsultationCharge } from '../utils/charges.js';

// OP appointment lifecycle:
//   Scheduled -> Checked In -> In Consultation -> Completed
//   Scheduled -> Cancelled | No Show            (slot is freed)
// A booking always belongs to one OPD session (roster_entries, duty_type OPD)
// and, unless it is a walk-in, to one of that session's slots.

const PORTAL_BOOKING_DAYS = 30;
const PRIORITIES = ['Routine', 'Urgent', 'Emergency'];

const APPT_SELECT = `
  SELECT a.id, a.reg_no, a.department, a.department_id, a.doctor, a.doctor_id, a.roster_entry_id, a.priority,
         DATE_FORMAT(a.appt_date, '%Y-%m-%d') AS appt_date, TIME_FORMAT(a.appt_time, '%H:%i') AS appt_time,
         a.reason, a.status, a.token_number, a.booking_source, a.consultation_fee, a.branch_id,
         DATE_FORMAT(a.checkin_time, '%H:%i') AS checkin_time, DATE_FORMAT(a.start_time, '%H:%i') AS start_time,
         DATE_FORMAT(a.end_time, '%H:%i') AS end_time, a.wait_minutes, a.cancel_reason, a.rescheduled_from, a.created_at,
         CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name) AS patient_name, p.telephone, p.gender, p.dob,
         i.name AS room_name, i.room_number, b.branch_name
    FROM appointments a
    LEFT JOIN patients p        ON p.reg_no = a.reg_no
    LEFT JOIN roster_entries r  ON r.id = a.roster_entry_id
    LEFT JOIN infrastructure i  ON i.id = r.room_id
    LEFT JOIN branches b        ON b.id = a.branch_id`;

class BookingError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

// Books one appointment inside the caller's transaction. The OPD session row
// is locked first, so two desks can't both take the last place in a slot.
async function bookInSession(conn, { regNo, entryId, time, reason, priority, source, bookedBy, walkIn, branchScope, portal, replacesId = 0 }) {
  const now = nowIST();
  const [[entry]] = await conn.query(
    `SELECT r.*, DATE_FORMAT(r.duty_date, '%Y-%m-%d') AS duty_date, TIME_FORMAT(r.start_time, '%H:%i') AS start_time,
            TIME_FORMAT(r.end_time, '%H:%i') AS end_time, e.user_id, e.first_name, e.last_name, e.status AS emp_status,
            COALESCE(dr.name, de.name) AS department_name, COALESCE(r.department_id, e.department_id) AS dept_id
       FROM roster_entries r JOIN employees e ON e.id = r.employee_id
       LEFT JOIN departments dr ON dr.id = r.department_id LEFT JOIN departments de ON de.id = e.department_id
      WHERE r.id = ? FOR UPDATE`,
    [entryId]
  );
  if (!entry || entry.duty_type !== 'OPD' || entry.status !== 'Scheduled' || entry.emp_status !== 'Active' || !entry.user_id) {
    throw new BookingError(404, 'That OPD session is not available');
  }
  if (branchScope && Number(entry.branch_id) !== Number(branchScope)) throw new BookingError(404, 'That OPD session is not available');
  if (entry.duty_date < now.date) throw new BookingError(400, 'That session is in the past');
  if (portal) {
    if (!entry.online_booking) throw new BookingError(400, 'This session is not open for online booking');
    if (entry.duty_date > addDays(now.date, PORTAL_BOOKING_DAYS)) throw new BookingError(400, `Online booking opens ${PORTAL_BOOKING_DAYS} days ahead`);
  }

  const [[patient]] = await conn.query('SELECT reg_no FROM patients WHERE reg_no = ?', [regNo]);
  if (!patient) throw new BookingError(404, 'Patient not found');

  let apptTime = time;
  if (walkIn) {
    // Walk-ins are seen during the session without taking a slot.
    if (entry.duty_date !== now.date) throw new BookingError(400, 'Walk-ins can only be added to today\'s session');
    const t = now.time.slice(0, 5);
    if (t >= entry.end_time) throw new BookingError(400, 'This session has ended');
    apptTime = t < entry.start_time ? entry.start_time : t;
  } else {
    if (!isTime(apptTime)) throw new BookingError(400, 'Choose a slot');
    apptTime = apptTime.slice(0, 5);
    if (!slotTimes(entry).includes(apptTime)) throw new BookingError(400, 'That is not a slot in this session');
    if (entry.duty_date === now.date && apptTime < now.time.slice(0, 5) && portal) throw new BookingError(400, 'That slot has already passed');
    const [[{ n }]] = await conn.query(
      `SELECT COUNT(*) AS n FROM appointments
        WHERE roster_entry_id = ? AND appt_time = ? AND booking_source <> 'Walk-in'
          AND status IN ('Scheduled','Checked In','In Consultation','Completed')`,
      [entry.id, `${apptTime}:00`]
    );
    if (n >= entry.patients_per_slot) throw new BookingError(409, 'That slot was just taken. Pick another.');
  }

  const [[dup]] = await conn.query(
    `SELECT id, TIME_FORMAT(appt_time, '%H:%i') AS t FROM appointments
      WHERE reg_no = ? AND doctor_id = ? AND appt_date = ? AND id <> ? AND status IN ('Scheduled','Checked In','In Consultation')`,
    [regNo, entry.user_id, entry.duty_date, replacesId]
  );
  if (dup) throw new BookingError(409, `This patient already has an appointment with this doctor at ${dup.t} that day`);

  const [r] = await conn.query(
    `INSERT INTO appointments (reg_no, department, department_id, doctor, doctor_id, roster_entry_id, priority, appt_date, appt_time,
                               reason, status, branch_id, booking_source, booked_by, consultation_fee)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?, ?, ?, ?)`,
    [regNo, entry.department_name || 'OPD', entry.dept_id, `Dr. ${entry.first_name} ${entry.last_name}`.trim(), entry.user_id, entry.id,
      PRIORITIES.includes(priority) ? priority : 'Routine', entry.duty_date, `${apptTime}:00`,
      reason ? String(reason).slice(0, 1000) : null, entry.branch_id, walkIn ? 'Walk-in' : source, bookedBy, entry.consultation_fee]
  );
  // The consultation fee becomes a pending charge for the billing desk.
  await createConsultationCharge(conn, r.insertId);
  const [[charge]] = await conn.query(`SELECT id FROM patient_charges WHERE source_type = 'Consultation' AND source_id = ?`, [r.insertId]);
  return { id: r.insertId, appt_date: entry.duty_date, appt_time: apptTime, doctor: `Dr. ${entry.first_name} ${entry.last_name}`, fee: entry.consultation_fee, charge_id: charge?.id || null };
}

const runBooking = async (res, args, status = 201) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const booked = await bookInSession(conn, args);
    if (args.afterBook) await args.afterBook(conn, booked);
    await conn.commit();
    return res.status(status).json({ success: true, appointment: booked });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e instanceof BookingError) return fail(res, e.status, e.message, e.extra);
    console.error('booking error:', e);
    return fail(res, 500, 'Server error booking appointment');
  } finally {
    conn.release();
  }
};

// ── Sessions for booking ──────────────────────────────────────────────────────

const sessionsOn = async ({ date, departmentId, doctorUserId, branchId, onlineOnly }) => {
  const where = [`r.duty_type = 'OPD'`, `r.status = 'Scheduled'`, `e.status = 'Active'`, 'r.duty_date = ?'];
  const params = [date];
  if (branchId) { where.push('r.branch_id = ?'); params.push(branchId); }
  if (departmentId) { where.push('COALESCE(r.department_id, e.department_id) = ?'); params.push(departmentId); }
  if (doctorUserId) { where.push('e.user_id = ?'); params.push(doctorUserId); }
  if (onlineOnly) where.push('r.online_booking = 1');
  const [sessions] = await db.query(
    `SELECT r.id, r.branch_id, DATE_FORMAT(r.duty_date, '%Y-%m-%d') AS duty_date, TIME_FORMAT(r.start_time, '%H:%i') AS start_time,
            TIME_FORMAT(r.end_time, '%H:%i') AS end_time, r.slot_minutes, r.patients_per_slot, r.consultation_fee, r.online_booking,
            e.user_id AS doctor_id, e.first_name, e.last_name, e.designation, e.qualification,
            COALESCE(r.department_id, e.department_id) AS department_id, COALESCE(dr.name, de.name) AS department_name,
            i.name AS room_name, i.room_number, i.block, i.floor, b.branch_name
       FROM roster_entries r JOIN employees e ON e.id = r.employee_id
       LEFT JOIN departments dr ON dr.id = r.department_id LEFT JOIN departments de ON de.id = e.department_id
       LEFT JOIN infrastructure i ON i.id = r.room_id LEFT JOIN branches b ON b.id = r.branch_id
      WHERE ${where.join(' AND ')} AND e.user_id IS NOT NULL
      ORDER BY department_name, e.first_name, r.start_time`,
    params
  );
  const now = nowIST();
  for (const s of sessions) {
    s.slots = await slotsForEntry(s);
    // Past slots of today's session are not offered.
    if (s.duty_date === now.date) s.slots = s.slots.map((sl) => ({ ...sl, past: sl.time < now.time.slice(0, 5) }));
    s.free = s.slots.filter((sl) => !sl.past).reduce((n, sl) => n + sl.available, 0);
  }
  return sessions;
};

// GET /api/appointments/sessions?date&department_id&doctor_id
export const listSessions = async (req, res) => {
  try {
    const date = isISODate(req.query.date) ? req.query.date : nowIST().date;
    const sessions = await sessionsOn({ date, departmentId: req.query.department_id, doctorUserId: req.query.doctor_id, branchId: readScope(req) });
    res.json({ success: true, date, sessions });
  } catch (e) {
    console.error('listSessions error:', e);
    fail(res, 500, 'Server error');
  }
};

// ── Front desk ────────────────────────────────────────────────────────────────

// GET /api/appointments?date|from&to&doctor_id&department_id&status&q
export const getAppointments = async (req, res) => {
  try {
    const scope = readScope(req);
    const where = [];
    const params = [];
    const from = isISODate(req.query.from) ? req.query.from : (isISODate(req.query.date) ? req.query.date : nowIST().date);
    const to = isISODate(req.query.to) ? req.query.to : from;
    where.push('a.appt_date BETWEEN ? AND ?');
    params.push(from, to);
    if (scope) { where.push('a.branch_id = ?'); params.push(scope); }
    // Doctors see their own list only.
    if (normalizeRole(req.user.role) === 'Doctor') { where.push('a.doctor_id = ?'); params.push(req.user.id); }
    else if (req.query.doctor_id) { where.push('a.doctor_id = ?'); params.push(req.query.doctor_id); }
    if (req.query.department_id) { where.push('a.department_id = ?'); params.push(req.query.department_id); }
    if (req.query.status && req.query.status !== 'all') { where.push('a.status = ?'); params.push(req.query.status); }
    if (req.query.q) {
      where.push(`(a.reg_no LIKE ? OR p.telephone LIKE ? OR CONCAT_WS(' ', p.first_name, p.last_name) LIKE ? OR a.token_number = ?)`);
      const like = `%${req.query.q}%`;
      params.push(like, like, like, req.query.q);
    }
    const [rows] = await db.query(
      `${APPT_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY a.appt_date, FIELD(a.priority, 'Emergency', 'Urgent', 'Routine'), a.appt_time, a.id LIMIT 1000`,
      params
    );
    const summary = {};
    rows.forEach((r) => { summary[r.status] = (summary[r.status] || 0) + 1; });
    res.json({ success: true, appointments: rows, summary });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    fail(res, 500, 'Server error fetching appointments');
  }
};

// POST /api/appointments/book { reg_no, roster_entry_id, appt_time, reason, priority, walk_in }
export const bookAppointment = async (req, res) => {
  const b = req.body;
  const regNo = b.reg_no || b.regNo;
  if (!regNo) return fail(res, 400, 'Select the patient');
  let entryId = b.roster_entry_id;
  // Older callers send doctor_id + date + time; find the session that covers it.
  if (!entryId && b.doctor_id && isISODate(b.apptDate)) {
    const [[s]] = await db.query(
      `SELECT r.id FROM roster_entries r JOIN employees e ON e.id = r.employee_id
        WHERE e.user_id = ? AND r.duty_date = ? AND r.duty_type = 'OPD' AND r.status = 'Scheduled'
          AND (? IS NULL OR (? >= r.start_time AND ? < r.end_time)) ORDER BY r.start_time LIMIT 1`,
      [b.doctor_id, b.apptDate, b.apptTime || null, b.apptTime || null, b.apptTime || null]
    );
    if (!s) return fail(res, 400, 'The doctor has no OPD session at that time');
    entryId = s.id;
  }
  if (!entryId) return fail(res, 400, 'Choose a doctor\'s OPD session');
  return runBooking(res, {
    regNo, entryId, time: b.appt_time || b.apptTime, reason: b.reason, priority: b.priority, source: 'Front Desk',
    bookedBy: req.user.id, walkIn: !!b.walk_in, branchScope: readScope(req),
  });
};

const loadAppointment = async (req, res, conn = db, lock = false) => {
  const [[a]] = await conn.query(
    `SELECT a.*, DATE_FORMAT(a.appt_date, '%Y-%m-%d') AS appt_date, TIME_FORMAT(a.appt_time, '%H:%i') AS appt_time
       FROM appointments a WHERE a.id = ? ${lock ? 'FOR UPDATE' : ''}`,
    [req.params.id]
  );
  if (!a || !inScope(req, a.branch_id)) { fail(res, 404, 'Appointment not found'); return null; }
  if (normalizeRole(req.user.role) === 'Doctor' && a.doctor_id !== req.user.id) { fail(res, 404, 'Appointment not found'); return null; }
  return a;
};

// POST /api/appointments/:id/reschedule { roster_entry_id, appt_time }
export const rescheduleAppointment = async (req, res) => {
  const old = await loadAppointment(req, res);
  if (!old) return;
  if (old.status !== 'Scheduled') return fail(res, 400, `A ${old.status.toLowerCase()} appointment cannot be rescheduled`);
  return runBooking(res, {
    regNo: old.reg_no, entryId: req.body.roster_entry_id, time: req.body.appt_time, reason: old.reason, priority: old.priority,
    source: old.booking_source === 'Patient Portal' ? 'Patient Portal' : 'Front Desk', bookedBy: req.user.id, walkIn: false,
    branchScope: readScope(req), replacesId: old.id,
    // Free the old slot inside the same transaction; refuse if it changed meanwhile.
    afterBook: async (conn, booked) => {
      const [r] = await conn.query(
        `UPDATE appointments SET status = 'Cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = 'Rescheduled'
          WHERE id = ? AND status = 'Scheduled'`,
        [nowIST().datetime, `user:${req.user.id}`, old.id]
      );
      if (!r.affectedRows) throw new BookingError(409, 'The appointment changed meanwhile; reload and try again');
      await conn.query('UPDATE appointments SET rescheduled_from = ? WHERE id = ?', [old.id, booked.id]);
      // A fee already paid travels with the patient; an unpaid one is
      // replaced by the new doctor's fee.
      const [[oldCharge]] = await conn.query(`SELECT id, status FROM patient_charges WHERE source_type = 'Consultation' AND source_id = ?`, [old.id]);
      if (oldCharge?.status === 'Billed') {
        await conn.query(`DELETE FROM patient_charges WHERE source_type = 'Consultation' AND source_id = ? AND status = 'Unbilled'`, [booked.id]);
        await moveConsultationCharge(conn, old.id, booked.id);
        booked.charge_id = oldCharge.id;
      } else {
        await cancelConsultationCharge(conn, old.id, 'Rescheduled', req.user.id);
      }
    },
  });
};

// Moves an appointment along its lifecycle with a guarded UPDATE.
const transition = (from, to, apply) => async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const a = await loadAppointment(req, res, conn, true);
    if (!a) { await conn.rollback(); return; }
    if (!from.includes(a.status)) {
      await conn.rollback();
      return fail(res, 400, `Appointment is ${a.status.toLowerCase()}; cannot mark it ${to.toLowerCase()}`);
    }
    const extra = await apply(conn, a, req);
    if (extra?.error) { await conn.rollback(); return fail(res, extra.status || 400, extra.error); }
    const sets = { status: to, ...(extra || {}) };
    const cols = Object.keys(sets);
    await conn.query(`UPDATE appointments SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => sets[c]), a.id]);
    await conn.commit();
    res.json({ success: true, status: to, ...sets });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error(`appointment ${to} error:`, e);
    fail(res, 500, 'Server error');
  } finally {
    conn.release();
  }
};

// Token numbers run per OPD session in check-in order: 1, 2, 3…
export const checkInAppointment = transition(['Scheduled'], 'Checked In', async (conn, a) => {
  const now = nowIST();
  if (a.appt_date !== now.date) return { error: 'Only today\'s appointments can be checked in' };
  // Lock the session so two desks checking in at once can't share a token.
  if (a.roster_entry_id) await conn.query('SELECT id FROM roster_entries WHERE id = ? FOR UPDATE', [a.roster_entry_id]);
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM appointments WHERE ${a.roster_entry_id ? 'roster_entry_id = ?' : 'doctor_id = ? AND appt_date = ?'} AND token_number IS NOT NULL`,
    a.roster_entry_id ? [a.roster_entry_id] : [a.doctor_id, a.appt_date]
  );
  return { checkin_time: now.datetime, token_number: String(Number(n) + 1), queue_status: 'Waiting' };
});

// A doctor may also see a booked patient who reached the room without
// checking in at the desk; that counts as arriving now.
export const startConsultation = transition(['Scheduled', 'Checked In'], 'In Consultation', async (conn, a) => {
  const now = nowIST();
  if (a.status === 'Scheduled' && a.appt_date !== now.date) return { error: 'Only today\'s appointments can be started' };
  return { start_time: now.datetime, queue_status: 'In Consultation', ...(a.checkin_time ? {} : { checkin_time: now.datetime }) };
});

export const completeAppointment = transition(['Checked In', 'In Consultation'], 'Completed', async (conn, a) => {
  const now = nowIST();
  const start = a.start_time ? new Date(a.start_time) : null;
  const checkin = a.checkin_time ? new Date(a.checkin_time) : null;
  return {
    end_time: now.datetime,
    start_time: a.start_time || now.datetime,
    wait_minutes: checkin && start ? Math.max(0, Math.round((start - checkin) / 60000)) : null,
    queue_status: 'Completed',
  };
});

export const markNoShow = transition(['Scheduled'], 'No Show', async (conn, a, req) => {
  const now = nowIST();
  if (a.appt_date > now.date || (a.appt_date === now.date && a.appt_time > now.time.slice(0, 5))) {
    return { error: 'The appointment time has not passed yet' };
  }
  await cancelConsultationCharge(conn, a.id, 'No show', req.user.id);
  return { queue_status: 'No Show' };
});

export const cancelAppointment = transition(['Scheduled', 'Checked In'], 'Cancelled', async (conn, a, req) => {
  const reason = String(req.body.reason || '').trim().slice(0, 255);
  if (!reason) return { error: 'Give a reason for cancelling' };
  await cancelConsultationCharge(conn, a.id, reason, req.user.id);
  return { cancelled_at: nowIST().datetime, cancelled_by: `user:${req.user.id}`, cancel_reason: reason, queue_status: 'Cancelled' };
});

// GET /api/appointments/queue?doctor_id — today's waiting line for one doctor (TV/room display, doctor console).
export const doctorQueue = async (req, res) => {
  try {
    const doctorId = normalizeRole(req.user.role) === 'Doctor' ? req.user.id : req.query.doctor_id;
    if (!doctorId) return fail(res, 400, 'doctor_id required');
    const scope = readScope(req);
    const [rows] = await db.query(
      `${APPT_SELECT} WHERE a.doctor_id = ? AND a.appt_date = ? AND a.status IN ('Checked In','In Consultation') ${scope ? 'AND a.branch_id = ?' : ''}
       ORDER BY a.status = 'In Consultation' DESC, FIELD(a.priority, 'Emergency', 'Urgent', 'Routine'), CAST(a.token_number AS UNSIGNED)`,
      scope ? [doctorId, nowIST().date, scope] : [doctorId, nowIST().date]
    );
    res.json({ success: true, queue: rows });
  } catch (e) {
    console.error('doctorQueue error:', e);
    fail(res, 500, 'Server error');
  }
};

// ── Patient portal ────────────────────────────────────────────────────────────
// The portal token proves ownership of a phone number; every patient
// registered with that number (a family often shares one) can be booked.

const portalPatients = async (phone) => {
  const [rows] = await db.query(
    `SELECT reg_no, first_name, middle_name, last_name, gender, DATE_FORMAT(dob, '%Y-%m-%d') AS dob
       FROM patients WHERE telephone = ? ORDER BY first_name`,
    [phone]
  );
  return rows;
};

// GET /api/appointments/portal/:phone/patients
export const portalListPatients = async (req, res) => {
  try {
    res.json({ success: true, patients: await portalPatients(req.params.phone) });
  } catch (e) {
    console.error('portalListPatients error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/appointments/portal/:phone/options — facilities and departments with online OPD in the booking window.
export const portalOptions = async (req, res) => {
  try {
    const today = nowIST().date;
    const [rows] = await db.query(
      `SELECT DISTINCT r.branch_id, b.branch_name, COALESCE(r.department_id, e.department_id) AS department_id,
              COALESCE(dr.name, de.name) AS department_name
         FROM roster_entries r JOIN employees e ON e.id = r.employee_id JOIN branches b ON b.id = r.branch_id
         LEFT JOIN departments dr ON dr.id = r.department_id LEFT JOIN departments de ON de.id = e.department_id
        WHERE r.duty_type = 'OPD' AND r.status = 'Scheduled' AND r.online_booking = 1 AND e.status = 'Active' AND e.user_id IS NOT NULL
          AND r.duty_date BETWEEN ? AND ?
        ORDER BY b.branch_name, department_name`,
      [today, addDays(today, PORTAL_BOOKING_DAYS)]
    );
    res.json({ success: true, options: rows, booking_window_days: PORTAL_BOOKING_DAYS });
  } catch (e) {
    console.error('portalOptions error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/appointments/portal/:phone/sessions?date&branch_id&department_id
export const portalSessions = async (req, res) => {
  try {
    const today = nowIST().date;
    const date = isISODate(req.query.date) ? req.query.date : today;
    if (date < today || date > addDays(today, PORTAL_BOOKING_DAYS)) return fail(res, 400, `Pick a date within the next ${PORTAL_BOOKING_DAYS} days`);
    const sessions = await sessionsOn({
      date, departmentId: req.query.department_id, branchId: req.query.branch_id ? Number(req.query.branch_id) : null, onlineOnly: true,
    });
    // Patients see availability, not who else is booked.
    res.json({
      success: true,
      date,
      // A session whose slots have all passed is no use to a patient.
      sessions: sessions.filter((s) => s.slots.some((sl) => !sl.past)).map((s) => ({
        id: s.id, branch_id: s.branch_id, branch_name: s.branch_name, duty_date: s.duty_date, start_time: s.start_time, end_time: s.end_time,
        consultation_fee: s.consultation_fee, doctor_name: `Dr. ${s.first_name} ${s.last_name}`, designation: s.designation,
        qualification: s.qualification, department_name: s.department_name, room_name: s.room_name, room_number: s.room_number,
        free: s.free, slots: s.slots.map((sl) => ({ time: sl.time, available: !sl.past && sl.available > 0 })),
      })),
    });
  } catch (e) {
    console.error('portalSessions error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/appointments/portal/:phone/appointments
export const portalAppointments = async (req, res) => {
  try {
    const [rows] = await db.query(
      `${APPT_SELECT}
        WHERE p.telephone = ? AND a.appt_date >= ? ORDER BY a.appt_date DESC, a.appt_time DESC LIMIT 100`,
      [req.params.phone, addDays(nowIST().date, -365)]
    );
    res.json({ success: true, appointments: rows });
  } catch (e) {
    console.error('portalAppointments error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/appointments/portal/:phone/book { reg_no, roster_entry_id, appt_time, reason }
export const portalBook = async (req, res) => {
  const { reg_no: regNo, roster_entry_id: entryId, appt_time: time, reason } = req.body;
  const mine = await portalPatients(req.params.phone).catch(() => []);
  if (!mine.some((p) => p.reg_no === regNo)) return fail(res, 403, 'That patient is not registered with your mobile number');
  return runBooking(res, { regNo, entryId, time, reason, priority: 'Routine', source: 'Patient Portal', bookedBy: null, walkIn: false, portal: true });
};

// POST /api/appointments/portal/:phone/appointments/:id/cancel { reason }
// Allowed until one hour before the slot.
export const portalCancel = async (req, res) => {
  try {
    const [[a]] = await db.query(
      `SELECT a.id, a.status, DATE_FORMAT(a.appt_date, '%Y-%m-%d') AS d, TIME_FORMAT(a.appt_time, '%H:%i') AS t
         FROM appointments a JOIN patients p ON p.reg_no = a.reg_no WHERE a.id = ? AND p.telephone = ?`,
      [req.params.id, req.params.phone]
    );
    if (!a) return fail(res, 404, 'Appointment not found');
    if (a.status !== 'Scheduled') return fail(res, 400, `This appointment is ${a.status.toLowerCase()}`);
    const now = nowIST();
    const cutoff = fromMinutes(toMinutes(now.time) + 60);
    if (a.d < now.date || (a.d === now.date && (a.t <= cutoff || toMinutes(now.time) + 60 >= 1440))) {
      return fail(res, 400, 'Online cancellation closes one hour before the appointment. Please call the hospital.');
    }
    await db.query(
      `UPDATE appointments SET status = 'Cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, queue_status = 'Cancelled'
        WHERE id = ? AND status = 'Scheduled'`,
      [now.datetime, `patient:${req.params.phone}`, String(req.body.reason || 'Cancelled by patient').slice(0, 255), a.id]
    );
    await cancelConsultationCharge(db, a.id, 'Cancelled by patient', null);
    res.json({ success: true });
  } catch (e) {
    console.error('portalCancel error:', e);
    fail(res, 500, 'Server error');
  }
};

export { FRONT_DESK_ROLES };
