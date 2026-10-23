import db from '../config/db.js';
import {
  dateRange, weekdayOf, dutyInterval, toMinutes, nowIST, getHrSettings, holidaysBetween,
} from './hr.js';

// Turns roster, punches, approved leave, holidays and weekly offs into one
// status per employee per day. Payroll reads paid days, LOP and overtime from
// here, so the attendance screens and the payslip can never disagree.
//
// paid: fraction of the day that is paid (1, 0.5, 0). Days outside the
// employment period are neither paid nor LOP (employed = false), and neither
// are days that haven't happened yet (status Upcoming), so a running month
// reads "to date".


const OT_THRESHOLD_MIN = 30;   // shorter overruns are not overtime
const OT_BLOCK_MIN = 15;       // overtime counts in 15-minute blocks
const DEFAULT_SHIFT = { start_time: '09:00', end_time: '17:00', break_minutes: 30 };

const minutesOf = (datetime) => {
  // 'YYYY-MM-DD HH:MM:SS' -> absolute minutes on the same scale as dutyInterval.
  const [d, t] = datetime.split(' ');
  return dutyInterval(d, '00:00', '00:01')[0] + toMinutes(t);
};

// Pairs IN/OUT punches in time order. An IN with no OUT is left open.
const pairPunches = (punches) => {
  const pairs = [];
  let open = null;
  for (const p of punches) {
    if (p.punch_type === 'IN') {
      if (!open) open = p;
    } else if (open) {
      pairs.push([open, p]);
      open = null;
    }
  }
  return { pairs, open };
};

export async function computeAttendance(employeeIds, from, to, conn = db) {
  if (!employeeIds.length) return new Map();
  const [emps] = await conn.query(
    `SELECT e.id, e.branch_id, e.weekly_off, e.default_shift_id,
            DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS doj, DATE_FORMAT(e.date_of_leaving, '%Y-%m-%d') AS dol,
            TIME_FORMAT(s.start_time, '%H:%i') AS s_start, TIME_FORMAT(s.end_time, '%H:%i') AS s_end, s.break_minutes AS s_break
       FROM employees e LEFT JOIN shifts s ON s.id = e.default_shift_id
      WHERE e.id IN (?)`,
    [employeeIds]
  );
  const [roster] = await conn.query(
    `SELECT r.employee_id, DATE_FORMAT(r.duty_date, '%Y-%m-%d') AS d, TIME_FORMAT(r.start_time, '%H:%i') AS start_time,
            TIME_FORMAT(r.end_time, '%H:%i') AS end_time, r.duty_type, COALESCE(s.break_minutes, 0) AS break_minutes
       FROM roster_entries r LEFT JOIN shifts s ON s.id = r.shift_id
      WHERE r.employee_id IN (?) AND r.status = 'Scheduled' AND r.duty_date BETWEEN ? AND ?`,
    [employeeIds, from, to]
  );
  const [punches] = await conn.query(
    `SELECT id, employee_id, DATE_FORMAT(attendance_date, '%Y-%m-%d') AS d, punch_type,
            DATE_FORMAT(punched_at, '%Y-%m-%d %H:%i:%s') AS at, source
       FROM attendance_punches WHERE employee_id IN (?) AND attendance_date BETWEEN ? AND ?
      ORDER BY punched_at, id`,
    [employeeIds, from, to]
  );
  const [leaves] = await conn.query(
    `SELECT lr.employee_id, DATE_FORMAT(lr.from_date, '%Y-%m-%d') AS f, DATE_FORMAT(lr.to_date, '%Y-%m-%d') AS t,
            lr.half_day, lt.code, lt.is_paid
       FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.employee_id IN (?) AND lr.status = 'Approved' AND lr.from_date <= ? AND lr.to_date >= ?`,
    [employeeIds, to, from]
  );

  const settingsCache = new Map();
  const holidayCache = new Map();
  const today = nowIST();
  const result = new Map();

  for (const emp of emps) {
    if (!settingsCache.has(emp.branch_id)) {
      settingsCache.set(emp.branch_id, await getHrSettings(emp.branch_id, conn));
      holidayCache.set(emp.branch_id, await holidaysBetween(emp.branch_id, from, to, conn));
    }
    const settings = settingsCache.get(emp.branch_id);
    const holidays = holidayCache.get(emp.branch_id);
    const weeklyOff = emp.weekly_off ? emp.weekly_off.split(',') : settings.weekly_off;
    const defShift = emp.s_start ? { start_time: emp.s_start, end_time: emp.s_end, break_minutes: Number(emp.s_break) || 0 } : DEFAULT_SHIFT;

    const days = [];
    for (const d of dateRange(from, to)) {
      const day = {
        date: d, weekday: weekdayOf(d), status: null, employed: true, paid: 0, present: 0,
        scheduled_minutes: 0, worked_minutes: 0, late_minutes: 0, ot_minutes: 0,
        first_in: null, last_out: null, missing_out: false, leave_code: null, holiday: holidays.get(d) || null, duties: [],
      };
      days.push(day);
      if ((emp.doj && d < emp.doj) || (emp.dol && d > emp.dol)) {
        day.employed = false; day.status = 'Not Employed'; continue;
      }

      const duties = roster.filter((r) => r.employee_id === emp.id && r.d === d);
      day.duties = duties.map((r) => ({ duty_type: r.duty_type, start_time: r.start_time, end_time: r.end_time }));
      const work = duties.filter((r) => r.duty_type !== 'Weekly Off');
      let offDay = false;
      let schedule = [];
      if (duties.length && !work.length) offDay = 'Weekly Off';
      else if (work.length) schedule = work;
      else if (weeklyOff.includes(day.weekday)) offDay = 'Weekly Off';
      else if (day.holiday) offDay = 'Holiday';
      else schedule = [defShift];

      let scheduledNet = 0;
      let startAt = null;
      for (const s of schedule) {
        const [a, b] = dutyInterval(d, s.start_time, s.end_time);
        day.scheduled_minutes += b - a;
        scheduledNet += b - a - (Number(s.break_minutes) || 0);
        if (startAt === null || a < startAt) startAt = a;
      }

      const mine = punches.filter((p) => p.employee_id === emp.id && p.d === d);
      const { pairs, open } = pairPunches(mine);
      day.worked_minutes = pairs.reduce((n, [i, o]) => n + Math.max(0, minutesOf(o.at) - minutesOf(i.at)), 0);
      const ins = mine.filter((p) => p.punch_type === 'IN');
      const outs = mine.filter((p) => p.punch_type === 'OUT');
      day.first_in = ins[0]?.at || null;
      day.last_out = outs.length ? outs[outs.length - 1].at : null;
      day.missing_out = !!open && d < today.date;
      day.open_in = !!open;
      const attended = mine.length > 0;

      const leave = leaves.find((l) => l.employee_id === emp.id && d >= l.f && d <= l.t);
      if (leave) day.leave_code = leave.code;

      // Not yet happened (or today, not yet punched and not on leave): shown
      // with its duty/leave, but neither paid nor absent.
      if (d > today.date || (d === today.date && !attended && !leave)) {
        day.status = 'Upcoming';
        continue;
      }

      if (offDay) {
        day.status = offDay;
        day.paid = 1;
        // Working a weekly off or holiday is all overtime.
        if (day.worked_minutes >= OT_THRESHOLD_MIN) day.ot_minutes = Math.floor(day.worked_minutes / OT_BLOCK_MIN) * OT_BLOCK_MIN;
        if (attended) day.present = 1;
        continue;
      }

      if (startAt !== null && day.first_in) {
        const late = minutesOf(day.first_in) - startAt - settings.late_grace_minutes;
        if (late > 0) day.late_minutes = late + settings.late_grace_minutes;
      }
      const over = day.worked_minutes - scheduledNet;
      if (over >= OT_THRESHOLD_MIN) day.ot_minutes = Math.floor(over / OT_BLOCK_MIN) * OT_BLOCK_MIN;

      if (leave && leave.half_day === 'None') {
        day.status = 'Leave';
        day.paid = leave.is_paid ? 1 : 0;
        day.unpaid_leave = leave.is_paid ? 0 : 1;
        continue;
      }
      // A missed OUT punch is treated as a full day until HR corrects it.
      const fullDay = day.missing_out || open || day.worked_minutes >= scheduledNet * settings.half_day_ratio;
      if (leave) {
        day.status = 'Half Leave';
        day.present = attended ? 0.5 : 0;
        day.paid = (attended ? 0.5 : 0) + (leave.is_paid ? 0.5 : 0);
        day.unpaid_leave = leave.is_paid ? 0 : 0.5;
      } else if (!attended) {
        day.status = 'Absent';
      } else if (fullDay) {
        day.status = 'Present';
        day.present = 1;
        day.paid = 1;
      } else {
        day.status = 'Half Day';
        day.present = 0.5;
        day.paid = 0.5;
      }
    }

    const employed = days.filter((x) => x.employed && x.status !== 'Upcoming');
    const sum = (k) => employed.reduce((n, x) => n + x[k], 0);
    const count = (st) => employed.filter((x) => x.status === st).length;
    result.set(emp.id, {
      days,
      summary: {
        employed_days: employed.length,
        upcoming_days: days.filter((x) => x.status === 'Upcoming').length,
        unpaid_leave_days: employed.reduce((n, x) => n + (x.unpaid_leave || 0), 0),
        paid_days: sum('paid'),
        lop_days: employed.length - sum('paid'),
        present_days: sum('present'),
        absent_days: count('Absent'),
        half_days: count('Half Day'),
        leave_days: employed.filter((x) => x.leave_code).reduce((n, x) => n + (x.status === 'Half Leave' ? 0.5 : 1), 0),
        weekly_offs: count('Weekly Off'),
        holidays: count('Holiday'),
        late_days: employed.filter((x) => x.late_minutes > 0).length,
        missing_out: employed.filter((x) => x.missing_out).length,
        ot_hours: Math.round((sum('ot_minutes') / 60) * 100) / 100,
      },
    });
  }
  return result;
}
