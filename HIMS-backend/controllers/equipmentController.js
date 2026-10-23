import db from '../config/db.js';

// Equipment management (tender #27, #78-82, #130-132):
//  - breakdown / service tickets from report to closure, with downtime;
//  - the analyzer integration registry (make, model, serial, protocol,
//    interface, mapping version, validation status);
//  - geo-mapping of every analyzer at its installation point and geo-fencing
//    around it, with status overlaid for the facility / district / state map.

const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null);

const fail = (res, error, what) => {
  console.error(`${what}:`, error);
  res.status(500).json({ success: false, message: `Server error ${what}` });
};

async function actorName(id) {
  if (!id) return null;
  const [[u]] = await db.query("SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [id]);
  return u?.name || null;
}

async function machineInScope(req, id) {
  const pin = pinned(req);
  const [[m]] = await db.query(
    `SELECT m.*, i.branch_id, i.name AS lab_name FROM lab_machines m LEFT JOIN infrastructure i ON i.id = m.lab_id
      WHERE m.id = ? ${pin ? 'AND i.branch_id = ?' : ''}`, pin ? [id, pin] : [id]);
  return m || null;
}

// ── Breakdown tickets ───────────────────────────────────────────────────────

export const TICKET_CATEGORIES = ['Breakdown', 'Error / malfunction', 'Calibration failure', 'QC failure', 'Preventive maintenance required',
  'Connectivity / interface', 'Geo-fence breach', 'Other'];
const NEXT = { Open: ['In Progress', 'Resolved'], 'In Progress': ['Resolved'], Resolved: ['Closed', 'In Progress'], Closed: [] };

export const listTickets = async (req, res) => {
  try {
    const pin = pinned(req);
    const { status, machine_id } = req.query;
    const where = ['1=1']; const params = [];
    if (pin) { where.push('t.branch_id = ?'); params.push(pin); }
    if (status === 'active') where.push("t.status IN ('Open','In Progress')");
    else if (status) { where.push('t.status = ?'); params.push(status); }
    if (machine_id) { where.push('t.machine_id = ?'); params.push(machine_id); }
    const [rows] = await db.query(
      `SELECT t.*, m.name AS machine_name, m.model, m.manufacturer, m.serial_number, b.branch_name,
              TIMESTAMPDIFF(MINUTE, t.reported_at, COALESCE(t.resolved_at, NOW())) AS downtime_minutes,
              (SELECT COUNT(*) FROM equipment_ticket_samples ts WHERE ts.ticket_id = t.id) AS linked_samples
         FROM equipment_tickets t
         JOIN lab_machines m ON m.id = t.machine_id
         LEFT JOIN branches b ON b.id = t.branch_id
        WHERE ${where.join(' AND ')}
        ORDER BY FIELD(t.status, 'Open', 'In Progress', 'Resolved', 'Closed'), FIELD(t.priority, 'Critical', 'High', 'Medium', 'Low'), t.reported_at DESC
        LIMIT 500`, params);
    const [[summary]] = await db.query(
      `SELECT COALESCE(SUM(status = 'Open'), 0) AS open, COALESCE(SUM(status = 'In Progress'), 0) AS in_progress,
              COALESCE(SUM(status = 'Resolved' AND resolved_at >= CURDATE() - INTERVAL 30 DAY), 0) AS resolved_30d,
              ROUND(AVG(CASE WHEN resolved_at >= CURDATE() - INTERVAL 30 DAY THEN TIMESTAMPDIFF(MINUTE, reported_at, resolved_at) END) / 60, 1) AS mttr_hours_30d
         FROM equipment_tickets ${pin ? 'WHERE branch_id = ?' : ''}`, pin ? [pin] : []);
    res.json({ success: true, tickets: rows, summary, categories: TICKET_CATEGORIES });
  } catch (error) { fail(res, error, 'loading tickets'); }
};

async function openTicket({ machine, category, priority, description, assignedTo = null, userId = null }) {
  const [r] = await db.query(
    `INSERT INTO equipment_tickets (ticket_no, machine_id, branch_id, category, priority, description, assigned_to, reported_by, reported_by_name, reported_at)
     VALUES (CONCAT('TMP-', UUID_SHORT()), ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [machine.id, machine.branch_id || null, category, priority, description.slice(0, 1000), assignedTo, userId, await actorName(userId)]);
  const ticketNo = `TKT-${String(r.insertId).padStart(5, '0')}`;
  await db.query('UPDATE equipment_tickets SET ticket_no = ? WHERE id = ?', [ticketNo, r.insertId]);
  return { id: r.insertId, ticketNo };
}

export const createTicket = async (req, res) => {
  try {
    const { machine_id, category, priority = 'Medium', description, assigned_to } = req.body || {};
    const machine = await machineInScope(req, machine_id);
    if (!machine) return res.status(404).json({ success: false, message: 'Analyzer not found.' });
    if (!TICKET_CATEGORIES.includes(category)) return res.status(400).json({ success: false, message: 'Choose a ticket category.' });
    if (!['Low', 'Medium', 'High', 'Critical'].includes(priority)) return res.status(400).json({ success: false, message: 'Invalid priority.' });
    if (!String(description || '').trim()) return res.status(400).json({ success: false, message: 'Describe the problem.' });
    const t = await openTicket({ machine, category, priority, description: description.trim(), assignedTo: assigned_to?.trim() || null, userId: req.user?.id });
    res.status(201).json({ success: true, id: t.id, ticket_no: t.ticketNo, message: `Ticket ${t.ticketNo} raised for ${machine.name}.` });
  } catch (error) { fail(res, error, 'raising ticket'); }
};

export const updateTicket = async (req, res) => {
  try {
    const pin = pinned(req);
    const [[t]] = await db.query(`SELECT * FROM equipment_tickets WHERE id = ? ${pin ? 'AND branch_id = ?' : ''}`, pin ? [req.params.id, pin] : [req.params.id]);
    if (!t) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    const { status, assigned_to, resolution } = req.body || {};
    const sets = []; const vals = [];
    if (assigned_to !== undefined) { sets.push('assigned_to = ?'); vals.push(String(assigned_to || '').trim() || null); }
    if (resolution !== undefined) { sets.push('resolution = ?'); vals.push(String(resolution || '').trim().slice(0, 1000) || null); }
    if (status && status !== t.status) {
      if (!NEXT[t.status].includes(status)) return res.status(400).json({ success: false, message: `This ticket is ${t.status}; it cannot move to ${status}.` });
      if (status === 'Resolved' && !String(resolution ?? t.resolution ?? '').trim()) {
        return res.status(400).json({ success: false, message: 'Record what was done before resolving the ticket.' });
      }
      sets.push('status = ?'); vals.push(status);
      if (status === 'Resolved') sets.push('resolved_at = NOW()');
      if (status === 'Closed') sets.push('closed_at = NOW()');
      if (status === 'In Progress' && t.status === 'Resolved') sets.push('resolved_at = NULL');
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update.' });
    await db.query(`UPDATE equipment_tickets SET ${sets.join(', ')} WHERE id = ?`, [...vals, t.id]);
    // Repairing the analyzer does not finish the job until every affected sample has its report.
    let unfinished = 0;
    if (status === 'Resolved' || status === 'Closed') {
      const [[u]] = await db.query(
        `SELECT COUNT(*) AS n FROM equipment_ticket_samples ts
          WHERE ts.ticket_id = ? AND NOT EXISTS (SELECT 1 FROM lab_test_result r WHERE r.sample_id = ts.sample_id AND r.status = 'Approved')`, [t.id]);
      unfinished = Number(u.n);
    }
    if (status === 'Resolved' && t.category === 'Geo-fence breach') {
      await db.query("UPDATE lab_machines SET geofence_status = 'Unknown' WHERE id = ? AND geofence_status = 'Outside'", [t.machine_id]);
    }
    res.json({
      success: true,
      message: `Ticket ${t.ticket_no} updated.${unfinished ? ` ${unfinished} affected sample(s) still have no released report — see "Affected samples".` : ''}`,
      unfinished_samples: unfinished,
    });
  } catch (error) { fail(res, error, 'updating ticket'); }
};

// ── Samples affected by a breakdown ─────────────────────────────────────────

const SAMPLE_ACTIONS = ['Referred', 'Moved to another analyzer', 'Held'];

async function ticketInScope(req, id) {
  const pin = pinned(req);
  const [[t]] = await db.query(`SELECT * FROM equipment_tickets WHERE id = ? ${pin ? 'AND branch_id = ?' : ''}`, pin ? [id, pin] : [id]);
  return t || null;
}

// Used by sample referral too: ties a referral to the breakdown that caused it.
export async function linkSampleToTicket(conn, { ticketId, sampleId, branchId, action, referralId = null, altMachineId = null, note = null, userId = null }) {
  const [[u]] = userId ? await conn.query("SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [userId]) : [[null]];
  await conn.query(
    `INSERT INTO equipment_ticket_samples (ticket_id, sample_id, branch_id, action, referral_id, alt_machine_id, note, linked_by, linked_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE action = VALUES(action), referral_id = COALESCE(VALUES(referral_id), referral_id),
                             alt_machine_id = VALUES(alt_machine_id), note = VALUES(note)`,
    [ticketId, sampleId, branchId || null, action, referralId, altMachineId, note ? String(note).slice(0, 300) : null, userId, u?.name || null]);
}

// GET /api/equipment/tickets/:id/samples — the samples this breakdown touched, and the ones still at risk.
export const ticketSamples = async (req, res) => {
  try {
    const t = await ticketInScope(req, req.params.id);
    if (!t) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    const [[m]] = await db.query('SELECT lab_id FROM lab_machines WHERE id = ?', [t.machine_id]);

    const [linked] = await db.query(
      `SELECT ts.id, ts.sample_id, ts.action, ts.note, ts.linked_at, ts.linked_by_name, ts.referral_id,
              CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name, p.reg_no, s.stage,
              sr.status AS referral_status, sr.dispatched_at, sr.received_at, tb.branch_name AS to_facility, tl.name AS to_lab,
              (SELECT GROUP_CONCAT(DISTINCT bi.service_name SEPARATOR ', ') FROM bill_items bi WHERE bi.sample_id = ts.sample_id) AS tests,
              (SELECT r.status FROM lab_test_result r WHERE r.sample_id = ts.sample_id ORDER BY r.id DESC LIMIT 1) AS report_status,
              (SELECT r.approved_at FROM lab_test_result r WHERE r.sample_id = ts.sample_id AND r.status = 'Approved' ORDER BY r.id DESC LIMIT 1) AS report_released_at,
              am.name AS alt_machine
         FROM equipment_ticket_samples ts
         LEFT JOIN lab_samples s ON s.sample_id = ts.sample_id
         LEFT JOIN sample_referrals sr ON sr.id = ts.referral_id
         LEFT JOIN branches tb ON tb.id = sr.to_branch_id
         LEFT JOIN infrastructure tl ON tl.id = sr.to_lab_id
         LEFT JOIN lab_machines am ON am.id = ts.alt_machine_id
         LEFT JOIN (SELECT sample_id, MIN(bill_id) AS bill_id FROM bill_items WHERE sample_id IS NOT NULL GROUP BY sample_id) x ON x.sample_id = ts.sample_id
         LEFT JOIN bills b ON b.id = x.bill_id
         LEFT JOIN patients p ON p.id = b.patient_id
        WHERE ts.ticket_id = ? ORDER BY ts.id`, [t.id]);

    // Waiting for a result in this analyzer's lab, from the last 3 days, and not yet dealt with.
    const [atRisk] = m?.lab_id ? await db.query(
      `SELECT bi.sample_id, CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name, p.reg_no, s.stage,
              GROUP_CONCAT(DISTINCT bi.service_name SEPARATOR ', ') AS tests, MAX(b.created_at) AS ordered_at
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id JOIN patients p ON p.id = b.patient_id
         LEFT JOIN lab_samples s ON s.sample_id = bi.sample_id
        WHERE bi.service_type = 'Laboratory' AND bi.sample_id IS NOT NULL AND bi.status IN ('Collected', 'In Progress')
          AND bi.lab_id = ? AND b.branch_id <=> ? AND b.created_at >= NOW() - INTERVAL 3 DAY
          AND NOT EXISTS (SELECT 1 FROM lab_test_result r WHERE r.bill_item_id = bi.id)
          AND NOT EXISTS (SELECT 1 FROM equipment_ticket_samples ts WHERE ts.ticket_id = ? AND ts.sample_id = bi.sample_id)
        GROUP BY bi.sample_id, patient_name, p.reg_no, s.stage ORDER BY ordered_at LIMIT 100`, [m.lab_id, t.branch_id, t.id]) : [[]];

    const [machines] = await db.query(
      `SELECT m.id, m.name FROM lab_machines m LEFT JOIN infrastructure i ON i.id = m.lab_id WHERE i.branch_id <=> ? AND m.id <> ? ORDER BY m.name`, [t.branch_id, t.machine_id]);
    res.json({
      success: true, ticket: { id: t.id, ticket_no: t.ticket_no, status: t.status }, linked, at_risk: atRisk, other_machines: machines,
      pending_reports: linked.filter((l) => l.report_status !== 'Approved').length,
    });
  } catch (error) { fail(res, error, 'loading affected samples'); }
};

// POST /api/equipment/tickets/:id/samples { sample_id, action, note?, alt_machine_id? }
export const linkTicketSample = async (req, res) => {
  try {
    const t = await ticketInScope(req, req.params.id);
    if (!t) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    if (t.status === 'Closed') return res.status(409).json({ success: false, message: 'This ticket is closed.' });
    const sampleId = String(req.body?.sample_id || '').trim();
    const action = req.body?.action;
    if (!SAMPLE_ACTIONS.includes(action)) return res.status(400).json({ success: false, message: 'Choose what was done with the sample.' });

    const [[found]] = await db.query(
      `SELECT bi.sample_id, b.branch_id FROM bill_items bi JOIN bills b ON b.id = bi.bill_id WHERE bi.sample_id = ? ${t.branch_id ? 'AND b.branch_id = ?' : ''} LIMIT 1`,
      t.branch_id ? [sampleId, t.branch_id] : [sampleId]);
    if (!found) return res.status(404).json({ success: false, message: 'That sample was not found at this hospital.' });

    let referralId = null;
    if (action === 'Referred') {
      const [[r]] = await db.query('SELECT id FROM sample_referrals WHERE sample_id = ? ORDER BY id DESC LIMIT 1', [sampleId]);
      if (!r) return res.status(409).json({ success: false, message: 'This sample has not been referred yet. Refer it from Sample Referrals and choose this ticket there.' });
      referralId = r.id;
      await db.query('UPDATE sample_referrals SET ticket_id = ? WHERE id = ? AND ticket_id IS NULL', [t.id, r.id]);
    }
    let altMachineId = null;
    if (action === 'Moved to another analyzer' && req.body?.alt_machine_id) {
      const alt = await machineInScope(req, req.body.alt_machine_id);
      if (!alt) return res.status(404).json({ success: false, message: 'That analyzer was not found.' });
      altMachineId = alt.id;
    }
    await linkSampleToTicket(db, { ticketId: t.id, sampleId, branchId: t.branch_id, action, referralId, altMachineId, note: req.body?.note, userId: req.user?.id });
    res.status(201).json({ success: true, message: `Sample ${sampleId.slice(-4)} recorded against ${t.ticket_no}.` });
  } catch (error) { fail(res, error, 'linking the sample'); }
};

// ── Analyzer integration registry ───────────────────────────────────────────

// Share of the last `days` the analyzer was online, from its ONLINE/OFFLINE events.
async function uptimeByMachine(days = 7) {
  const since = new Date(Date.now() - days * 86400000);
  const [events] = await db.query(
    `SELECT machine_id, event, created_at FROM analyzer_connection_logs WHERE created_at >= ? ORDER BY machine_id, created_at`, [since]);
  const [before] = await db.query(
    `SELECT l.machine_id, l.event FROM analyzer_connection_logs l
       JOIN (SELECT machine_id, MAX(id) AS id FROM analyzer_connection_logs WHERE created_at < ? GROUP BY machine_id) x ON x.id = l.id`, [since]);
  const state = Object.fromEntries(before.map((b) => [b.machine_id, { online: b.event === 'ONLINE', at: since.getTime(), up: 0 }]));
  for (const e of events) {
    const s = state[e.machine_id] ||= { online: false, at: since.getTime(), up: 0 };
    const t = new Date(e.created_at).getTime();
    if (s.online) s.up += t - s.at;
    s.online = e.event === 'ONLINE'; s.at = t;
  }
  const now = Date.now(); const span = now - since.getTime();
  return Object.fromEntries(Object.entries(state).map(([id, s]) => [id, Math.round(((s.up + (s.online ? now - s.at : 0)) / span) * 1000) / 10]));
}

export const listRegistry = async (req, res) => {
  try {
    const pin = pinned(req);
    const [rows] = await db.query(
      `SELECT m.id, m.machine_id, m.name, m.model, m.manufacturer, m.serial_number, m.interface_type, m.port_ip, m.baud_rate, m.status,
              m.protocol, m.mapping_version, m.validation_status, m.validated_on, m.validated_by,
              m.install_lat, m.install_lng, m.geofence_radius_m, m.installed_on, m.last_seen_lat, m.last_seen_lng, m.last_seen_at, m.geofence_status,
              i.name AS lab_name, i.branch_id, b.branch_name, b.latitude AS branch_lat, b.longitude AS branch_lng, d.name AS district,
              (SELECT MAX(created_at) FROM analyzer_connection_logs l WHERE l.machine_id = m.machine_id) AS last_event_at,
              (SELECT COUNT(*) FROM equipment_tickets t WHERE t.machine_id = m.id AND t.status IN ('Open','In Progress')) AS open_tickets,
              (SELECT COUNT(*) FROM lab_test_result r WHERE r.machine_no = m.machine_id AND r.created_at >= CURDATE()) AS tests_today,
              (SELECT COUNT(*) FROM lab_test_result r WHERE r.machine_no = m.machine_id AND r.created_at >= CURDATE() - INTERVAL 30 DAY) AS tests_30d
         FROM lab_machines m
         LEFT JOIN infrastructure i ON i.id = m.lab_id
         LEFT JOIN branches b ON b.id = i.branch_id
         LEFT JOIN districts d ON d.id = b.district_id
        ${pin ? 'WHERE i.branch_id = ?' : ''} ORDER BY b.branch_name, m.name`, pin ? [pin] : []);
    const uptime = await uptimeByMachine(7);
    res.json({ success: true, machines: rows.map((m) => ({ ...m, uptime_7d: uptime[m.machine_id] ?? null })) });
  } catch (error) { fail(res, error, 'loading analyzer registry'); }
};

const VALIDATION = ['Not validated', 'In validation', 'Validated', 'Suspended'];

export const updateRegistry = async (req, res) => {
  try {
    const m = await machineInScope(req, req.params.id);
    if (!m) return res.status(404).json({ success: false, message: 'Analyzer not found.' });
    const { protocol, mapping_version, validation_status, validated_on, validated_by } = req.body || {};
    if (validation_status && !VALIDATION.includes(validation_status)) return res.status(400).json({ success: false, message: 'Invalid validation status.' });
    if (validation_status === 'Validated' && !(validated_on || m.validated_on) ) {
      return res.status(400).json({ success: false, message: 'Enter the validation date.' });
    }
    await db.query(
      `UPDATE lab_machines SET protocol = ?, mapping_version = ?, validation_status = ?, validated_on = ?, validated_by = ? WHERE id = ?`,
      [protocol?.trim() || null, mapping_version?.trim() || null, validation_status || m.validation_status,
       validated_on || null, validated_by?.trim() || null, m.id]);
    res.json({ success: true, message: `${m.name} registry entry updated.` });
  } catch (error) { fail(res, error, 'updating analyzer registry'); }
};

// ── Geo-mapping / geo-fencing ───────────────────────────────────────────────

const validLat = (v) => Number.isFinite(Number(v)) && Math.abs(Number(v)) <= 90 && v !== '' && v !== null;
const validLng = (v) => Number.isFinite(Number(v)) && Math.abs(Number(v)) <= 180 && v !== '' && v !== null;

// Great-circle distance in metres.
export function distanceMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000; const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1); const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// PUT /machines/:id/install-location { lat, lng, radius_m, installed_on }
export const setInstallLocation = async (req, res) => {
  try {
    const m = await machineInScope(req, req.params.id);
    if (!m) return res.status(404).json({ success: false, message: 'Analyzer not found.' });
    const { lat, lng, radius_m, installed_on } = req.body || {};
    if (!validLat(lat) || !validLng(lng)) return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required.' });
    const radius = Math.round(Number(radius_m) || m.geofence_radius_m || 200);
    if (radius < 25 || radius > 50000) return res.status(400).json({ success: false, message: 'The geo-fence radius must be between 25 m and 50 km.' });
    await db.query(
      `UPDATE lab_machines SET install_lat = ?, install_lng = ?, geofence_radius_m = ?, installed_on = COALESCE(?, installed_on),
              geofence_status = 'Unknown' WHERE id = ?`,
      [Number(lat), Number(lng), radius, installed_on || null, m.id]);
    res.json({ success: true, message: `Installation point for ${m.name} saved with a ${radius} m geo-fence.` });
  } catch (error) { fail(res, error, 'saving installation location'); }
};

// POST /machines/:id/location-check { lat, lng, accuracy_m }
// A location report for the analyzer (from the device at the facility). One
// outside the geo-fence marks it Outside and raises a Critical ticket.
export const checkLocation = async (req, res) => {
  try {
    const m = await machineInScope(req, req.params.id);
    if (!m) return res.status(404).json({ success: false, message: 'Analyzer not found.' });
    const { lat, lng, accuracy_m } = req.body || {};
    if (!validLat(lat) || !validLng(lng)) return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required.' });
    if (m.install_lat == null || m.install_lng == null) {
      return res.status(409).json({ success: false, message: 'Record the installation point for this analyzer first.' });
    }
    const distance = distanceMetres(Number(m.install_lat), Number(m.install_lng), Number(lat), Number(lng));
    // A fix whose own uncertainty covers the boundary cannot prove a breach.
    const slack = Math.min(Number(accuracy_m) || 0, 500);
    const outside = distance - slack > m.geofence_radius_m;
    const status = outside ? 'Outside' : 'Inside';
    await db.query(
      'UPDATE lab_machines SET last_seen_lat = ?, last_seen_lng = ?, last_seen_at = NOW(), geofence_status = ? WHERE id = ?',
      [Number(lat), Number(lng), status, m.id]);

    let ticket = null;
    let alreadyOpen = false;
    if (outside) {
      const [[open]] = await db.query(
        "SELECT ticket_no FROM equipment_tickets WHERE machine_id = ? AND category = 'Geo-fence breach' AND status IN ('Open','In Progress') LIMIT 1", [m.id]);
      alreadyOpen = !!open;
      ticket = open?.ticket_no || (await openTicket({
        machine: m, category: 'Geo-fence breach', priority: 'Critical', userId: req.user?.id,
        description: `${m.name} (S/N ${m.serial_number || '—'}) reported ${distance} m from its approved installation point; the geo-fence is ${m.geofence_radius_m} m. Possible unauthorised relocation.`,
      })).ticketNo;
    }
    res.json({
      success: true, status, distance_m: distance, radius_m: m.geofence_radius_m, ticket_no: ticket,
      message: outside
        ? `ALERT: ${m.name} is ${distance} m from its installation point (limit ${m.geofence_radius_m} m). Ticket ${ticket} ${alreadyOpen ? 'is already open' : 'raised'}.`
        : `${m.name} is within its geo-fence (${distance} m from the installation point).`,
    });
  } catch (error) { fail(res, error, 'checking location'); }
};
