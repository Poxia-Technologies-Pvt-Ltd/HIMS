import db from '../config/db.js';
import { readScope, writeScope, inScope, nowIST, isISODate, dutyInterval, addDays, fail } from '../utils/hr.js';

// Rooms, wards and other spaces (the `infrastructure` table), and the beds in them.
// GET /api/infra keeps its { items } shape: the lab pages and the LIS Agent read it.

const ROOM_TYPES = ['Room', 'OPD Cabin', 'Ward', 'ICU', 'OT', 'Emergency', 'Procedure Room', 'Lab', 'Pharmacy', 'Radiology', 'Store', 'Office', 'Other'];
const ROOM_STATUSES = ['Available', 'Occupied', 'Maintenance'];
const BED_TYPES = ['General', 'Semi-Private', 'Private', 'ICU', 'HDU', 'NICU', 'PICU', 'Day Care'];
const BED_STATUSES = ['Available', 'Occupied', 'Cleaning', 'Reserved', 'Blocked', 'Maintenance'];

const ROOM_SELECT = `
  SELECT i.*, d.name AS department_name, b.branch_name,
         (SELECT COUNT(*) FROM beds bd WHERE bd.room_id = i.id) AS beds_total,
         (SELECT COUNT(*) FROM beds bd WHERE bd.room_id = i.id AND bd.status = 'Available') AS beds_available,
         (SELECT COUNT(*) FROM beds bd WHERE bd.room_id = i.id AND bd.status = 'Occupied') AS beds_occupied
    FROM infrastructure i
    LEFT JOIN departments d ON d.id = i.department_id
    LEFT JOIN branches b    ON b.id = i.branch_id`;

// GET /api/infra?type&department_id&include_inactive&branch_id
export const getInfraList = async (req, res) => {
  try {
    const scope = readScope(req);
    const where = [];
    const params = [];
    if (req.query.type) {
      const types = String(req.query.type).split(',');
      where.push(`i.type IN (${types.map(() => '?').join(',')})`);
      params.push(...types);
    }
    if (scope) { where.push('i.branch_id = ?'); params.push(scope); }
    if (req.query.department_id) { where.push('i.department_id = ?'); params.push(req.query.department_id); }
    if (req.query.include_inactive !== '1') where.push('i.is_active = 1');
    const [rows] = await db.query(
      `${ROOM_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.floor IS NULL, i.floor, i.block, i.name`,
      params
    );
    res.json({ success: true, items: rows });
  } catch (error) {
    console.error('Error fetching infra list:', error);
    fail(res, 500, 'Server error fetching infrastructure');
  }
};

const readRoom = (b) => {
  const name = String(b.name || '').trim().slice(0, 100);
  if (!name) return [null, 'Name is required'];
  if (!ROOM_TYPES.includes(b.type)) return [null, 'Choose a valid type'];
  const status = b.status || 'Available';
  if (!ROOM_STATUSES.includes(status)) return [null, 'Invalid status'];
  const int = (v) => (v === undefined || v === null || v === '' ? null : parseInt(v, 10));
  const floor = int(b.floor);
  const capacity = int(b.capacity);
  if ((floor !== null && Number.isNaN(floor)) || (capacity !== null && (Number.isNaN(capacity) || capacity < 0))) return [null, 'Floor and capacity must be numbers'];
  return [{
    name,
    room_number: b.room_number ? String(b.room_number).trim().slice(0, 30) : null,
    type: b.type,
    department_id: b.department_id ? Number(b.department_id) : null,
    block: b.block ? String(b.block).trim().slice(0, 100) : null,
    floor, capacity, status,
    notes: b.notes ? String(b.notes).slice(0, 1000) : null,
    is_active: b.is_active === false || b.is_active === 0 ? 0 : 1,
  }, null];
};

// POST /api/infra/add
export const addInfra = async (req, res) => {
  try {
    const branchId = writeScope(req);
    if (!branchId) return fail(res, 400, 'Select the facility');
    const [room, err] = readRoom(req.body);
    if (err) return fail(res, 400, err);
    const cols = Object.keys(room);
    const [result] = await db.query(
      `INSERT INTO infrastructure (branch_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
      [branchId, ...cols.map((c) => room[c])]
    );
    res.status(201).json({ success: true, message: 'Room added', id: result.insertId });
  } catch (error) {
    console.error('Error adding infra:', error);
    fail(res, 500, 'Server error adding infrastructure');
  }
};

const loadRoom = async (req, res, id) => {
  const [[room]] = await db.query('SELECT * FROM infrastructure WHERE id = ?', [id]);
  if (!room || !inScope(req, room.branch_id)) { fail(res, 404, 'Room not found'); return null; }
  return room;
};

// PUT /api/infra/update/:id
export const updateInfra = async (req, res) => {
  try {
    const current = await loadRoom(req, res, req.params.id);
    if (!current) return;
    const [room, err] = readRoom(req.body);
    if (err) return fail(res, 400, err);
    if (!room.is_active && current.is_active) {
      const [[busy]] = await db.query(
        `SELECT COUNT(*) AS n FROM roster_entries WHERE room_id = ? AND status = 'Scheduled' AND duty_date >= ?`,
        [current.id, nowIST().date]
      );
      if (busy.n) return fail(res, 409, `${busy.n} upcoming duties use this room. Move them before deactivating it.`);
    }
    const cols = Object.keys(room);
    await db.query(`UPDATE infrastructure SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => room[c]), current.id]);
    res.json({ success: true, message: 'Room updated' });
  } catch (error) {
    console.error('Error updating infra:', error);
    fail(res, 500, 'Server error updating infrastructure');
  }
};

// DELETE /api/infra/delete/:id — only an unused room; otherwise deactivate it.
export const deleteInfra = async (req, res) => {
  try {
    const room = await loadRoom(req, res, req.params.id);
    if (!room) return;
    const [[used]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM roster_entries WHERE room_id = ?) + (SELECT COUNT(*) FROM beds WHERE room_id = ?) +
              (SELECT COUNT(*) FROM lab_machines WHERE lab_id = ?) AS n`,
      [room.id, room.id, room.id]
    );
    if (used.n > 0) return fail(res, 409, 'This room has beds, duties or machines linked to it. Mark it inactive instead.');
    await db.query('DELETE FROM infrastructure WHERE id = ?', [room.id]);
    res.json({ success: true, message: 'Room deleted' });
  } catch (error) {
    console.error('Error deleting infra:', error);
    fail(res, 500, 'Server error deleting infrastructure');
  }
};

// GET /api/infra/board?date — every active room with who is working in it now
// and later that day, plus bed occupancy.
export const roomBoard = async (req, res) => {
  try {
    const scope = readScope(req);
    const now = nowIST();
    const date = isISODate(req.query.date) ? req.query.date : now.date;
    const [rooms] = await db.query(
      `${ROOM_SELECT} WHERE i.is_active = 1 ${scope ? 'AND i.branch_id = ?' : ''} ORDER BY i.type, i.floor, i.name`,
      scope ? [scope] : []
    );
    const [duties] = await db.query(
      `SELECT r.room_id, DATE_FORMAT(r.duty_date, '%Y-%m-%d') AS duty_date, TIME_FORMAT(r.start_time, '%H:%i') AS start_time,
              TIME_FORMAT(r.end_time, '%H:%i') AS end_time, r.duty_type, e.first_name, e.last_name, e.designation, e.staff_category,
              (SELECT COUNT(*) FROM appointments a WHERE a.roster_entry_id = r.id AND a.status IN ('Scheduled','Checked In','In Consultation')) AS waiting
         FROM roster_entries r JOIN employees e ON e.id = r.employee_id
        WHERE r.room_id IS NOT NULL AND r.status = 'Scheduled' AND r.duty_date BETWEEN ? AND ? ${scope ? 'AND r.branch_id = ?' : ''}
        ORDER BY r.start_time`,
      scope ? [addDays(date, -1), date, scope] : [addDays(date, -1), date]
    );
    const at = date === now.date ? dutyInterval(date, now.time.slice(0, 5), now.time.slice(0, 5))[0] : null;
    const board = rooms.map((room) => {
      const mine = duties
        .filter((d) => d.room_id === room.id)
        .map((d) => {
          const [s, e] = dutyInterval(d.duty_date, d.start_time, d.end_time);
          return { ...d, s, e };
        })
        .filter((d) => d.duty_date === date || (at !== null && d.e > at));
      return {
        ...room,
        current: at === null ? [] : mine.filter((d) => at >= d.s && at < d.e).map(({ s, e, ...d }) => d),
        later: mine.filter((d) => at === null || d.s > at).map(({ s, e, ...d }) => d),
        earlier: at === null ? [] : mine.filter((d) => d.duty_date === date && d.e <= at).map(({ s, e, ...d }) => d),
      };
    });
    res.json({ success: true, date, rooms: board });
  } catch (error) {
    console.error('roomBoard error:', error);
    fail(res, 500, 'Server error');
  }
};

// ── Beds ──────────────────────────────────────────────────────────────────────

// GET /api/infra/:roomId/beds
export const listBeds = async (req, res) => {
  try {
    const room = await loadRoom(req, res, req.params.roomId);
    if (!room) return;
    const [beds] = await db.query('SELECT * FROM beds WHERE room_id = ? ORDER BY LENGTH(bed_number), bed_number', [room.id]);
    res.json({ success: true, room, beds });
  } catch (e) {
    console.error('listBeds error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/infra/:roomId/beds { prefix, start_number, count, bed_type, daily_rate, has_oxygen, has_monitor, has_ventilator }
export const addBeds = async (req, res) => {
  try {
    const room = await loadRoom(req, res, req.params.roomId);
    if (!room) return;
    const b = req.body;
    const count = Math.min(100, Math.max(1, parseInt(b.count, 10) || 1));
    const start = Math.max(1, parseInt(b.start_number, 10) || 1);
    const prefix = String(b.prefix || '').trim().slice(0, 10);
    const bedType = BED_TYPES.includes(b.bed_type) ? b.bed_type : 'General';
    const rate = Math.max(0, Number(b.daily_rate) || 0);
    const [existing] = await db.query('SELECT bed_number FROM beds WHERE room_id = ?', [room.id]);
    const taken = new Set(existing.map((x) => x.bed_number));
    const rows = [];
    for (let n = start; n < start + count; n++) {
      const label = `${prefix}${String(n).padStart(2, '0')}`;
      if (taken.has(label)) return fail(res, 409, `Bed ${label} already exists in this room`);
      rows.push([label, room.branch_id, room.id, bedType, 'Available', room.name, room.room_number, `${room.branch_id}-${room.id}-${label}`,
        room.floor === null ? null : String(room.floor), b.has_ventilator ? 1 : 0, b.has_oxygen ? 1 : 0, b.has_monitor ? 1 : 0, rate]);
    }
    await db.query(
      `INSERT INTO beds (bed_number, branch_id, room_id, bed_type, status, ward, room_number, bed_code, floor,
                         has_ventilator, has_oxygen, has_monitor, daily_rate) VALUES ?`,
      [rows]
    );
    res.status(201).json({ success: true, created: rows.length });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, 'A bed with that code already exists');
    console.error('addBeds error:', e);
    fail(res, 500, 'Server error');
  }
};

const loadBed = async (req, res) => {
  const [[bed]] = await db.query('SELECT * FROM beds WHERE id = ?', [req.params.id]);
  if (!bed || !inScope(req, bed.branch_id)) { fail(res, 404, 'Bed not found'); return null; }
  return bed;
};

// PUT /api/infra/beds/:id
export const updateBed = async (req, res) => {
  try {
    const bed = await loadBed(req, res);
    if (!bed) return;
    const b = req.body;
    const label = String(b.bed_number || bed.bed_number).trim().slice(0, 20);
    if (!BED_TYPES.includes(b.bed_type || bed.bed_type)) return fail(res, 400, 'Invalid bed type');
    await db.query(
      `UPDATE beds SET bed_number = ?, bed_type = ?, daily_rate = ?, has_ventilator = ?, has_oxygen = ?, has_monitor = ?, notes = ?,
              bed_code = ? WHERE id = ?`,
      [label, b.bed_type || bed.bed_type, Math.max(0, Number(b.daily_rate ?? bed.daily_rate) || 0),
        b.has_ventilator ? 1 : 0, b.has_oxygen ? 1 : 0, b.has_monitor ? 1 : 0, b.notes ? String(b.notes).slice(0, 500) : null,
        `${bed.branch_id}-${bed.room_id}-${label}`, bed.id]
    );
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, 'A bed with that number already exists in this room');
    console.error('updateBed error:', e);
    fail(res, 500, 'Server error');
  }
};

// PATCH /api/infra/beds/:id/status { status }
export const setBedStatus = async (req, res) => {
  try {
    const bed = await loadBed(req, res);
    if (!bed) return;
    if (!BED_STATUSES.includes(req.body.status)) return fail(res, 400, 'Invalid status');
    await db.query('UPDATE beds SET status = ? WHERE id = ?', [req.body.status, bed.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('setBedStatus error:', e);
    fail(res, 500, 'Server error');
  }
};

// DELETE /api/infra/beds/:id
export const deleteBed = async (req, res) => {
  try {
    const bed = await loadBed(req, res);
    if (!bed) return;
    if (bed.status === 'Occupied' || bed.current_admission_id) return fail(res, 409, 'This bed is occupied');
    await db.query('DELETE FROM beds WHERE id = ?', [bed.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('deleteBed error:', e);
    fail(res, 500, 'Server error');
  }
};
