import db from '../config/db.js';
import { currentReagents } from '../utils/reagents.js';

const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null);
const REASONS = ['Empty', 'Expired', 'New lot', 'On-board stability', 'QC failure', 'Other'];
const p2 = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const localDateTime = (d = new Date()) => `${localYmd(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

async function machineInScope(req, machineId) {
  const pin = pinned(req);
  const [[m]] = await db.query(
    `SELECT m.id, m.name, m.model, i.name AS lab_name FROM lab_machines m LEFT JOIN infrastructure i ON i.id = m.lab_id
     WHERE m.id = ? ${pin ? 'AND i.branch_id = ?' : ''}`, pin ? [machineId, pin] : [machineId]);
  return m || null;
}

// GET /api/lab/reagents/overview — analyzers with the reagents on board now.
export const getReagentOverview = async (req, res) => {
  try {
    const pin = pinned(req);
    const [machines] = await db.query(
      `SELECT m.id, m.name, m.model, m.manufacturer, m.status, i.name AS lab_name FROM lab_machines m LEFT JOIN infrastructure i ON i.id = m.lab_id
       ${pin ? 'WHERE i.branch_id = ?' : ''} ORDER BY m.name`, pin ? [pin] : []);
    const reagents = await currentReagents({ scopeBranch: pin });
    const [names] = await db.query('SELECT DISTINCT machine_id, reagent_name FROM equipment_reagent_changes');
    const equipment = machines.map((m) => {
      const mine = reagents.filter((r) => r.machine_id === m.id);
      return { ...m, reagents: mine, known_reagents: names.filter((n) => n.machine_id === m.id).map((n) => n.reagent_name),
        expired: mine.filter((r) => r.state === 'Expired').length, expiring: mine.filter((r) => r.state === 'Expiring soon').length };
    });
    res.json({
      success: true, equipment, reasons: REASONS,
      summary: { on_board: reagents.length, expired: reagents.filter((r) => r.state === 'Expired').length, expiring: reagents.filter((r) => r.state === 'Expiring soon').length },
    });
  } catch (error) {
    console.error('Error loading reagent overview:', error);
    res.status(500).json({ success: false, message: 'Server error loading reagents' });
  }
};

// GET /api/lab/reagents/alerts — expired / expiring reagents only.
export const getReagentAlerts = async (req, res) => {
  try {
    const list = (await currentReagents({ scopeBranch: pinned(req) })).filter((r) => r.state !== 'OK');
    res.json({ success: true, alerts: list, expired: list.filter((r) => r.state === 'Expired').length, expiring: list.filter((r) => r.state === 'Expiring soon').length });
  } catch (error) {
    console.error('Error loading reagent alerts:', error);
    res.status(500).json({ success: false, message: 'Server error loading reagent alerts' });
  }
};

// GET /api/lab/reagents/history/:machineId
export const getReagentHistory = async (req, res) => {
  try {
    const m = await machineInScope(req, req.params.machineId);
    if (!m) return res.status(404).json({ success: false, message: 'Analyzer not found.' });
    const [rows] = await db.query('SELECT * FROM equipment_reagent_changes WHERE machine_id = ? ORDER BY changed_at DESC, id DESC LIMIT 200', [m.id]);
    res.json({ success: true, machine: m, history: rows });
  } catch (error) {
    console.error('Error loading reagent history:', error);
    res.status(500).json({ success: false, message: 'Server error loading history' });
  }
};

// POST /api/lab/reagents/change
//   From stock:  { machine_id, inventory_batch_id, quantity_issued?, reason, notes, changed_by_name (LIS-Agent only) }
//                — reagent, lot and expiry come from the stock batch, and the pack(s) are issued from inventory.
//   Manual:      { machine_id, reagent_name, lot_no, expiry_date, opened_on?, stability_days?, slot?, manufacturer?, reason, notes, ... }
export const recordReagentChange = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const b = req.body || {};
    const m = await machineInScope(req, b.machine_id);
    if (!m) return res.status(404).json({ success: false, message: 'Analyzer not found.' });
    const [[fac]] = await connection.query('SELECT i.branch_id FROM lab_machines mm LEFT JOIN infrastructure i ON i.id = mm.lab_id WHERE mm.id = ?', [m.id]);

    const opened = isDate(b.opened_on) ? b.opened_on : localYmd(new Date());
    const reason = REASONS.includes(b.reason) ? b.reason : 'Empty';
    const notes = String(b.notes || '').trim().slice(0, 500);

    let who;
    if (req.user?.id) {
      const [[u]] = await connection.query("SELECT CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id = ?", [req.user.id]);
      who = u?.name || 'Unknown';
    } else {
      who = String(b.changed_by_name || '').trim().slice(0, 150);
      if (who.length < 3) return res.status(400).json({ success: false, message: 'Enter your name — it is recorded as who changed the reagent.' });
      who = `${who} (via ${req.user?.device_label || 'workstation'})`;
    }

    await connection.beginTransaction();
    let reagent, lot, expiry, manufacturer = b.manufacturer ? String(b.manufacturer).slice(0, 120) : null;
    let stability = b.stability_days ? parseInt(b.stability_days, 10) : null;
    let batch = null; let qty = null;

    if (b.inventory_batch_id) {
      [[batch]] = await connection.query(
        `SELECT b.*, it.item_name, it.manufacturer AS item_maker FROM inventory_batches b JOIN inventory_items it ON it.id = b.item_id
         WHERE b.id = ? AND b.branch_id = ? FOR UPDATE`, [b.inventory_batch_id, fac?.branch_id]);
      if (!batch) { await connection.rollback(); return res.status(404).json({ success: false, message: 'That stock batch was not found at this facility.' }); }
      if (batch.status === 'Quarantine') { await connection.rollback(); return res.status(409).json({ success: false, message: 'This batch is in quarantine and cannot be loaded.' }); }
      qty = b.quantity_issued === undefined || b.quantity_issued === '' ? 1 : parseInt(b.quantity_issued, 10);
      if (!(qty >= 1)) { await connection.rollback(); return res.status(400).json({ success: false, message: 'Enter how many packs are being loaded.' }); }
      if (Number(batch.quantity_available) < qty) { await connection.rollback(); return res.status(409).json({ success: false, message: `Only ${batch.quantity_available} left in this batch.` }); }
      reagent = String(b.reagent_name || batch.item_name).trim().slice(0, 150);
      lot = String(batch.lot_number || batch.batch_number || '').slice(0, 80);
      expiry = batch.expiry_date ? (batch.expiry_date instanceof Date ? localYmd(batch.expiry_date) : String(batch.expiry_date).slice(0, 10)) : null;
      manufacturer = manufacturer || batch.item_maker || null;
      stability = stability || batch.stability_days || null;
      if (!expiry) { await connection.rollback(); return res.status(400).json({ success: false, message: 'This batch has no expiry date recorded — add it in inventory first.' }); }
    } else {
      reagent = String(b.reagent_name || '').trim().slice(0, 150);
      lot = String(b.lot_no || '').trim().slice(0, 80);
      expiry = b.expiry_date;
      if (reagent.length < 2) { await connection.rollback(); return res.status(400).json({ success: false, message: 'Enter the reagent name.' }); }
      if (lot.length < 1) { await connection.rollback(); return res.status(400).json({ success: false, message: 'Enter the lot number.' }); }
      if (!isDate(expiry)) { await connection.rollback(); return res.status(400).json({ success: false, message: 'Enter the expiry date.' }); }
    }
    if (stability && !(stability >= 1 && stability <= 730)) { await connection.rollback(); return res.status(400).json({ success: false, message: 'On-board stability must be between 1 and 730 days.' }); }
    const expired = expiry < localYmd(new Date());
    if (expired && notes.length < 5) { await connection.rollback(); return res.status(400).json({ success: false, message: 'This lot is already past its expiry date. Explain why it is being loaded (notes).' }); }

    const [[prev]] = await connection.query('SELECT lot_no FROM equipment_reagent_changes WHERE machine_id = ? AND reagent_name = ? ORDER BY id DESC LIMIT 1', [m.id, reagent]);
    const [ins] = await connection.query(
      `INSERT INTO equipment_reagent_changes (machine_id, reagent_name, lot_no, manufacturer, slot, expiry_date, opened_on, stability_days, replaced_lot_no,
                                              changed_at, changed_by, changed_by_name, reason, notes, loaded_expired, inventory_item_id, inventory_batch_id, quantity_issued)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.id, reagent, lot, manufacturer, b.slot ? String(b.slot).slice(0, 60) : null, expiry, opened, stability, prev?.lot_no || null,
       localDateTime(), req.user?.id || null, who, reason, notes || null, expired ? 1 : 0, batch?.item_id || null, batch?.id || null, qty]);

    // Issue the pack(s) from stock.
    if (batch) {
      await connection.query(
        // status is assigned BEFORE quantity_available so it is judged on the old quantity
        `UPDATE inventory_batches SET status = CASE WHEN quantity_available - ? <= 0 THEN 'Empty' ELSE status END,
                quantity_available = quantity_available - ?, open_vial_date = COALESCE(open_vial_date, ?) WHERE id = ?`, [qty, qty, opened, batch.id]);
      await connection.query(
        `INSERT INTO inventory_transactions (item_id, batch_id, type, quantity, reference_type, reference_id, remarks, branch_id, created_by)
         VALUES (?, ?, 'OUT', ?, 'REAGENT_LOAD', ?, ?, ?, ?)`,
        [batch.item_id, batch.id, qty, String(ins.insertId), `Loaded on ${m.name} by ${who}`, fac?.branch_id, req.user?.id || null]);
    }
    await connection.commit();
    res.json({ success: true, message: `${reagent} lot ${lot} recorded on ${m.name}.${batch ? ` ${qty} pack${qty > 1 ? 's' : ''} issued from stock.` : ''}${expired ? ' Note: this lot is expired.' : ''}` });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Error recording reagent change:', error);
    res.status(500).json({ success: false, message: 'Server error recording reagent change' });
  } finally {
    connection.release();
  }
};

// GET /api/lab/reagents/stock?machine_id= — stock batches that can be loaded on this analyzer.
export const getReagentStock = async (req, res) => {
  try {
    const m = await machineInScope(req, req.query.machine_id);
    if (!m) return res.status(404).json({ success: false, message: 'Analyzer not found.' });
    const [[fac]] = await db.query('SELECT i.branch_id FROM lab_machines m LEFT JOIN infrastructure i ON i.id = m.lab_id WHERE m.id = ?', [m.id]);
    const [rows] = await db.query(
      `SELECT b.id AS batch_id, b.lot_number, b.batch_number, b.expiry_date, b.quantity_available, b.status, b.stability_days,
              it.id AS item_id, it.item_name, it.category, it.unit, it.manufacturer, it.brand
       FROM inventory_batches b JOIN inventory_items it ON it.id = b.item_id
       WHERE b.branch_id = ? AND b.quantity_available > 0 AND b.status IN ('Active', 'Quarantine')
         AND it.status = 'Active' AND it.category IN ('Reagents', 'Calibrators', 'Controls', 'Consumables', 'Test Kits')
       ORDER BY it.item_name, b.expiry_date ASC`, [fac?.branch_id]);
    res.json({ success: true, stock: rows.map((r) => ({ ...r, expiry_date: r.expiry_date ? String(r.expiry_date instanceof Date ? localYmd(r.expiry_date) : r.expiry_date).slice(0, 10) : null, lot: r.lot_number || r.batch_number })) });
  } catch (error) {
    console.error('Error listing reagent stock:', error);
    res.status(500).json({ success: false, message: 'Server error listing stock' });
  }
};
