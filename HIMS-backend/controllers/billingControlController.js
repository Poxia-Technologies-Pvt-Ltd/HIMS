import db from '../config/db.js';
import { normalizeRole } from '../middleware/auth.js';
import { readScope, writeScope, inScope, nowIST, isISODate, addDays, fail } from '../utils/hr.js';
import { round2, recomputeBill, recordRefund, statusFor } from '../utils/charges.js';

// Billing control: pending charges, prices, approvals (credit, cancellations,
// concessions — each carried out the moment it is approved), cashier shift
// closing and the control summary. Approvers are Admin / Super Admin /
// Accounts Manager, and never the person who asked.

export const APPROVER_ROLES = ['Admin', 'Super Admin', 'Accounts Manager'];
const isApprover = (req) => APPROVER_ROLES.includes(normalizeRole(req.user?.role));
const REFUND_METHODS = ['Cash', 'Card', 'UPI', 'Other'];
const userName = async (conn, id) => {
  if (!id) return null;
  const [[u]] = await conn.query("SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [id]);
  return u?.name || null;
};

// Items whose test has started cannot be cancelled: the work is done.
const STARTED = ['In Progress', 'Test Done', 'Completed'];

// ── Pending charges ──────────────────────────────────────────────────────────

const CHARGE_SELECT = `
  SELECT pc.id, pc.patient_id, pc.reg_no, pc.source_type, pc.source_id, pc.appointment_id, pc.description, pc.quantity,
         pc.unit_price, pc.amount, pc.status, pc.created_at, a.status AS appointment_status,
         DATE_FORMAT(a.appt_date, '%Y-%m-%d') AS appt_date, TIME_FORMAT(a.appt_time, '%H:%i') AS appt_time, a.token_number,
         CONCAT_WS(' ', u.first_name, u.last_name) AS ordered_by_name,
         ro.status AS imaging_status, ro.urgency AS imaging_urgency, dlo.urgency AS lab_urgency
    FROM patient_charges pc
    LEFT JOIN appointments a ON a.id = pc.appointment_id
    LEFT JOIN users u ON u.id = pc.ordered_by
    LEFT JOIN radiology_orders ro ON pc.source_type = 'Imaging' AND ro.id = pc.source_id
    LEFT JOIN doctor_lab_orders dlo ON pc.source_type = 'Laboratory' AND dlo.id = pc.source_id`;

// GET /api/billing/charges?patient_id | reg_no
export const patientCharges = async (req, res) => {
  try {
    const scope = readScope(req);
    const params = [];
    let where = `pc.status = 'Unbilled'`;
    if (req.query.patient_id) { where += ' AND pc.patient_id = ?'; params.push(req.query.patient_id); }
    else if (req.query.reg_no) { where += ' AND pc.reg_no = ?'; params.push(req.query.reg_no); }
    else return fail(res, 400, 'patient_id or reg_no required');
    if (scope) { where += ' AND pc.branch_id = ?'; params.push(scope); }
    const [rows] = await db.query(`${CHARGE_SELECT} WHERE ${where} ORDER BY pc.created_at`, params);
    res.json({ success: true, charges: rows });
  } catch (e) {
    console.error('patientCharges error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/billing/charges/queue — patients with charges waiting at the desk.
export const chargeQueue = async (req, res) => {
  try {
    const scope = readScope(req);
    const [rows] = await db.query(
      `SELECT pc.patient_id, pc.reg_no, CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name) AS patient_name, p.telephone,
              COUNT(*) AS items, SUM(pc.amount) AS total, MIN(pc.created_at) AS oldest,
              SUM(pc.source_type IN ('Laboratory','Imaging')) AS diagnostics,
              GROUP_CONCAT(DISTINCT pc.source_type ORDER BY pc.source_type) AS kinds
         FROM patient_charges pc JOIN patients p ON p.id = pc.patient_id
        WHERE pc.status = 'Unbilled' ${scope ? 'AND pc.branch_id = ?' : ''}
        GROUP BY pc.patient_id, pc.reg_no, patient_name, p.telephone
        ORDER BY diagnostics DESC, oldest`,
      scope ? [scope] : []
    );
    res.json({ success: true, queue: rows });
  } catch (e) {
    console.error('chargeQueue error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/billing/charges/:id/cancel { reason } — an unbilled charge that
// will not be given (patient refused the test). Approvers only: dropping a
// charge for a service that was given is exactly the leak to prevent.
export const cancelCharge = async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim().slice(0, 255);
    if (!reason) return fail(res, 400, 'Give the reason');
    const [[c]] = await db.query('SELECT * FROM patient_charges WHERE id = ?', [req.params.id]);
    if (!c || !inScope(req, c.branch_id)) return fail(res, 404, 'Charge not found');
    if (c.status !== 'Unbilled') return fail(res, 409, `This charge is already ${c.status.toLowerCase()}`);
    if (c.source_type === 'Imaging') {
      const [[ro]] = await db.query('SELECT status FROM radiology_orders WHERE id = ?', [c.source_id]);
      if (ro && ro.status !== 'Ordered') return fail(res, 409, 'The scan has already been done; it must be billed.');
    }
    await db.query(`UPDATE patient_charges SET status = 'Cancelled', cancel_reason = ?, cancelled_by = ? WHERE id = ?`, [reason, req.user.id, c.id]);
    if (c.source_type === 'Imaging') await db.query(`UPDATE radiology_orders SET status = 'Cancelled' WHERE id = ? AND status = 'Ordered'`, [c.source_id]);
    res.json({ success: true });
  } catch (e) {
    console.error('cancelCharge error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/billing/dues?patient_id — bills with money still owed.
export const patientDues = async (req, res) => {
  try {
    const scope = readScope(req);
    const params = [];
    let where = `b.status = 'Active' AND b.order_state = 'Confirmed' AND b.payment_status IN ('Pending','Partial') AND b.net_amount > b.paid_amount`;
    if (req.query.patient_id) { where += ' AND b.patient_id = ?'; params.push(req.query.patient_id); }
    if (scope) { where += ' AND b.branch_id = ?'; params.push(scope); }
    const [rows] = await db.query(
      `SELECT b.id, b.invoice_no, b.bill_number, b.patient_id, b.patient_name, b.net_amount, b.paid_amount,
              (b.net_amount - b.paid_amount) AS balance, b.on_credit, b.created_at
         FROM bills b WHERE ${where} ORDER BY b.created_at LIMIT 500`,
      params
    );
    res.json({ success: true, dues: rows });
  } catch (e) {
    console.error('patientDues error:', e);
    fail(res, 500, 'Server error');
  }
};

// ── Service prices ───────────────────────────────────────────────────────────

export const listTariffs = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, category, modality, name, code, price, is_active FROM service_tariffs
        ${req.query.all === '1' ? '' : 'WHERE is_active = 1'} ORDER BY category, modality, name = '*' DESC, name`
    );
    res.json({ success: true, tariffs: rows });
  } catch (e) {
    console.error('listTariffs error:', e);
    fail(res, 500, 'Server error');
  }
};

export const saveTariff = async (req, res) => {
  try {
    const b = req.body;
    const category = ['Imaging', 'Procedure', 'Other'].includes(b.category) ? b.category : null;
    const name = String(b.name || '').trim().slice(0, 150);
    const price = Number(b.price);
    if (!category || !name) return fail(res, 400, 'Category and name are required');
    if (!(price >= 0 && price <= 10000000)) return fail(res, 400, 'Enter a valid price');
    const modality = category === 'Imaging' ? String(b.modality || '').trim() || null : null;
    if (category === 'Imaging' && !modality) return fail(res, 400, 'Choose the imaging type');
    if (req.params.id) {
      await db.query(
        'UPDATE service_tariffs SET category = ?, modality = ?, name = ?, code = ?, price = ?, is_active = ?, updated_by = ? WHERE id = ?',
        [category, modality, name, b.code || null, price, b.is_active === false || b.is_active === 0 ? 0 : 1, req.user.id, req.params.id]
      );
      return res.json({ success: true });
    }
    const [r] = await db.query(
      'INSERT INTO service_tariffs (category, modality, name, code, price, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
      [category, modality, name, b.code || null, price, req.user.id]
    );
    res.status(201).json({ success: true, id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, 'That service already has a price');
    console.error('saveTariff error:', e);
    fail(res, 500, 'Server error');
  }
};

// ── Approvals ────────────────────────────────────────────────────────────────

// POST /api/billing/approvals
//  Credit       { patient_id, charge_ids?, amount, reason }
//  Cancel bill  { bill_id, reason, refund_method }
//  Cancel item  { bill_item_id, reason, refund_method }
//  Concession   { bill_id, amount, reason, refund_method }
export const requestApproval = async (req, res) => {
  try {
    const b = req.body;
    const reason = String(b.reason || '').trim().slice(0, 500);
    if (!reason) return fail(res, 400, 'Give the reason');
    const refundMethod = REFUND_METHODS.includes(b.refund_method) ? b.refund_method : null;
    let row = { kind: b.kind, reason, refund_method: refundMethod };

    if (b.kind === 'Credit') {
      const branchId = writeScope(req);
      const [[p]] = await db.query('SELECT id, branch_id FROM patients WHERE id = ?', [b.patient_id]);
      if (!p) return fail(res, 404, 'Patient not found');
      const amount = round2(b.amount);
      if (!(amount > 0)) return fail(res, 400, 'Enter the amount to give on credit');
      row = { ...row, branch_id: branchId || p.branch_id, patient_id: p.id, amount, charge_ids: JSON.stringify((b.charge_ids || []).map(Number)) };
    } else if (['Cancel bill', 'Concession'].includes(b.kind)) {
      const [[bill]] = await db.query('SELECT * FROM bills WHERE id = ?', [b.bill_id]);
      if (!bill || !inScope(req, bill.branch_id)) return fail(res, 404, 'Bill not found');
      if (bill.payment_status === 'Cancelled') return fail(res, 409, 'This bill is already cancelled');
      if (b.kind === 'Cancel bill') {
        const [[started]] = await db.query(`SELECT COUNT(*) AS n FROM bill_items WHERE bill_id = ? AND status IN (?)`, [bill.id, STARTED]);
        if (started.n) return fail(res, 409, 'Some tests on this bill have already been processed. Cancel only the items not yet done.');
        if (Number(bill.paid_amount) > 0 && !refundMethod) return fail(res, 400, 'Choose how the money is returned');
        row = { ...row, branch_id: bill.branch_id, patient_id: bill.patient_id, bill_id: bill.id, amount: round2(bill.paid_amount) };
      } else {
        const amount = round2(b.amount);
        if (!(amount > 0) || amount > Number(bill.net_amount)) return fail(res, 400, `Concession must be between ₹1 and ₹${Number(bill.net_amount).toFixed(2)}`);
        const refundDue = round2(Number(bill.paid_amount) - (Number(bill.net_amount) - amount));
        if (refundDue > 0 && !refundMethod) return fail(res, 400, 'This concession means returning money — choose how');
        row = { ...row, branch_id: bill.branch_id, patient_id: bill.patient_id, bill_id: bill.id, amount };
      }
    } else if (b.kind === 'Cancel item') {
      const [[it]] = await db.query(
        `SELECT bi.*, bl.branch_id, bl.patient_id, bl.paid_amount, bl.net_amount, bl.payment_status
           FROM bill_items bi JOIN bills bl ON bl.id = bi.bill_id WHERE bi.id = ?`,
        [b.bill_item_id]
      );
      if (!it || !inScope(req, it.branch_id)) return fail(res, 404, 'Bill item not found');
      if (it.status === 'Cancelled') return fail(res, 409, 'This item is already cancelled');
      if (STARTED.includes(it.status)) return fail(res, 409, 'This test has already been processed and cannot be cancelled.');
      if (it.service_type === 'Imaging' && it.charge_id) {
        const [[ro]] = await db.query(`SELECT ro.status FROM patient_charges pc JOIN radiology_orders ro ON ro.id = pc.source_id WHERE pc.id = ?`, [it.charge_id]);
        if (ro && !['Ordered', 'Scheduled'].includes(ro.status)) return fail(res, 409, 'This scan has already been done and cannot be cancelled.');
      }
      if (Number(it.paid_amount) > 0 && !refundMethod) return fail(res, 400, 'Choose how the money is returned');
      row = { ...row, branch_id: it.branch_id, patient_id: it.patient_id, bill_id: it.bill_id, bill_item_id: it.id, amount: round2(it.total_price) };
    } else {
      return fail(res, 400, 'Unknown request type');
    }

    const [[dup]] = await db.query(
      `SELECT id FROM billing_approvals WHERE status = 'Pending' AND kind = ? AND COALESCE(bill_id, 0) = ? AND COALESCE(bill_item_id, 0) = ? AND COALESCE(patient_id, 0) = ?`,
      [row.kind, row.bill_id || 0, row.bill_item_id || 0, row.patient_id || 0]
    );
    if (dup && row.kind !== 'Credit') return fail(res, 409, 'The same request is already waiting for approval');

    const cols = ['branch_id', 'kind', 'patient_id', 'bill_id', 'bill_item_id', 'charge_ids', 'amount', 'refund_method', 'reason'];
    const [r] = await db.query(
      `INSERT INTO billing_approvals (${cols.join(', ')}, requested_by) VALUES (${cols.map(() => '?').join(', ')}, ?)`,
      [...cols.map((c) => row[c] ?? null), req.user.id]
    );
    res.status(201).json({ success: true, id: r.insertId });
  } catch (e) {
    console.error('requestApproval error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/billing/approvals?status&patient_id&mine=1
export const listApprovals = async (req, res) => {
  try {
    const scope = readScope(req);
    const where = [];
    const params = [];
    if (scope) { where.push('ba.branch_id = ?'); params.push(scope); }
    if (req.query.status && req.query.status !== 'all') { where.push('ba.status = ?'); params.push(req.query.status); }
    if (req.query.patient_id) { where.push('ba.patient_id = ?'); params.push(req.query.patient_id); }
    if (req.query.kind) { where.push('ba.kind = ?'); params.push(req.query.kind); }
    // The desk sees its own requests, and every request for the patient in front of it.
    if (req.query.mine === '1' || (!isApprover(req) && !req.query.patient_id)) { where.push('ba.requested_by = ?'); params.push(req.user.id); }
    const [rows] = await db.query(
      `SELECT ba.*, CONCAT_WS(' ', rq.first_name, rq.last_name) AS requested_by_name, CONCAT_WS(' ', dc.first_name, dc.last_name) AS decided_by_name,
              CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name, p.reg_no, b.invoice_no, b.bill_number, b.net_amount, b.paid_amount,
              bi.service_name AS item_name
         FROM billing_approvals ba
         LEFT JOIN users rq ON rq.id = ba.requested_by
         LEFT JOIN users dc ON dc.id = ba.decided_by
         LEFT JOIN patients p ON p.id = ba.patient_id
         LEFT JOIN bills b ON b.id = ba.bill_id
         LEFT JOIN bill_items bi ON bi.id = ba.bill_item_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ba.status = 'Pending' DESC, ba.requested_at DESC LIMIT 300`,
      params
    );
    res.json({ success: true, approvals: rows, can_approve: isApprover(req) });
  } catch (e) {
    console.error('listApprovals error:', e);
    fail(res, 500, 'Server error');
  }
};

const loadForDecision = async (conn, req, res) => {
  const [[a]] = await conn.query('SELECT * FROM billing_approvals WHERE id = ? FOR UPDATE', [req.params.id]);
  if (!a || !inScope(req, a.branch_id)) { fail(res, 404, 'Request not found'); return null; }
  if (a.status !== 'Pending') { fail(res, 409, `This request is already ${a.status.toLowerCase()}`); return null; }
  return a;
};

// Carries out an approved request inside the transaction. Returns a result summary.
// Refunds are entered on the requesting cashier's shift: they hand the money back.
async function execute(conn, a, approverId) {
  const now = nowIST().datetime;
  const payer = a.requested_by;
  if (a.kind === 'Credit') return { message: 'Pay-later approved. Bill the patient choosing this approval.' };

  if (a.kind === 'Cancel bill') {
    const [[bill]] = await conn.query('SELECT * FROM bills WHERE id = ? FOR UPDATE', [a.bill_id]);
    if (bill.payment_status === 'Cancelled') throw Object.assign(new Error('Already cancelled'), { status: 409 });
    const [[started]] = await conn.query(`SELECT COUNT(*) AS n FROM bill_items WHERE bill_id = ? AND status IN (?)`, [bill.id, STARTED]);
    if (started.n) throw Object.assign(new Error('Tests on this bill have been processed since the request; it can no longer be cancelled.'), { status: 409 });
    const refund = Number(bill.paid_amount) > 0
      ? await recordRefund(conn, { bill_id: bill.id, amount: bill.paid_amount, method: a.refund_method, actor_id: payer, approval_id: a.id, reason: `Bill cancelled: ${a.reason}` })
      : null;
    await conn.query(`UPDATE bill_items SET status = 'Cancelled' WHERE bill_id = ?`, [bill.id]);
    await conn.query(
      `UPDATE bills SET payment_status = 'Cancelled', order_state = 'Cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?`,
      [now, approverId, a.reason, bill.id]
    );
    await conn.query(
      `UPDATE radiology_orders ro JOIN patient_charges pc ON pc.source_type = 'Imaging' AND pc.source_id = ro.id
          SET ro.status = 'Cancelled' WHERE pc.bill_id = ? AND ro.status IN ('Ordered','Scheduled')`, [bill.id]);
    await conn.query(`UPDATE patient_charges SET status = 'Cancelled', cancel_reason = ?, cancelled_by = ? WHERE bill_id = ?`,
      [`Bill cancelled: ${a.reason}`.slice(0, 255), approverId, bill.id]);
    return { refund, message: refund ? `Bill cancelled; ₹${refund.amount} returned (${refund.refund_no})` : 'Bill cancelled' };
  }

  if (a.kind === 'Cancel item') {
    const [[it]] = await conn.query('SELECT * FROM bill_items WHERE id = ? FOR UPDATE', [a.bill_item_id]);
    if (it.status === 'Cancelled' || STARTED.includes(it.status)) throw Object.assign(new Error('This item can no longer be cancelled'), { status: 409 });
    await conn.query(`UPDATE bill_items SET status = 'Cancelled' WHERE id = ?`, [it.id]);
    if (it.charge_id) {
      await conn.query(`UPDATE patient_charges SET status = 'Cancelled', cancel_reason = ?, cancelled_by = ? WHERE id = ?`, [`Cancelled: ${a.reason}`.slice(0, 255), approverId, it.charge_id]);
      await conn.query(`UPDATE radiology_orders ro JOIN patient_charges pc ON pc.source_type = 'Imaging' AND pc.source_id = ro.id
                          SET ro.status = 'Cancelled' WHERE pc.id = ? AND ro.status IN ('Ordered','Scheduled')`, [it.charge_id]);
    }
    const totals = await recomputeBill(conn, it.bill_id);
    const excess = round2(totals.paid - totals.net);
    const refund = excess > 0
      ? await recordRefund(conn, { bill_id: it.bill_id, amount: excess, method: a.refund_method, actor_id: payer, approval_id: a.id, reason: `Item cancelled: ${it.service_name}` })
      : null;
    return { refund, totals, message: refund ? `Item cancelled; ₹${refund.amount} returned (${refund.refund_no})` : 'Item cancelled; bill re-totalled' };
  }

  if (a.kind === 'Concession') {
    const [[bill]] = await conn.query('SELECT * FROM bills WHERE id = ? FOR UPDATE', [a.bill_id]);
    const amount = Math.min(Number(a.amount), Number(bill.net_amount));
    const net = round2(Number(bill.net_amount) - amount);
    await conn.query('UPDATE bills SET discount_amount = discount_amount + ?, net_amount = ?, payment_status = ? WHERE id = ?',
      [amount, net, statusFor(net, bill.paid_amount), bill.id]);
    const excess = round2(Number(bill.paid_amount) - net);
    const refund = excess > 0
      ? await recordRefund(conn, { bill_id: bill.id, amount: excess, method: a.refund_method, actor_id: payer, approval_id: a.id, reason: `Concession: ${a.reason}` })
      : null;
    return { refund, message: refund ? `Concession of ₹${amount} given; ₹${refund.amount} returned (${refund.refund_no})` : `Concession of ₹${amount} given` };
  }
  throw new Error('Unknown request type');
}

// POST /api/billing/approvals/:id/approve { note }
export const approve = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const a = await loadForDecision(conn, req, res);
    if (!a) { await conn.rollback(); return undefined; }
    if (a.requested_by === req.user.id) { await conn.rollback(); return fail(res, 403, 'You cannot approve your own request'); }
    const result = await execute(conn, a, req.user.id);
    await conn.query(
      `UPDATE billing_approvals SET status = 'Approved', decided_by = ?, decided_at = ?, decision_note = ?, result = ? WHERE id = ?`,
      [req.user.id, nowIST().datetime, String(req.body.note || '').slice(0, 500) || null, JSON.stringify(result), a.id]
    );
    await conn.commit();
    res.json({ success: true, ...result });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e.status) return fail(res, e.status, e.message);
    console.error('approve error:', e);
    fail(res, 500, 'Server error');
  } finally {
    conn.release();
  }
};

// POST /api/billing/approvals/:id/reject { note }
export const reject = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const a = await loadForDecision(conn, req, res);
    if (!a) { await conn.rollback(); return undefined; }
    const note = String(req.body.note || '').trim().slice(0, 500);
    if (!note) { await conn.rollback(); return fail(res, 400, 'Give the reason for rejecting'); }
    await conn.query(`UPDATE billing_approvals SET status = 'Rejected', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?`,
      [req.user.id, nowIST().datetime, note, a.id]);
    await conn.commit();
    res.json({ success: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error('reject error:', e);
    fail(res, 500, 'Server error');
  } finally {
    conn.release();
  }
};

// POST /api/billing/approvals/:id/withdraw — by the person who asked.
export const withdraw = async (req, res) => {
  try {
    // Pending requests, or an approved credit not yet used on a bill.
    const [r] = await db.query(
      `UPDATE billing_approvals SET status = 'Withdrawn', decided_at = ?
        WHERE id = ? AND requested_by = ? AND (status = 'Pending' OR (status = 'Approved' AND kind = 'Credit'))`,
      [nowIST().datetime, req.params.id, req.user.id]
    );
    if (!r.affectedRows) return fail(res, 409, 'Only your own pending request can be withdrawn');
    res.json({ success: true });
  } catch (e) {
    console.error('withdraw error:', e);
    fail(res, 500, 'Server error');
  }
};

// ── Cashier shift closing ────────────────────────────────────────────────────

async function openShift(conn, userId) {
  const [[last]] = await conn.query('SELECT MAX(to_payment_id) AS last_id FROM cash_closings WHERE user_id = ?', [userId]);
  const [rows] = await conn.query(
    `SELECT id, receipt_no, kind, amount, method, bill_id, created_at FROM bill_payments
      WHERE received_by = ? AND channel = 'Counter' AND id > ? ORDER BY id`,
    [userId, last?.last_id || 0]
  );
  const totals = {};
  rows.forEach((r) => {
    totals[r.method] = totals[r.method] || { in: 0, out: 0 };
    totals[r.method][r.kind === 'Refund' ? 'out' : 'in'] = round2(totals[r.method][r.kind === 'Refund' ? 'out' : 'in'] + Number(r.amount));
  });
  const cash = totals.Cash ? round2(totals.Cash.in - totals.Cash.out) : 0;
  return { rows, totals, system_cash: cash, from_id: rows[0]?.id || null, to_id: rows[rows.length - 1]?.id || null };
}

// GET /api/billing/closing/current — my receipts since my last closing.
export const currentShift = async (req, res) => {
  try {
    const s = await openShift(db, req.user.id);
    res.json({ success: true, receipts: s.rows, totals: s.totals, system_cash: s.system_cash });
  } catch (e) {
    console.error('currentShift error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/billing/closing { declared_cash, note }
export const closeShift = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
    const s = await openShift(conn, req.user.id);
    if (!s.rows.length) { await conn.rollback(); return fail(res, 400, 'No receipts since your last closing'); }
    const declared = round2(req.body.declared_cash);
    if (!(declared >= 0)) { await conn.rollback(); return fail(res, 400, 'Enter the cash you are handing over'); }
    const diff = round2(declared - s.system_cash);
    const note = String(req.body.note || '').trim().slice(0, 500);
    if (Math.abs(diff) >= 1 && !note) { await conn.rollback(); return fail(res, 400, `Cash differs by ₹${diff.toFixed(2)} — write what happened`); }
    const [r] = await conn.query(
      `INSERT INTO cash_closings (branch_id, user_id, user_name, from_payment_id, to_payment_id, receipts_count, totals, system_cash, declared_cash, difference, note, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.branch_id, req.user.id, await userName(conn, req.user.id), s.from_id, s.to_id, s.rows.length, JSON.stringify(s.totals),
        s.system_cash, declared, diff, note || null, nowIST().datetime]
    );
    await conn.commit();
    res.status(201).json({ success: true, id: r.insertId, difference: diff });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error('closeShift error:', e);
    fail(res, 500, 'Server error');
  } finally {
    conn.release();
  }
};

// GET /api/billing/closings?from&to — approvers see everyone's, others their own.
export const listClosings = async (req, res) => {
  try {
    const scope = readScope(req);
    const to = isISODate(req.query.to) ? req.query.to : nowIST().date;
    const from = isISODate(req.query.from) ? req.query.from : addDays(to, -30);
    const where = ['DATE(closed_at) BETWEEN ? AND ?'];
    const params = [from, to];
    if (scope) { where.push('branch_id = ?'); params.push(scope); }
    if (!isApprover(req)) { where.push('user_id = ?'); params.push(req.user.id); }
    const [rows] = await db.query(`SELECT * FROM cash_closings WHERE ${where.join(' AND ')} ORDER BY closed_at DESC LIMIT 300`, params);
    res.json({ success: true, closings: rows });
  } catch (e) {
    console.error('listClosings error:', e);
    fail(res, 500, 'Server error');
  }
};

// ── Control summary ──────────────────────────────────────────────────────────

// GET /api/billing/control?date — collections, leakage and exceptions for a day.
export const controlSummary = async (req, res) => {
  try {
    const scope = readScope(req);
    const date = isISODate(req.query.date) ? req.query.date : nowIST().date;
    const bw = scope ? 'AND branch_id = ?' : '';
    const p = (extra = []) => (scope ? [...extra, scope] : extra);

    const [byMethod] = await db.query(
      `SELECT method, SUM(kind = 'Receipt') AS receipts, SUM(IF(kind = 'Receipt', amount, 0)) AS received, SUM(IF(kind = 'Refund', amount, 0)) AS refunded
         FROM bill_payments WHERE DATE(created_at) = ? ${bw} GROUP BY method`, p([date]));
    const [byCashier] = await db.query(
      `SELECT COALESCE(received_by_name, 'Online / system') AS cashier, received_by, SUM(IF(kind = 'Receipt', amount, 0)) AS received,
              SUM(IF(kind = 'Refund', amount, 0)) AS refunded, COUNT(*) AS entries
         FROM bill_payments WHERE DATE(created_at) = ? ${bw} GROUP BY cashier, received_by ORDER BY received DESC`, p([date]));
    const [[billing]] = await db.query(
      `SELECT COUNT(*) AS bills, COALESCE(SUM(total_amount), 0) AS gross, COALESCE(SUM(discount_amount), 0) AS discounts,
              COALESCE(SUM(net_amount), 0) AS net, SUM(on_credit) AS on_credit
         FROM bills WHERE DATE(created_at) = ? AND order_state = 'Confirmed' AND payment_status <> 'Cancelled' ${bw}`, p([date]));
    const [unbilled] = await db.query(
      `SELECT pc.id, pc.reg_no, CONCAT_WS(' ', pt.first_name, pt.last_name) AS patient_name, pc.source_type, pc.description, pc.amount,
              pc.created_at, a.status AS appointment_status, ro.status AS imaging_status,
              TIMESTAMPDIFF(MINUTE, pc.created_at, NOW()) AS age_min
         FROM patient_charges pc JOIN patients pt ON pt.id = pc.patient_id
         LEFT JOIN appointments a ON a.id = pc.appointment_id
         LEFT JOIN radiology_orders ro ON pc.source_type = 'Imaging' AND ro.id = pc.source_id
        WHERE pc.status = 'Unbilled' ${scope ? 'AND pc.branch_id = ?' : ''}
        ORDER BY (a.status IN ('Completed','In Consultation')) DESC, pc.created_at LIMIT 300`, p());
    const [dues] = await db.query(
      `SELECT id, invoice_no, bill_number, patient_name, net_amount, paid_amount, (net_amount - paid_amount) AS balance, on_credit,
              DATEDIFF(NOW(), created_at) AS age_days
         FROM bills WHERE status = 'Active' AND order_state = 'Confirmed' AND payment_status IN ('Pending','Partial') AND net_amount > paid_amount ${bw}
        ORDER BY created_at LIMIT 300`, p());
    const [exceptions] = await db.query(
      `SELECT ba.id, ba.kind, ba.status, ba.amount, ba.reason, ba.requested_at, ba.decided_at, ba.result,
              CONCAT_WS(' ', rq.first_name, rq.last_name) AS requested_by_name, CONCAT_WS(' ', dc.first_name, dc.last_name) AS decided_by_name,
              b.invoice_no, CONCAT_WS(' ', pt.first_name, pt.last_name) AS patient_name
         FROM billing_approvals ba
         LEFT JOIN users rq ON rq.id = ba.requested_by LEFT JOIN users dc ON dc.id = ba.decided_by
         LEFT JOIN bills b ON b.id = ba.bill_id LEFT JOIN patients pt ON pt.id = ba.patient_id
        WHERE (DATE(ba.requested_at) = ? OR DATE(ba.decided_at) = ? OR ba.status = 'Pending') ${scope ? 'AND ba.branch_id = ?' : ''}
        ORDER BY ba.requested_at DESC`, p([date, date]));
    const [closings] = await db.query(`SELECT * FROM cash_closings WHERE DATE(closed_at) = ? ${bw} ORDER BY closed_at DESC`, p([date]));
    const [openCashiers] = await db.query(
      `SELECT bp.received_by, bp.received_by_name, COUNT(*) AS entries
         FROM bill_payments bp
        WHERE bp.channel = 'Counter' AND bp.received_by IS NOT NULL AND DATE(bp.created_at) = ? ${scope ? 'AND bp.branch_id = ?' : ''}
          AND bp.id > COALESCE((SELECT MAX(to_payment_id) FROM cash_closings c WHERE c.user_id = bp.received_by), 0)
        GROUP BY bp.received_by, bp.received_by_name`, p([date]));
    res.json({
      success: true, date, by_method: byMethod, by_cashier: byCashier, billing, unbilled, dues, exceptions, closings, open_cashiers: openCashiers,
    });
  } catch (e) {
    console.error('controlSummary error:', e);
    fail(res, 500, 'Server error');
  }
};
