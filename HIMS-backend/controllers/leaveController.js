import db from '../config/db.js';
import { normalizeRole } from '../middleware/auth.js';
import {
  HR_ADMIN_ROLES, readScope, writeScope, inScope, isISODate, nowIST, dateRange, weekdayOf, getHrSettings,
  employeeForUser, holidaysBetween, fail,
} from '../utils/hr.js';
import { activeAppointmentsForEntry } from '../utils/opdSlots.js';

const isHrAdmin = (req) => HR_ADMIN_ROLES.includes(normalizeRole(req.user?.role));

// ── Leave types ───────────────────────────────────────────────────────────────

export const listLeaveTypes = async (req, res) => {
  try {
    const scope = readScope(req);
    const [rows] = await db.query(
      `SELECT * FROM leave_types WHERE (branch_id IS NULL ${scope ? 'OR branch_id = ?' : ''}) ${req.query.all === '1' ? '' : 'AND is_active = 1'}
       ORDER BY is_paid DESC, name`,
      scope ? [scope] : []
    );
    res.json({ success: true, leave_types: rows });
  } catch (e) {
    console.error('listLeaveTypes error:', e);
    fail(res, 500, 'Server error');
  }
};

const readLeaveType = (b) => {
  const name = String(b.name || '').trim().slice(0, 60);
  const code = String(b.code || '').trim().toUpperCase().slice(0, 10);
  if (!name || !code) return [null, 'Name and code are required'];
  const quota = Number(b.annual_quota) || 0;
  if (quota < 0 || quota > 366) return [null, 'Annual quota must be between 0 and 366 days'];
  return [{
    name, code, annual_quota: quota,
    is_paid: b.is_paid ? 1 : 0,
    carry_forward: b.carry_forward ? 1 : 0,
    max_carry_forward: Math.max(0, Number(b.max_carry_forward) || 0),
    requires_document: b.requires_document ? 1 : 0,
    applicable_gender: ['Any', 'Male', 'Female'].includes(b.applicable_gender) ? b.applicable_gender : 'Any',
    is_active: b.is_active === false || b.is_active === 0 ? 0 : 1,
  }, null];
};

export const createLeaveType = async (req, res) => {
  try {
    const [t, err] = readLeaveType(req.body);
    if (err) return fail(res, 400, err);
    const branchId = req.user.role_level === 'Central' ? (req.body.branch_id || null) : req.user.branch_id;
    const cols = Object.keys(t);
    const [r] = await db.query(
      `INSERT INTO leave_types (branch_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
      [branchId, ...cols.map((c) => t[c])]
    );
    res.status(201).json({ success: true, id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, 'A leave type with that code already exists');
    console.error('createLeaveType error:', e);
    fail(res, 500, 'Server error');
  }
};

export const updateLeaveType = async (req, res) => {
  try {
    const [[lt]] = await db.query('SELECT * FROM leave_types WHERE id = ?', [req.params.id]);
    if (!lt) return fail(res, 404, 'Leave type not found');
    if (lt.branch_id === null ? req.user.role_level !== 'Central' : !inScope(req, lt.branch_id)) {
      return fail(res, 403, 'This leave type is managed centrally');
    }
    const [t, err] = readLeaveType(req.body);
    if (err) return fail(res, 400, err);
    const cols = Object.keys(t);
    await db.query(`UPDATE leave_types SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => t[c]), lt.id]);
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, 'A leave type with that code already exists');
    console.error('updateLeaveType error:', e);
    fail(res, 500, 'Server error');
  }
};

// ── Balances ──────────────────────────────────────────────────────────────────

// Per-type balance for one employee and year.
const balancesFor = async (employeeId, year, conn = db) => {
  const [rows] = await conn.query(
    `SELECT lt.id AS leave_type_id, lt.name, lt.code, lt.is_paid, lt.annual_quota, lt.applicable_gender,
            COALESCE(lb.allotted, 0) AS allotted, COALESCE(lb.carried, 0) AS carried, COALESCE(lb.adjusted, 0) AS adjusted,
            COALESCE((SELECT SUM(days) FROM leave_requests r WHERE r.employee_id = ? AND r.leave_type_id = lt.id
                       AND r.status = 'Approved' AND YEAR(r.from_date) = ?), 0) AS used,
            COALESCE((SELECT SUM(days) FROM leave_requests r WHERE r.employee_id = ? AND r.leave_type_id = lt.id
                       AND r.status = 'Pending' AND YEAR(r.from_date) = ?), 0) AS pending
       FROM leave_types lt
       JOIN employees e ON e.id = ?
       LEFT JOIN leave_balances lb ON lb.leave_type_id = lt.id AND lb.employee_id = e.id AND lb.year = ?
      WHERE lt.is_active = 1 AND (lt.branch_id IS NULL OR lt.branch_id = e.branch_id)
        AND (lt.applicable_gender = 'Any' OR lt.applicable_gender = e.gender)
      ORDER BY lt.is_paid DESC, lt.name`,
    [employeeId, year, employeeId, year, employeeId, year]
  );
  return rows.map((r) => {
    const total = Number(r.allotted) + Number(r.carried) + Number(r.adjusted);
    const used = Number(r.used);
    const pending = Number(r.pending);
    // Unpaid leave (LOP) has no balance to run out of.
    const unlimited = !r.is_paid;
    return { ...r, total, used, pending, available: unlimited ? null : Math.max(0, total - used - pending), unlimited };
  });
};

// GET /api/leave/balances?employee_id&year
export const getBalances = async (req, res) => {
  try {
    const year = Number(req.query.year) || Number(nowIST().date.slice(0, 4));
    let employeeId = Number(req.query.employee_id);
    if (!employeeId || !isHrAdmin(req)) {
      const me = await employeeForUser(req.user.id);
      if (!me) return fail(res, 404, 'No employee record is linked to your login');
      if (employeeId && employeeId !== me.id) return fail(res, 403, 'Access denied');
      employeeId = me.id;
    } else {
      const [[emp]] = await db.query('SELECT branch_id FROM employees WHERE id = ?', [employeeId]);
      if (!emp || !inScope(req, emp.branch_id)) return fail(res, 404, 'Employee not found');
    }
    res.json({ success: true, year, employee_id: employeeId, balances: await balancesFor(employeeId, year) });
  } catch (e) {
    console.error('getBalances error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/leave/allocate { year, prorate }
// Sets each active employee's yearly quota and carries forward unused leave
// from the previous year where the type allows it. Safe to re-run: it
// overwrites allotted/carried, never manual adjustments or usage.
export const allocateYear = async (req, res) => {
  try {
    const branchId = writeScope(req);
    if (!branchId) return fail(res, 400, 'Select the facility');
    const year = Number(req.body.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail(res, 400, 'Invalid year');
    const prorate = req.body.prorate !== false;

    const [types] = await db.query(
      `SELECT * FROM leave_types WHERE is_active = 1 AND is_paid = 1 AND (annual_quota > 0 OR carry_forward = 1)
         AND (branch_id IS NULL OR branch_id = ?)`,
      [branchId]
    );
    const [emps] = await db.query(
      `SELECT id, gender, DATE_FORMAT(date_of_joining, '%Y-%m-%d') AS doj FROM employees WHERE branch_id = ? AND status = 'Active'`,
      [branchId]
    );
    let rows = 0;
    for (const emp of emps) {
      const prev = types.some((t) => t.carry_forward) ? await balancesFor(emp.id, year - 1) : [];
      for (const t of types) {
        if (t.applicable_gender !== 'Any' && t.applicable_gender !== emp.gender) continue;
        let allotted = Number(t.annual_quota);
        // Joined during the year: quota for the remaining months (joining month counts), to the nearest half day.
        if (prorate && emp.doj && emp.doj.startsWith(String(year)) && allotted > 0) {
          const monthsLeft = 12 - Number(emp.doj.slice(5, 7)) + 1;
          allotted = Math.round((allotted * monthsLeft / 12) * 2) / 2;
        }
        if (emp.doj && emp.doj.slice(0, 4) > String(year)) allotted = 0;
        let carried = 0;
        if (t.carry_forward) {
          const p = prev.find((b) => b.leave_type_id === t.id);
          if (p) carried = Math.min(Number(t.max_carry_forward) || 0, Math.max(0, p.total - p.used));
        }
        await db.query(
          `INSERT INTO leave_balances (employee_id, leave_type_id, year, allotted, carried) VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE allotted = VALUES(allotted), carried = VALUES(carried)`,
          [emp.id, t.id, year, allotted, carried]
        );
        rows++;
      }
    }
    res.json({ success: true, employees: emps.length, balances: rows });
  } catch (e) {
    console.error('allocateYear error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/leave/balances/adjust { employee_id, leave_type_id, year, delta }
// Manual credit/debit, e.g. compensatory off for working a holiday.
export const adjustBalance = async (req, res) => {
  try {
    const { employee_id, leave_type_id } = req.body;
    const year = Number(req.body.year) || Number(nowIST().date.slice(0, 4));
    const delta = Number(req.body.delta);
    if (!employee_id || !leave_type_id || !delta || Math.abs(delta) > 366 || (delta * 2) % 1 !== 0) {
      return fail(res, 400, 'Give employee, leave type and a change in half days');
    }
    const [[emp]] = await db.query('SELECT branch_id FROM employees WHERE id = ?', [employee_id]);
    if (!emp || !inScope(req, emp.branch_id)) return fail(res, 404, 'Employee not found');
    await db.query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, adjusted) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE adjusted = adjusted + VALUES(adjusted)`,
      [employee_id, leave_type_id, year, delta]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('adjustBalance error:', e);
    fail(res, 500, 'Server error');
  }
};

// ── Requests ──────────────────────────────────────────────────────────────────

// Leave days in a range for one employee: days they would have worked. A
// rostered duty counts even on a weekend; otherwise weekly offs and holidays don't.
const countLeaveDays = async (emp, from, to, halfDay, conn = db) => {
  if (halfDay !== 'None') return 0.5;
  const settings = await getHrSettings(emp.branch_id, conn);
  const weeklyOff = emp.weekly_off ? emp.weekly_off.split(',') : settings.weekly_off;
  const [roster] = await conn.query(
    `SELECT DATE_FORMAT(duty_date, '%Y-%m-%d') AS d, duty_type FROM roster_entries
      WHERE employee_id = ? AND status = 'Scheduled' AND duty_date BETWEEN ? AND ?`,
    [emp.id, from, to]
  );
  const holiday = await holidaysBetween(emp.branch_id, from, to, conn);
  const duty = new Map(roster.map((r) => [r.d, r.duty_type]));
  return dateRange(from, to).filter((d) => {
    if (duty.has(d)) return duty.get(d) !== 'Weekly Off';
    return !weeklyOff.includes(weekdayOf(d)) && !holiday.has(d);
  }).length;
};

const REQUEST_SELECT = `
  SELECT lr.id, lr.branch_id, lr.employee_id, lr.leave_type_id, DATE_FORMAT(lr.from_date, '%Y-%m-%d') AS from_date,
         DATE_FORMAT(lr.to_date, '%Y-%m-%d') AS to_date, lr.half_day, lr.days, lr.reason, lr.status,
         lr.applied_at, lr.decided_at, lr.decision_note,
         e.employee_code, e.first_name, e.last_name, e.designation, d.name AS department_name,
         lt.name AS leave_name, lt.code AS leave_code, lt.is_paid,
         CONCAT(du.first_name, ' ', du.last_name) AS decided_by_name
    FROM leave_requests lr
    JOIN employees e    ON e.id = lr.employee_id
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN users du      ON du.id = lr.decided_by`;

// GET /api/leave/requests?status&employee_id&from&to&mine=1
export const listRequests = async (req, res) => {
  try {
    const where = [];
    const params = [];
    const me = await employeeForUser(req.user.id);
    if (req.query.mine === '1' || !isHrAdmin(req)) {
      // Non-HR see their own requests plus those of people reporting to them.
      if (!me) return res.json({ success: true, requests: [] });
      if (req.query.mine === '1') { where.push('lr.employee_id = ?'); params.push(me.id); }
      else { where.push('(lr.employee_id = ? OR e.reporting_to = ?)'); params.push(me.id, me.id); }
    } else {
      const scope = readScope(req);
      if (scope) { where.push('lr.branch_id = ?'); params.push(scope); }
    }
    if (req.query.status && req.query.status !== 'all') { where.push('lr.status = ?'); params.push(req.query.status); }
    if (req.query.employee_id) { where.push('lr.employee_id = ?'); params.push(req.query.employee_id); }
    if (isISODate(req.query.from)) { where.push('lr.to_date >= ?'); params.push(req.query.from); }
    if (isISODate(req.query.to)) { where.push('lr.from_date <= ?'); params.push(req.query.to); }
    const [rows] = await db.query(
      `${REQUEST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY lr.status = 'Pending' DESC, lr.from_date DESC LIMIT 500`,
      params
    );
    res.json({ success: true, requests: rows, my_employee_id: me?.id || null });
  } catch (e) {
    console.error('listRequests error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/leave/requests { leave_type_id, from_date, to_date, half_day, reason, employee_id? }
// employee_id is for HR applying on someone's behalf; everyone else applies for themself.
export const applyLeave = async (req, res) => {
  try {
    const b = req.body;
    let emp;
    if (b.employee_id && isHrAdmin(req)) {
      [[emp]] = await db.query('SELECT id, branch_id, gender, weekly_off, status FROM employees WHERE id = ?', [b.employee_id]);
      if (!emp || !inScope(req, emp.branch_id)) return fail(res, 404, 'Employee not found');
    } else {
      emp = await employeeForUser(req.user.id);
      if (!emp) return fail(res, 404, 'No employee record is linked to your login');
    }
    if (emp.status !== 'Active') return fail(res, 400, 'Employee is not active');

    const from = b.from_date;
    const to = b.to_date || from;
    if (!isISODate(from) || !isISODate(to) || to < from) return fail(res, 400, 'Give valid from and to dates');
    if (from.slice(0, 4) !== to.slice(0, 4)) return fail(res, 400, 'Leave across two calendar years must be applied as two requests');
    const halfDay = ['First Half', 'Second Half'].includes(b.half_day) ? b.half_day : 'None';
    if (halfDay !== 'None' && from !== to) return fail(res, 400, 'Half-day leave is for a single date');
    const reason = String(b.reason || '').trim().slice(0, 500);
    if (!reason) return fail(res, 400, 'Give a reason');

    const [[lt]] = await db.query(
      'SELECT * FROM leave_types WHERE id = ? AND is_active = 1 AND (branch_id IS NULL OR branch_id = ?)',
      [b.leave_type_id, emp.branch_id]
    );
    if (!lt) return fail(res, 400, 'Leave type not found');
    if (lt.applicable_gender !== 'Any' && lt.applicable_gender !== emp.gender) return fail(res, 400, `${lt.name} does not apply to this employee`);

    const [[clash]] = await db.query(
      `SELECT id, DATE_FORMAT(from_date, '%Y-%m-%d') AS f, DATE_FORMAT(to_date, '%Y-%m-%d') AS t, half_day FROM leave_requests
        WHERE employee_id = ? AND status IN ('Pending','Approved') AND from_date <= ? AND to_date >= ? LIMIT 1`,
      [emp.id, to, from]
    );
    // Two different halves of one day are the only allowed overlap.
    if (clash && !(halfDay !== 'None' && clash.half_day !== 'None' && clash.half_day !== halfDay)) {
      return fail(res, 409, `Overlaps an existing request (${clash.f} to ${clash.t})`);
    }

    const days = await countLeaveDays(emp, from, to, halfDay);
    if (days <= 0) return fail(res, 400, 'Those dates are all weekly offs or holidays');
    if (lt.is_paid) {
      const bal = (await balancesFor(emp.id, Number(from.slice(0, 4)))).find((x) => x.leave_type_id === lt.id);
      if (!bal || bal.available < days) {
        return fail(res, 400, `Not enough ${lt.code} balance: ${bal?.available ?? 0} available, ${days} requested`);
      }
    }
    const [r] = await db.query(
      `INSERT INTO leave_requests (branch_id, employee_id, leave_type_id, from_date, to_date, half_day, days, reason, applied_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp.branch_id, emp.id, lt.id, from, to, halfDay, days, reason, req.user.id]
    );
    res.status(201).json({ success: true, id: r.insertId, days });
  } catch (e) {
    console.error('applyLeave error:', e);
    fail(res, 500, 'Server error');
  }
};

// HR, or the employee's reporting manager, may decide — never the applicant.
const loadForDecision = async (req, res) => {
  const [[lr]] = await db.query(
    `SELECT lr.*, DATE_FORMAT(lr.from_date, '%Y-%m-%d') AS from_date, DATE_FORMAT(lr.to_date, '%Y-%m-%d') AS to_date,
            e.reporting_to, e.user_id AS emp_user_id
       FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id WHERE lr.id = ?`,
    [req.params.id]
  );
  if (!lr || !inScope(req, lr.branch_id)) { fail(res, 404, 'Request not found'); return null; }
  if (lr.emp_user_id && lr.emp_user_id === req.user.id) { fail(res, 403, 'You cannot decide your own leave'); return null; }
  if (!isHrAdmin(req)) {
    const me = await employeeForUser(req.user.id);
    if (!me || me.id !== lr.reporting_to) { fail(res, 403, 'Only HR or the reporting manager can decide this request'); return null; }
  }
  if (lr.status !== 'Pending') { fail(res, 400, `This request is already ${lr.status.toLowerCase()}`); return null; }
  return lr;
};

// POST /api/leave/requests/:id/approve { note, release_duties }
// Full-day leave releases the employee's roster duties in the range. OPD
// sessions with booked patients block approval unless release_duties is set,
// which also cancels those appointments; the list comes back for the front
// desk to inform the patients.
export const approveLeave = async (req, res) => {
  try {
    const lr = await loadForDecision(req, res);
    if (!lr) return;
    const [[lt]] = await db.query('SELECT * FROM leave_types WHERE id = ?', [lr.leave_type_id]);
    if (lt.is_paid) {
      const bal = (await balancesFor(lr.employee_id, Number(lr.from_date.slice(0, 4)))).find((x) => x.leave_type_id === lt.id);
      // This request is counted in `pending`, so it fits when available >= 0.
      if (!bal || bal.total - bal.used < Number(lr.days)) return fail(res, 400, `Not enough ${lt.code} balance left to approve this request`);
    }

    const [duties] = lr.half_day === 'None' ? await db.query(
      `SELECT id, duty_type, DATE_FORMAT(duty_date, '%Y-%m-%d') AS duty_date FROM roster_entries
        WHERE employee_id = ? AND status = 'Scheduled' AND duty_date BETWEEN ? AND ?`,
      [lr.employee_id, lr.from_date, lr.to_date]
    ) : [[]];
    const booked = [];
    for (const d of duties.filter((x) => x.duty_type === 'OPD')) {
      const appts = await activeAppointmentsForEntry(d.id);
      if (appts.length) booked.push({ roster_entry_id: d.id, duty_date: d.duty_date, appointments: appts });
    }
    if (booked.length && !req.body.release_duties) {
      return fail(res, 409, `Patients are booked with this employee on ${booked.map((b) => b.duty_date).join(', ')}`, { booked });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const now = nowIST().datetime;
      await conn.query(
        `UPDATE leave_requests SET status = 'Approved', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'Pending'`,
        [req.user.id, now, String(req.body.note || '').slice(0, 500) || null, lr.id]
      );
      if (duties.length) {
        await conn.query(
          `UPDATE roster_entries SET status = 'Cancelled', notes = CONCAT_WS(' · ', notes, ?) WHERE id IN (?)`,
          [`On leave (request #${lr.id})`, duties.map((d) => d.id)]
        );
      }
      if (booked.length) {
        await conn.query(
          `UPDATE appointments SET status = 'Cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = 'Doctor on leave'
            WHERE roster_entry_id IN (?) AND status = 'Scheduled'`,
          [now, `user:${req.user.id}`, booked.map((b) => b.roster_entry_id)]
        );
        await conn.query(
          `UPDATE patient_charges pc JOIN appointments a ON pc.source_type = 'Consultation' AND pc.source_id = a.id
            SET pc.status = 'Cancelled', pc.cancel_reason = ?
          WHERE a.roster_entry_id IN (?) AND a.status = 'Cancelled' AND pc.status = 'Unbilled'`,
          ['Doctor on leave', booked.map((b) => b.roster_entry_id)]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
    res.json({ success: true, released_duties: duties.length, cancelled_appointments: booked.flatMap((b) => b.appointments) });
  } catch (e) {
    console.error('approveLeave error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/leave/requests/:id/reject { note }
export const rejectLeave = async (req, res) => {
  try {
    const lr = await loadForDecision(req, res);
    if (!lr) return;
    const note = String(req.body.note || '').trim().slice(0, 500);
    if (!note) return fail(res, 400, 'Give a reason for rejecting');
    await db.query(
      `UPDATE leave_requests SET status = 'Rejected', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?`,
      [req.user.id, nowIST().datetime, note, lr.id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('rejectLeave error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/leave/requests/:id/cancel — the applicant withdraws (pending, or
// approved leave that hasn't started), or HR cancels. Released duties are not
// restored automatically; re-roster them if needed.
export const cancelLeave = async (req, res) => {
  try {
    const [[lr]] = await db.query(
      `SELECT lr.*, DATE_FORMAT(lr.from_date, '%Y-%m-%d') AS from_date, e.user_id AS emp_user_id
         FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id WHERE lr.id = ?`,
      [req.params.id]
    );
    if (!lr || !inScope(req, lr.branch_id)) return fail(res, 404, 'Request not found');
    const own = lr.emp_user_id === req.user.id;
    if (!own && !isHrAdmin(req)) return fail(res, 403, 'Access denied');
    if (!['Pending', 'Approved'].includes(lr.status)) return fail(res, 400, `This request is already ${lr.status.toLowerCase()}`);
    if (lr.status === 'Approved' && !isHrAdmin(req) && lr.from_date <= nowIST().date) {
      return fail(res, 400, 'Leave that has started can only be cancelled by HR');
    }
    await db.query(
      `UPDATE leave_requests SET status = 'Cancelled', decided_by = ?, decided_at = ?, decision_note = COALESCE(?, decision_note) WHERE id = ?`,
      [req.user.id, nowIST().datetime, req.body.note ? String(req.body.note).slice(0, 500) : null, lr.id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('cancelLeave error:', e);
    fail(res, 500, 'Server error');
  }
};

export { countLeaveDays };
