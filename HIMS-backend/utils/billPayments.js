// The one place money is applied to a bill: writes the receipt (bill_payments)
// and updates the bill's running total and status, inside the caller's
// transaction. Used by counter payments (billingController.processPayment)
// and by Razorpay settlements (paymentController), so both produce the same
// receipt trail. The bill row is locked for the update, so two payments
// arriving together can never both read the old total.

export class PaymentError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

export async function recordBillPayment(conn, {
  bill_id, amount, method, channel = 'Counter', reference = null, gateway_txn_id = null, actor_id = null, actor_name = null, branchScope = null,
}) {
  const amt = round2(amount);
  if (!(amt > 0)) throw new PaymentError('Valid paid amount is required');

  const [[bill]] = await conn.query(
    `SELECT id, branch_id, bill_number, net_amount, paid_amount, payment_status FROM bills
      WHERE id = ? ${branchScope ? 'AND branch_id = ?' : ''} FOR UPDATE`,
    branchScope ? [bill_id, branchScope] : [bill_id]);
  if (!bill) throw new PaymentError('Bill not found', 404);
  if (bill.payment_status === 'Cancelled') throw new PaymentError('This bill has been cancelled.', 409);

  let actorName = actor_name;
  if (actor_id) {
    const [[u]] = await conn.query("SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [actor_id]);
    actorName = u?.name || null;
  }

  const [ins] = await conn.query(
    `INSERT INTO bill_payments (bill_id, branch_id, amount, method, channel, reference, gateway_txn_id, received_by, received_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [bill.id, bill.branch_id, amt, method, channel, reference, gateway_txn_id, actor_id, actorName]);
  const receipt_no = `RCPT-${String(ins.insertId).padStart(6, '0')}`;
  await conn.query('UPDATE bill_payments SET receipt_no = ? WHERE id = ?', [receipt_no, ins.insertId]);

  const paid = round2(Number(bill.paid_amount || 0) + amt);
  const net = round2(bill.net_amount);
  const payment_status = paid >= net ? 'Paid' : 'Partial';
  await conn.query('UPDATE bills SET paid_amount = ?, payment_status = ?, payment_method = ? WHERE id = ?',
    [paid, payment_status, method, bill.id]);

  return { receipt_no, bill_number: bill.bill_number, paid_amount: paid, payment_status, balance: round2(Math.max(0, net - paid)) };
}

// Amount still due on a bill (never negative).
export const balanceDue = (bill) => round2(Math.max(0, Number(bill.net_amount || 0) - Number(bill.paid_amount || 0)));
