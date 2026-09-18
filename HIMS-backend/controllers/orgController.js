import db from '../config/db.js';

// ── States ────────────────────────────────────────────────────────────────────

export const getStates = async (req, res) => {
  try {
    const [states] = await db.query('SELECT * FROM states ORDER BY name');
    res.json({ success: true, states });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const createState = async (req, res) => {
  try {
    const { name, code } = req.body;
    if (!name || !code) return res.status(400).json({ success: false, message: 'name and code are required' });
    const [r] = await db.query('INSERT INTO states (name, code) VALUES (?, ?)', [name, code.toUpperCase()]);
    res.json({ success: true, state_id: r.insertId });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const updateState = async (req, res) => {
  try {
    const { name, code, is_active } = req.body;
    await db.query('UPDATE states SET name=?, code=?, is_active=? WHERE id=?',
      [name, code?.toUpperCase(), is_active ?? 1, req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const deleteState = async (req, res) => {
  try {
    const [[{ cnt }]] = await db.query('SELECT COUNT(*) AS cnt FROM districts WHERE state_id=?', [req.params.id]);
    if (cnt > 0) return res.status(400).json({ success: false, message: 'Cannot delete: districts are linked to this state' });
    await db.query('DELETE FROM states WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

// ── Blocks ────────────────────────────────────────────────────────────────────

export const getBlocks = async (req, res) => {
  try {
    const { district_id } = req.query;
    let query = `SELECT b.*, d.name AS district_name FROM blocks b
                 JOIN districts d ON b.district_id = d.id WHERE 1=1`;
    const params = [];
    if (district_id) { query += ' AND b.district_id = ?'; params.push(district_id); }
    query += ' ORDER BY d.name, b.name';
    const [blocks] = await db.query(query, params);
    res.json({ success: true, blocks });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const createBlock = async (req, res) => {
  try {
    const { name, district_id } = req.body;
    if (!name || !district_id) return res.status(400).json({ success: false, message: 'name and district_id are required' });
    const [r] = await db.query('INSERT INTO blocks (name, district_id) VALUES (?, ?)', [name, district_id]);
    res.json({ success: true, block_id: r.insertId });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const updateBlock = async (req, res) => {
  try {
    const { name, district_id, is_active } = req.body;
    await db.query('UPDATE blocks SET name=?, district_id=?, is_active=? WHERE id=?',
      [name, district_id, is_active ?? 1, req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const deleteBlock = async (req, res) => {
  try {
    const [[{ cnt }]] = await db.query('SELECT COUNT(*) AS cnt FROM branches WHERE block_id=?', [req.params.id]);
    if (cnt > 0) return res.status(400).json({ success: false, message: 'Cannot delete: branches are linked to this block' });
    await db.query('DELETE FROM blocks WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

// ── Specialties ───────────────────────────────────────────────────────────────

export const getSpecialties = async (req, res) => {
  try {
    const { branch_id } = req.query;
    const [specialties] = await db.query(
      `SELECT * FROM specialties WHERE (branch_id IS NULL OR branch_id = ?) ORDER BY name`,
      [branch_id || null]
    );
    res.json({ success: true, specialties });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const createSpecialty = async (req, res) => {
  try {
    const { name, code, description, branch_id } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });
    const [r] = await db.query(
      'INSERT INTO specialties (name, code, description, branch_id) VALUES (?, ?, ?, ?)',
      [name, code || null, description || null, branch_id || null]
    );
    res.json({ success: true, specialty_id: r.insertId });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const updateSpecialty = async (req, res) => {
  try {
    const { name, code, description, is_active } = req.body;
    await db.query('UPDATE specialties SET name=?, code=?, description=?, is_active=? WHERE id=?',
      [name, code || null, description || null, is_active ?? 1, req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const deleteSpecialty = async (req, res) => {
  try {
    await db.query('DELETE FROM specialties WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

// ── Beds ──────────────────────────────────────────────────────────────────────

export const getBeds = async (req, res) => {
  try {
    const { branch_id, ward_id, status } = req.query;
    let query = `SELECT b.*, i.name AS ward_name, i.type AS ward_type
                 FROM beds b JOIN infrastructure i ON b.ward_id = i.id WHERE 1=1`;
    const params = [];
    if (branch_id) { query += ' AND b.branch_id = ?'; params.push(branch_id); }
    if (ward_id)   { query += ' AND b.ward_id = ?';   params.push(ward_id); }
    if (status)    { query += ' AND b.status = ?';    params.push(status); }
    query += ' ORDER BY i.name, b.bed_number';
    const [beds] = await db.query(query, params);

    const summary = {
      total:       beds.length,
      available:   beds.filter(b => b.status === 'Available').length,
      occupied:    beds.filter(b => b.status === 'Occupied').length,
      maintenance: beds.filter(b => b.status === 'Under Maintenance').length,
      reserved:    beds.filter(b => b.status === 'Reserved').length,
    };
    res.json({ success: true, beds, summary });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const createBed = async (req, res) => {
  try {
    const { bed_number, ward_id, branch_id, bed_type, status } = req.body;
    if (!bed_number || !ward_id || !branch_id)
      return res.status(400).json({ success: false, message: 'bed_number, ward_id, branch_id are required' });
    const [r] = await db.query(
      'INSERT INTO beds (bed_number, ward_id, branch_id, bed_type, status) VALUES (?, ?, ?, ?, ?)',
      [bed_number, ward_id, branch_id, bed_type || 'General', status || 'Available']
    );
    res.json({ success: true, bed_id: r.insertId });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const createBedsBulk = async (req, res) => {
  try {
    const { ward_id, branch_id, bed_type, prefix, start_number, count } = req.body;
    if (!ward_id || !branch_id || !count)
      return res.status(400).json({ success: false, message: 'ward_id, branch_id, count are required' });

    const n     = Math.min(parseInt(count), 100);
    const start = parseInt(start_number) || 1;
    const rows  = [];
    for (let i = 0; i < n; i++) {
      const num    = start + i;
      const padded = String(num).padStart(2, '0');
      const label  = (prefix || '') + padded;
      rows.push([label, ward_id, branch_id, bed_type || 'General', 'Available']);
    }
    await db.query(
      'INSERT IGNORE INTO beds (bed_number, ward_id, branch_id, bed_type, status) VALUES ?',
      [rows]
    );
    res.json({ success: true, created: rows.length });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const updateBed = async (req, res) => {
  try {
    const { bed_number, ward_id, bed_type, status } = req.body;
    const branch_id = req.body.branch_id || req.query.branch_id;
    await db.query(
      'UPDATE beds SET bed_number=?, ward_id=?, bed_type=?, status=? WHERE id=? AND branch_id=?',
      [bed_number, ward_id, bed_type, status, req.params.id, branch_id]
    );
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const updateBedStatus = async (req, res) => {
  try {
    const { status } = req.body;
    await db.query('UPDATE beds SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const deleteBed = async (req, res) => {
  try {
    const branch_id = req.query.branch_id;
    await db.query('DELETE FROM beds WHERE id=? AND branch_id=?', [req.params.id, branch_id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

// ── Working Hours ─────────────────────────────────────────────────────────────

export const getWorkingHours = async (req, res) => {
  try {
    const { branch_id } = req.query;
    const [rows] = await db.query(
      `SELECT wh.*, d.name AS department_name FROM working_hours wh
       LEFT JOIN departments d ON wh.department_id = d.id
       WHERE wh.branch_id = ? ORDER BY wh.department_id, wh.day_of_week`,
      [branch_id]
    );
    res.json({ success: true, working_hours: rows });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const upsertWorkingHours = async (req, res) => {
  try {
    const { branch_id, department_id, schedule } = req.body;
    if (!branch_id || !Array.isArray(schedule))
      return res.status(400).json({ success: false, message: 'branch_id and schedule[] are required' });

    for (const s of schedule) {
      await db.query(
        `INSERT INTO working_hours (branch_id, department_id, day_of_week, open_time, close_time, is_closed)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE open_time=VALUES(open_time), close_time=VALUES(close_time), is_closed=VALUES(is_closed)`,
        [branch_id, department_id || null, s.day_of_week, s.open_time || '09:00', s.close_time || '17:00', s.is_closed ? 1 : 0]
      );
    }
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const deleteWorkingHours = async (req, res) => {
  try {
    await db.query('DELETE FROM working_hours WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

// ── Holidays ──────────────────────────────────────────────────────────────────

export const getHolidays = async (req, res) => {
  try {
    const { branch_id, upcoming } = req.query;
    let query = `SELECT * FROM holidays WHERE (branch_id IS NULL OR branch_id = ?)`;
    const params = [branch_id || null];
    if (upcoming === '1') { query += ' AND holiday_date >= CURDATE()'; }
    query += ' ORDER BY holiday_date';
    const [holidays] = await db.query(query, params);
    res.json({ success: true, holidays });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const createHoliday = async (req, res) => {
  try {
    const { branch_id, holiday_name, holiday_date, holiday_type, is_recurring } = req.body;
    if (!holiday_name || !holiday_date)
      return res.status(400).json({ success: false, message: 'holiday_name and holiday_date are required' });
    const [r] = await db.query(
      'INSERT INTO holidays (branch_id, holiday_name, holiday_date, holiday_type, is_recurring) VALUES (?, ?, ?, ?, ?)',
      [branch_id || null, holiday_name, holiday_date, holiday_type || 'Hospital', is_recurring ? 1 : 0]
    );
    res.json({ success: true, holiday_id: r.insertId });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const updateHoliday = async (req, res) => {
  try {
    const { holiday_name, holiday_date, holiday_type, is_recurring } = req.body;
    await db.query(
      'UPDATE holidays SET holiday_name=?, holiday_date=?, holiday_type=?, is_recurring=? WHERE id=?',
      [holiday_name, holiday_date, holiday_type, is_recurring ? 1 : 0, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};

export const deleteHoliday = async (req, res) => {
  try {
    await db.query('DELETE FROM holidays WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
};
