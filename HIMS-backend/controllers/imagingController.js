import db from '../config/db.js';
import { readScope, nowIST, isISODate, fail } from '../utils/hr.js';
import { isCleared } from '../utils/charges.js';

// Imaging desk (X-ray, scans, ECG): the doctor's orders, gated by payment.
// A study may start only when its bill is paid, on approved credit or under a
// free scheme — the same rule as the lab.

const ORDER_SELECT = `
  SELECT ro.id, ro.patient_reg_no AS reg_no, ro.modality, ro.body_part, ro.clinical_indication, ro.urgency, ro.status,
         ro.scheduled_at, ro.performed_at, ro.report_text, ro.reported_at, ro.created_at,
         CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name, TIMESTAMPDIFF(YEAR, p.dob, CURDATE()) AS age, p.gender, p.telephone,
         CONCAT_WS(' ', d.first_name, d.last_name) AS doctor_name,
         pc.id AS charge_id, pc.status AS charge_status, pc.amount,
         b.id AS bill_id, b.invoice_no, b.payment_status, b.on_credit, b.billing_type, b.order_state, b.net_amount, b.paid_amount,
         (SELECT COALESCE(SUM(x.total_price), 0) FROM bill_items x
           WHERE x.bill_id = b.id AND x.status <> 'Cancelled' AND x.service_type NOT IN ('Laboratory','Imaging')) AS non_diagnostic
    FROM radiology_orders ro
    LEFT JOIN patients p ON p.reg_no = ro.patient_reg_no
    LEFT JOIN users d ON d.id = ro.doctor_id
    LEFT JOIN patient_charges pc ON pc.source_type = 'Imaging' AND pc.source_id = ro.id
    LEFT JOIN bills b ON b.id = pc.bill_id`;

const withClearance = (r) => ({
  ...r,
  cleared: r.charge_status === 'Billed' && isCleared(r),
  // An order with no charge (free study, price 0) is cleared by definition.
  ...(r.charge_id ? {} : { cleared: true }),
});

// GET /api/imaging/orders?date&status&modality
export const listOrders = async (req, res) => {
  try {
    const scope = readScope(req);
    const date = isISODate(req.query.date) ? req.query.date : nowIST().date;
    const where = ["(DATE(ro.created_at) = ? OR ro.status IN ('Ordered','Scheduled','InProgress'))"];
    const params = [date];
    if (req.query.status && req.query.status !== 'all') { where.push('ro.status = ?'); params.push(req.query.status); }
    if (req.query.modality) { where.push('ro.modality = ?'); params.push(req.query.modality); }
    if (scope) { where.push('(p.branch_id = ? OR p.branch_id IS NULL)'); params.push(scope); }
    const [rows] = await db.query(
      `${ORDER_SELECT} WHERE ${where.join(' AND ')}
        ORDER BY FIELD(ro.status, 'InProgress', 'Scheduled', 'Ordered', 'Completed', 'Cancelled'), FIELD(ro.urgency, 'STAT', 'Urgent') DESC, ro.created_at
        LIMIT 500`,
      params
    );
    res.json({ success: true, orders: rows.map(withClearance) });
  } catch (e) {
    console.error('imaging listOrders error:', e);
    fail(res, 500, 'Server error');
  }
};

const NEXT = { Ordered: ['Scheduled', 'InProgress'], Scheduled: ['InProgress'], InProgress: ['Completed'] };

// PATCH /api/imaging/orders/:id { status, report_text }
export const updateOrder = async (req, res) => {
  try {
    const [[o]] = await db.query(`${ORDER_SELECT} WHERE ro.id = ?`, [req.params.id]);
    if (!o) return fail(res, 404, 'Order not found');
    const order = withClearance(o);
    const { status } = req.body;
    const reportText = req.body.report_text !== undefined ? String(req.body.report_text || '').slice(0, 20000) : undefined;

    if (status && status !== order.status) {
      if (!(NEXT[order.status] || []).includes(status)) return fail(res, 409, `Cannot move from ${order.status} to ${status}`);
      if (['InProgress', 'Completed'].includes(status) && !order.cleared) {
        return fail(res, 402, order.charge_status === 'Unbilled'
          ? 'Not billed yet. Send the patient to the billing desk first.'
          : 'Payment pending. The bill must be paid (or approved for pay-later) before the study.', { code: 'NOT_CLEARED' });
      }
    }
    const sets = [];
    const params = [];
    const now = nowIST().datetime;
    if (status && status !== order.status) {
      sets.push('status = ?'); params.push(status);
      if (status === 'Scheduled') { sets.push('scheduled_at = ?'); params.push(now); }
      if (status === 'InProgress') { sets.push('performed_at = ?, performed_by = ?'); params.push(now, req.user.id); }
    }
    if (reportText !== undefined) {
      sets.push('report_text = ?, reported_by = ?, reported_at = ?'); params.push(reportText || null, req.user.id, now);
    }
    if (!sets.length) return res.json({ success: true });
    await db.query(`UPDATE radiology_orders SET ${sets.join(', ')} WHERE id = ?`, [...params, order.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('imaging updateOrder error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/imaging/medicine-stock — what the pharmacy holds, for the doctor's
// prescription screen. Only unexpired, available stock counts.
export const medicineStock = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT i.id, i.item_name AS name, i.unit,
              COALESCE(SUM(IF(bt.status = 'Active' AND (bt.expiry_date IS NULL OR bt.expiry_date >= CURDATE()), bt.quantity_available, 0)), 0) AS available,
              MIN(IF(bt.quantity_available > 0 AND bt.expiry_date >= CURDATE(), bt.expiry_date, NULL)) AS next_expiry
         FROM inventory_item_master i
         LEFT JOIN inventory_batches bt ON bt.item_id = i.id
        WHERE i.category = 'Medicine' AND i.status = 'Active'
        GROUP BY i.id, i.item_name, i.unit
        ORDER BY i.item_name`
    );
    res.json({ success: true, medicines: rows.map((r) => ({ ...r, available: Number(r.available) })) });
  } catch (e) {
    console.error('medicineStock error:', e);
    fail(res, 500, 'Server error');
  }
};
