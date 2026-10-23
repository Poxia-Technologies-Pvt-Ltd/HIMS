import db from '../config/db.js';

// Reagents currently on each analyzer, derived from the change log: the latest
// row per (analyzer, reagent name). Expired / nearly-expired reagents are
// reported so screens can WARN; nothing here ever blocks a test.
const p2 = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const ymd = (v) => (v instanceof Date ? localYmd(v) : String(v).slice(0, 10));
export const REAGENT_WARN_DAYS = 14;      // shelf expiry: warn this far ahead
export const ONBOARD_WARN_DAYS = 3;       // on-board stability: warn this far ahead

const addDays = (dateStr, n) => { const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + n); return localYmd(d); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

export function reagentState(row) {
  const today = localYmd(new Date());
  const shelf = ymd(row.expiry_date);
  const onboard = row.stability_days ? addDays(ymd(row.opened_on), Number(row.stability_days)) : null;
  const effective = onboard && onboard < shelf ? onboard : shelf;
  const days = daysBetween(today, effective);
  const warn = effective === onboard && onboard < shelf ? ONBOARD_WARN_DAYS : REAGENT_WARN_DAYS;
  return {
    effective_expiry: effective, limited_by: effective === onboard && onboard < shelf ? 'On-board stability' : 'Expiry date',
    days_left: days, state: days < 0 ? 'Expired' : days <= warn ? 'Expiring soon' : 'OK',
  };
}

// scopeBranch: only equipment of that facility; machineIds: optional narrowing.
export async function currentReagents({ scopeBranch = null, machineId = null, conn = db } = {}) {
  const [rows] = await conn.query(
    `SELECT c.*, m.name AS machine_name, m.model, i.name AS lab_name, i.branch_id
     FROM equipment_reagent_changes c
     JOIN (SELECT machine_id, reagent_name, MAX(id) AS id FROM equipment_reagent_changes GROUP BY machine_id, reagent_name) latest ON latest.id = c.id
     JOIN lab_machines m ON m.id = c.machine_id
     LEFT JOIN infrastructure i ON i.id = m.lab_id
     WHERE 1 = 1 ${scopeBranch ? 'AND i.branch_id = ?' : ''} ${machineId ? 'AND c.machine_id = ?' : ''}
     ORDER BY m.name, c.reagent_name`,
    [...(scopeBranch ? [scopeBranch] : []), ...(machineId ? [machineId] : [])]
  );
  return rows.map((r) => ({ ...r, expiry_date: ymd(r.expiry_date), opened_on: ymd(r.opened_on), ...reagentState(r) }));
}

// Lots on an analyzer right now, for stamping onto a result.
export async function reagentSnapshot(conn, machineName) {
  if (!machineName) return null;
  const [[m]] = await conn.query('SELECT id FROM lab_machines WHERE name = ? LIMIT 1', [machineName]);
  if (!m) return null;
  const list = await currentReagents({ machineId: m.id, conn });
  return list.length ? list.map((r) => ({ reagent: r.reagent_name, lot: r.lot_no, expiry: r.expiry_date, state: r.state })) : null;
}

// Lots that were on an analyzer at a given moment (for results produced
// before lots were stamped on them): the latest change per reagent at or before `at`.
export async function reagentLotsAt(conn, machineId, at) {
  const [rows] = await conn.query(
    `SELECT c.reagent_name, c.lot_no, c.expiry_date, c.opened_on, c.stability_days
     FROM equipment_reagent_changes c
     JOIN (SELECT reagent_name, MAX(id) AS id FROM equipment_reagent_changes WHERE machine_id = ? AND changed_at <= ? GROUP BY reagent_name) x ON x.id = c.id`,
    [machineId, at]
  );
  return rows.length ? rows.map((r) => ({ reagent: r.reagent_name, lot: r.lot_no, expiry: ymd(r.expiry_date), state: reagentState(r).state })) : null;
}

// Inventory items currently issued on this analyzer through reagent loads.
// Their stock is deducted when the pack is loaded, so per-test deduction must
// skip them or the same reagent would be counted twice.
export async function loadedInventoryItemIds(conn, machineName) {
  if (!machineName) return new Set();
  const [[m]] = await conn.query('SELECT id FROM lab_machines WHERE name = ? LIMIT 1', [machineName]);
  if (!m) return new Set();
  const [rows] = await conn.query(
    `SELECT DISTINCT c.inventory_item_id FROM equipment_reagent_changes c
     JOIN (SELECT reagent_name, MAX(id) AS id FROM equipment_reagent_changes WHERE machine_id = ? GROUP BY reagent_name) x ON x.id = c.id
     WHERE c.inventory_item_id IS NOT NULL`, [m.id]);
  return new Set(rows.map((r) => r.inventory_item_id));
}
