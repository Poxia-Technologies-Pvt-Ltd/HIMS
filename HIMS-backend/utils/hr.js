import db from '../config/db.js';

// Shared helpers for the HMIS modules: employees, roster, leave, attendance,
// payroll, rooms and OP appointments.

export const HR_ADMIN_ROLES = ['Admin', 'Super Admin', 'HR Manager'];
export const ROSTER_ROLES = ['Admin', 'Super Admin', 'HR Manager', 'Lab Head', 'Medical Superintendent', 'Nursing Superintendent'];
export const FRONT_DESK_ROLES = ['Admin', 'Super Admin', 'Receptionist', 'Medical Superintendent'];

// Facility a READ is limited to. Facility-level users are pinned to their own
// facility whatever they send; Central users may narrow with ?branch_id=.
export const readScope = (req) => {
  if (req.user?.role_level === 'Central') {
    const b = req.query.branch_id ?? req.body?.branch_id;
    return b && b !== 'all' ? Number(b) : null;
  }
  return req.user?.branch_id ? Number(req.user.branch_id) : -1; // -1 matches nothing
};

// Facility a WRITE goes to. Central users must say which facility.
export const writeScope = (req) => {
  if (req.user?.role_level === 'Central') {
    const b = req.body?.branch_id ?? req.query.branch_id;
    return b ? Number(b) : null;
  }
  return req.user?.branch_id ? Number(req.user.branch_id) : null;
};

// True when a row belonging to `branchId` may be touched by this caller.
export const inScope = (req, branchId) =>
  req.user?.role_level === 'Central' || Number(branchId) === Number(req.user?.branch_id);

// ── IST date/time ─────────────────────────────────────────────────────────────
// The containers run in UTC; every HR date is an Indian wall-clock date, so
// derive it explicitly instead of trusting the process time zone.
const IST_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export const nowIST = (at = new Date()) => {
  const p = Object.fromEntries(IST_PARTS.formatToParts(at).map(({ type, value }) => [type, value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}:${p.second}`;
  return { date, time, datetime: `${date} ${time}` };
};

export const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);
export const isPeriod = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

// Calendar arithmetic on YYYY-MM-DD strings, done in UTC so DST/offsets never shift a day.
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
export const dateRange = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const weekdayOf = (iso) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
export const daysInMonth = (period) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export const toMinutes = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
};
export const fromMinutes = (min) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// A duty as an absolute minute interval from the duty date's midnight. An end
// at or before the start runs into the next day (night shift).
export const dutyInterval = (date, start, end) => {
  const base = daysBetween('2000-01-01', date) * 1440;
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += 1440;
  return [base + s, base + e];
};
export const overlaps = ([a1, a2], [b1, b2]) => a1 < b2 && b1 < a2;

// ── Settings ──────────────────────────────────────────────────────────────────
export const getHrSettings = async (branchId, conn = db) => {
  const [rows] = await conn.query(
    'SELECT * FROM hr_settings WHERE branch_id IN (0, ?) ORDER BY branch_id DESC LIMIT 1',
    [branchId || 0]
  );
  const s = rows[0] || {};
  const num = (k, d) => (s[k] === null || s[k] === undefined ? d : Number(s[k]));
  return {
    weekly_off: (s.weekly_off || 'Sun').split(',').map((x) => x.trim()).filter(Boolean),
    late_grace_minutes: num('late_grace_minutes', 15),
    half_day_ratio: num('half_day_ratio', 0.5),
    geofence_radius_m: s.geofence_radius_m === null || s.geofence_radius_m === undefined ? null : Number(s.geofence_radius_m),
    pf_employee_pct: num('pf_employee_pct', 12),
    pf_employer_pct: num('pf_employer_pct', 12),
    pf_wage_ceiling: num('pf_wage_ceiling', 15000),
    esi_employee_pct: num('esi_employee_pct', 0.75),
    esi_employer_pct: num('esi_employer_pct', 3.25),
    esi_gross_ceiling: num('esi_gross_ceiling', 21000),
    pt_threshold: num('pt_threshold', 25000),
    pt_amount: num('pt_amount', 200),
    pt_february_amount: num('pt_february_amount', 300),
    lop_basis: s.lop_basis || 'Calendar',
    ot_multiplier: num('ot_multiplier', 2),
  };
};

// The employee record behind the signed-in user, or null.
export const employeeForUser = async (userId, conn = db) => {
  if (!userId) return null;
  const [[row]] = await conn.query(
    `SELECT id, branch_id, employee_code, first_name, last_name, status, gender, weekly_off, default_shift_id
       FROM employees WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  return row || null;
};

export const roundMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Haversine distance in metres.
export const distanceMetres = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
};

export const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ success: false, message, ...extra });

// Holidays falling in [from, to] for a facility, as Map(date -> name). A
// recurring holiday is stored once and repeats on the same day every year.
export const holidaysBetween = async (branchId, from, to, conn = db) => {
  const [rows] = await conn.query(
    `SELECT holiday_name, DATE_FORMAT(holiday_date, '%Y-%m-%d') AS d, is_recurring FROM holidays
      WHERE (branch_id IS NULL ${branchId ? 'OR branch_id = ?' : ''}) AND (is_recurring = 1 OR holiday_date BETWEEN ? AND ?)`,
    branchId ? [branchId, from, to] : [from, to]
  );
  const out = new Map();
  for (const h of rows) {
    if (!h.is_recurring) { out.set(h.d, h.holiday_name); continue; }
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      const d = `${y}${h.d.slice(4)}`;
      if (d >= from && d <= to) out.set(d, h.holiday_name);
    }
  }
  return out;
};
