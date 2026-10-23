import db from '../config/db.js';

// Preventive-maintenance schedules, due / overdue alerts and service history
// for lab equipment. Overdue equipment WARNS only — nothing here blocks testing.

const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null);
const UNITS = ['Day', 'Week', 'Month', 'Year'];
const TYPES = ['Preventive maintenance', 'Calibration', 'Quality control', 'Cleaning', 'Other'];

// Standard starting schedule, applied per analyzer with one click.
const STANDARD = [
  { task_name: 'Daily cleaning and startup checks', task_type: 'Cleaning',                unit: 'Day',   every: 1, warn: 0 },
  { task_name: 'Quality control run',               task_type: 'Quality control',         unit: 'Day',   every: 1, warn: 0 },
  { task_name: 'Weekly preventive maintenance',     task_type: 'Preventive maintenance',  unit: 'Week',  every: 1, warn: 2 },
  { task_name: 'Monthly preventive maintenance',    task_type: 'Preventive maintenance',  unit: 'Month', every: 1, warn: 7 },
  { task_name: 'Calibration',                       task_type: 'Calibration',             unit: 'Month', every: 6, warn: 14 },
  { task_name: 'Annual service by manufacturer',    task_type: 'Preventive maintenance',  unit: 'Year',  every: 1, warn: 30 },
];

// All dates here are the hospital's LOCAL calendar days (never UTC — a UTC
// conversion turns "today" into "yesterday" for the first hours of an Indian day).
const p2 = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const localDateTime = (d = new Date()) => `${localYmd(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
const addInterval = (dateStr, unit, every) => {
  const d = new Date(`${dateStr}T00:00:00`);
  if (unit === 'Day') d.setDate(d.getDate() + every);
  else if (unit === 'Week') d.setDate(d.getDate() + 7 * every);
  else if (unit === 'Month') d.setMonth(d.getMonth() + every);
  else d.setFullYear(d.getFullYear() + every);
  return localYmd(d);
};
const today = () => localYmd(new Date());
const ymd = (v) => (v instanceof Date ? localYmd(v) : String(v).slice(0, 10));

const stateOf = (next, warnDays) => {
  const days = Math.round((new Date(`${ymd(next)}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000);
  return { days_until_due: days, state: days < 0 ? 'Overdue' : days <= warnDays ? 'Due soon' : 'OK' };
};

async function machineInScope(req, machineId) {
  const pin = pinned(req);
  const [[m]] = await db.query(
    `SELECT m.id, m.name, m.model, i.name AS lab_name, i.branch_id FROM lab_machines m LEFT JOIN infrastructure i ON i.id = m.lab_id
     WHERE m.id = ? ${pin ? 'AND i.branch_id = ?' : ''}`, pin ? [machineId, pin] : [machineId]);
  return m || null;
}

// Every active schedule with its live state, for the facility.
async function loadSchedules(req, machineId = null) {
  const pin = pinned(req);
  const [rows] = await db.query(
    `SELECT s.*, m.name AS machine_name, m.model, m.manufacturer, m.status AS machine_status, i.name AS lab_name, i.branch_id
     FROM equipment_pm_schedules s
     JOIN lab_machines m ON m.id = s.machine_id
     LEFT JOIN infrastructure i ON i.id = m.lab_id
     WHERE s.active = 1 ${pin ? 'AND i.branch_id = ?' : ''} ${machineId ? 'AND s.machine_id = ?' : ''}
     ORDER BY s.next_due_at ASC, m.name`,
    [...(pin ? [pin] : []), ...(machineId ? [machineId] : [])]
  );
  return rows.map((r) => ({ ...r, last_done_at: r.last_done_at ? ymd(r.last_done_at) : null, next_due_at: ymd(r.next_due_at), ...stateOf(r.next_due_at, r.warn_days_before) }));
}

// GET /api/lab/maintenance/overview — all equipment with its schedules and counts.
export const getMaintenanceOverview = async (req, res) => {
  try {
    const pin = pinned(req);
    const [machines] = await db.query(
      `SELECT m.id, m.name, m.model, m.manufacturer, m.serial_number, m.status, i.name AS lab_name
       FROM lab_machines m LEFT JOIN infrastructure i ON i.id = m.lab_id ${pin ? 'WHERE i.branch_id = ?' : ''} ORDER BY m.name`, pin ? [pin] : []);
    const schedules = await loadSchedules(req);
    const equipment = machines.map((m) => {
      const mine = schedules.filter((s) => s.machine_id === m.id);
      return { ...m, schedules: mine, overdue: mine.filter((s) => s.state === 'Overdue').length, due_soon: mine.filter((s) => s.state === 'Due soon').length };
    });
    res.json({
      success: true, equipment, standard: STANDARD,
      summary: { equipment: machines.length, overdue: schedules.filter((s) => s.state === 'Overdue').length, due_soon: schedules.filter((s) => s.state === 'Due soon').length, without_schedule: equipment.filter((e) => e.schedules.length === 0).length },
    });
  } catch (error) {
    console.error('Error loading maintenance overview:', error);
    res.status(500).json({ success: false, message: 'Server error loading maintenance overview' });
  }
};

// GET /api/lab/maintenance/alerts — only what needs attention (overdue / due soon).
export const getMaintenanceAlerts = async (req, res) => {
  try {
    const all = await loadSchedules(req);
    const alerts = all.filter((s) => s.state !== 'OK');
    res.json({ success: true, alerts, overdue: alerts.filter((a) => a.state === 'Overdue').length, due_soon: alerts.filter((a) => a.state === 'Due soon').length });
  } catch (error) {
    console.error('Error loading maintenance alerts:', error);
    res.status(500).json({ success: false, message: 'Server error loading maintenance alerts' });
  }
};

// POST /api/lab/maintenance/schedules
export const createSchedule = async (req, res) => {
  try {
    const b = req.body || {};
    const m = await machineInScope(req, b.machine_id);
    if (!m) return res.status(404).json({ success: false, message: 'Equipment not found.' });
    const name = String(b.task_name || '').trim().slice(0, 120);
    const every = parseInt(b.frequency_every, 10);
    if (name.length < 3) return res.status(400).json({ success: false, message: 'Enter the task name.' });
    if (!UNITS.includes(b.frequency_unit) || !(every >= 1 && every <= 120)) return res.status(400).json({ success: false, message: 'Set how often it is due.' });
    const first = /^\d{4}-\d{2}-\d{2}$/.test(String(b.first_due_at || '')) ? b.first_due_at : addInterval(today(), b.frequency_unit, every);
    await db.query(
      `INSERT INTO equipment_pm_schedules (machine_id, task_name, task_type, frequency_unit, frequency_every, warn_days_before, next_due_at, instructions, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.id, name, TYPES.includes(b.task_type) ? b.task_type : 'Preventive maintenance', b.frequency_unit, every, Math.min(Math.max(parseInt(b.warn_days_before, 10) || 0, 0), 365), first,
       b.instructions ? String(b.instructions).slice(0, 500) : null, req.user?.id || null]
    );
    res.json({ success: true, message: 'Schedule added.' });
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(500).json({ success: false, message: 'Server error creating schedule' });
  }
};

// POST /api/lab/maintenance/apply-standard { machine_id }
export const applyStandardSchedule = async (req, res) => {
  try {
    const m = await machineInScope(req, req.body.machine_id);
    if (!m) return res.status(404).json({ success: false, message: 'Equipment not found.' });
    const [have] = await db.query('SELECT task_name FROM equipment_pm_schedules WHERE machine_id = ? AND active = 1', [m.id]);
    const names = new Set(have.map((h) => h.task_name));
    let added = 0;
    for (const t of STANDARD) {
      if (names.has(t.task_name)) continue;
      await db.query(
        `INSERT INTO equipment_pm_schedules (machine_id, task_name, task_type, frequency_unit, frequency_every, warn_days_before, next_due_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [m.id, t.task_name, t.task_type, t.unit, t.every, t.warn, addInterval(today(), t.unit, t.every), req.user?.id || null]);
      added += 1;
    }
    res.json({ success: true, message: added ? `${added} standard task${added > 1 ? 's' : ''} added.` : 'This equipment already has the standard tasks.' });
  } catch (error) {
    console.error('Error applying standard schedule:', error);
    res.status(500).json({ success: false, message: 'Server error applying standard schedule' });
  }
};

// PUT /api/lab/maintenance/schedules/:id  — edit or switch off
export const updateSchedule = async (req, res) => {
  try {
    const [[s]] = await db.query('SELECT * FROM equipment_pm_schedules WHERE id = ?', [req.params.id]);
    if (!s || !(await machineInScope(req, s.machine_id))) return res.status(404).json({ success: false, message: 'Schedule not found.' });
    const b = req.body || {};
    const every = b.frequency_every === undefined ? s.frequency_every : parseInt(b.frequency_every, 10);
    const unit = b.frequency_unit === undefined ? s.frequency_unit : b.frequency_unit;
    if (!UNITS.includes(unit) || !(every >= 1 && every <= 120)) return res.status(400).json({ success: false, message: 'Set how often it is due.' });
    await db.query(
      `UPDATE equipment_pm_schedules SET task_name = ?, task_type = ?, frequency_unit = ?, frequency_every = ?, warn_days_before = ?,
              next_due_at = COALESCE(?, next_due_at), instructions = ?, active = ? WHERE id = ?`,
      [b.task_name ? String(b.task_name).trim().slice(0, 120) : s.task_name, TYPES.includes(b.task_type) ? b.task_type : s.task_type, unit, every,
       b.warn_days_before === undefined ? s.warn_days_before : Math.min(Math.max(parseInt(b.warn_days_before, 10) || 0, 0), 365),
       /^\d{4}-\d{2}-\d{2}$/.test(String(b.next_due_at || '')) ? b.next_due_at : null,
       b.instructions === undefined ? s.instructions : (b.instructions ? String(b.instructions).slice(0, 500) : null),
       b.active === false ? 0 : 1, s.id]);
    res.json({ success: true, message: 'Schedule updated.' });
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(500).json({ success: false, message: 'Server error updating schedule' });
  }
};

// POST /api/lab/maintenance/schedules/:id/complete
//   { performed_at?, outcome, notes, parts_used, vendor, performed_by_name (LIS-Agent only) }
export const completeTask = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const b = req.body || {};
    let who = null;
    if (req.user?.id) {
      const [[u]] = await connection.query("SELECT CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id = ?", [req.user.id]);
      who = u?.name || null;
    } else {
      who = String(b.performed_by_name || '').trim().slice(0, 150);
      if (who.length < 3) return res.status(400).json({ success: false, message: 'Enter your name — it is recorded as who did the work.' });
      who = `${who} (via ${req.user?.device_label || 'workstation'})`;
    }
    const outcome = ['Completed', 'Completed with issues', 'Not completed'].includes(b.outcome) ? b.outcome : 'Completed';
    const notes = String(b.notes || '').trim().slice(0, 1000);
    if (outcome !== 'Completed' && notes.length < 5) return res.status(400).json({ success: false, message: 'Describe what happened.' });
    const performed = /^\d{4}-\d{2}-\d{2}/.test(String(b.performed_at || '')) ? String(b.performed_at).slice(0, 16).replace('T', ' ') : localDateTime();
    if (new Date(performed.replace(' ', 'T')) > new Date(Date.now() + 3600 * 1000)) return res.status(400).json({ success: false, message: 'The date cannot be in the future.' });

    await connection.beginTransaction();
    const [[s]] = await connection.query('SELECT * FROM equipment_pm_schedules WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!s || !(await machineInScope(req, s.machine_id))) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Schedule not found.' }); }

    const doneDate = performed.slice(0, 10);
    const dueWas = ymd(s.next_due_at);
    const nextDue = outcome === 'Not completed' ? dueWas : addInterval(doneDate, s.frequency_unit, s.frequency_every);
    await connection.query(
      `INSERT INTO equipment_maintenance_log (machine_id, schedule_id, task_name, task_type, performed_at, performed_by, performed_by_name, outcome, notes, parts_used, vendor, was_overdue, due_was, next_due_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.machine_id, s.id, s.task_name, s.task_type, performed, req.user?.id || null, who, outcome, notes || null,
       b.parts_used ? String(b.parts_used).slice(0, 500) : null, b.vendor ? String(b.vendor).slice(0, 200) : null,
       dueWas < doneDate ? 1 : 0, dueWas, nextDue]);
    if (outcome !== 'Not completed') {
      await connection.query('UPDATE equipment_pm_schedules SET last_done_at = ?, next_due_at = ? WHERE id = ?', [doneDate, nextDue, s.id]);
    }
    await connection.commit();
    res.json({ success: true, message: outcome === 'Not completed' ? 'Recorded. The task is still due.' : `Recorded. Next due ${nextDue}.` });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Error completing maintenance task:', error);
    res.status(500).json({ success: false, message: 'Server error recording the task' });
  } finally {
    connection.release();
  }
};

// GET /api/lab/maintenance/history/:machineId
export const getMaintenanceHistory = async (req, res) => {
  try {
    const m = await machineInScope(req, req.params.machineId);
    if (!m) return res.status(404).json({ success: false, message: 'Equipment not found.' });
    const [log] = await db.query('SELECT * FROM equipment_maintenance_log WHERE machine_id = ? ORDER BY performed_at DESC, id DESC LIMIT 200', [m.id]);
    res.json({ success: true, machine: m, history: log, schedules: await loadSchedules(req, m.id) });
  } catch (error) {
    console.error('Error loading maintenance history:', error);
    res.status(500).json({ success: false, message: 'Server error loading history' });
  }
};
