import db from '../config/db.js';
import { toMinutes, fromMinutes } from './hr.js';

// Appointment statuses that hold a slot. Cancelled and No Show free it.
export const ACTIVE_APPT_STATUSES = ['Scheduled', 'Checked In', 'In Consultation', 'Completed'];
const ACTIVE_SQL = ACTIVE_APPT_STATUSES.map((s) => `'${s}'`).join(',');
export { ACTIVE_SQL };

// Slot start times for an OPD duty, e.g. 09:00, 09:15 … up to (not including) the end.
export const slotTimes = (entry) => {
  const start = toMinutes(entry.start_time);
  const end = toMinutes(entry.end_time);
  const step = Math.max(5, Number(entry.slot_minutes) || 15);
  const out = [];
  for (let m = start; m + step <= end; m += step) out.push(fromMinutes(m));
  return out;
};

// Slots of one OPD duty with how many patients each already holds.
export const slotsForEntry = async (entry, conn = db) => {
  const [booked] = await conn.query(
    `SELECT TIME_FORMAT(appt_time, '%H:%i') AS t, COUNT(*) AS n
       FROM appointments
      WHERE roster_entry_id = ? AND status IN (${ACTIVE_SQL})
      GROUP BY t`,
    [entry.id]
  );
  const counts = Object.fromEntries(booked.map((b) => [b.t, Number(b.n)]));
  const capacity = Math.max(1, Number(entry.patients_per_slot) || 1);
  return slotTimes(entry).map((time) => ({
    time,
    booked: counts[time] || 0,
    capacity,
    available: Math.max(0, capacity - (counts[time] || 0)),
  }));
};

// Active appointments held by one OPD duty.
export const activeAppointmentsForEntry = async (entryId, conn = db) => {
  const [rows] = await conn.query(
    `SELECT a.id, a.reg_no, TIME_FORMAT(a.appt_time, '%H:%i') AS appt_time, a.status,
            CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name, p.telephone
       FROM appointments a LEFT JOIN patients p ON p.reg_no = a.reg_no
      WHERE a.roster_entry_id = ? AND a.status IN ('Scheduled','Checked In','In Consultation')
      ORDER BY a.appt_time`,
    [entryId]
  );
  return rows;
};
