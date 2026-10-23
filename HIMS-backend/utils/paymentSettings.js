// A hospital's payment settings (branch_payment_settings), merged over the
// defaults, and the registration-fee rule. Used by the Payment Settings page,
// the billing screen, and — so the screen cannot be bypassed — by createBill,
// processPayment and the Razorpay endpoints.

export const ALL_METHODS = ['Cash', 'Card', 'UPI', 'Online', 'Insurance', 'Other'];
export const REG_FEE_RULES = ['First registration', 'Every visit', 'Renew after days'];

export async function getPaymentSettings(conn, branchId) {
  const [[hs]] = await conn.query('SELECT registration_fee FROM hospital_settings LIMIT 1');
  const defaults = {
    branch_id: branchId || null,
    configured: false,
    reg_fee_enabled: true,
    reg_fee_amount: Number(hs?.registration_fee ?? 0),
    reg_fee_rule: 'First registration',
    reg_fee_validity_days: 365,
    methods: [...ALL_METHODS],
    default_method: 'Cash',
    allow_discount: true,
    max_discount_percent: 100,
    allow_part_payment: true,
    online_counter: true,
    online_link: true,
    online_kiosk: true,
    link_expiry_hours: 48,
    // Lab tests and X-ray/scans are paid before they are done.
    prepaid_diagnostics: true,
  };
  if (!branchId) return defaults;
  const [[row]] = await conn.query('SELECT * FROM branch_payment_settings WHERE branch_id = ?', [branchId]);
  if (!row) return defaults;
  const methods = String(row.methods || '').split(',').map((m) => m.trim()).filter((m) => ALL_METHODS.includes(m));
  return {
    branch_id: branchId,
    configured: true,
    reg_fee_enabled: !!row.reg_fee_enabled,
    reg_fee_amount: Number(row.reg_fee_amount),
    reg_fee_rule: row.reg_fee_rule,
    reg_fee_validity_days: Number(row.reg_fee_validity_days) || 365,
    methods: methods.length ? methods : ['Cash'],
    default_method: methods.includes(row.default_method) ? row.default_method : (methods[0] || 'Cash'),
    allow_discount: !!row.allow_discount,
    max_discount_percent: Number(row.max_discount_percent),
    allow_part_payment: !!row.allow_part_payment,
    online_counter: !!row.online_counter,
    online_link: !!row.online_link,
    online_kiosk: !!row.online_kiosk,
    link_expiry_hours: Number(row.link_expiry_hours) || 48,
    prepaid_diagnostics: row.prepaid_diagnostics === undefined ? true : !!row.prepaid_diagnostics,
  };
}

const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Whether this patient owes the registration fee on a new bill at this
 * hospital. excludeBillId: the bill being modified, which must not count as
 * the patient's earlier registration.
 * → { due, amount, reason, last_paid_at }
 */
export async function registrationFeeStatus(conn, { patientId, settings, excludeBillId = null }) {
  const amount = Number(settings.reg_fee_amount) || 0;
  if (!settings.reg_fee_enabled || amount <= 0) {
    return { due: false, amount: 0, reason: 'This hospital does not charge a registration fee.', last_paid_at: null };
  }
  if (settings.reg_fee_rule === 'Every visit') {
    return { due: true, amount, reason: 'Charged on every visit.', last_paid_at: null };
  }
  if (!patientId) return { due: true, amount, reason: 'New registration.', last_paid_at: null };

  const [[last]] = await conn.query(
    `SELECT MAX(b.created_at) AS paid_at
       FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
      WHERE b.patient_id = ? AND bi.service_type = 'Registration'
        AND COALESCE(b.payment_status, '') <> 'Cancelled' ${excludeBillId ? 'AND b.id <> ?' : ''}`,
    excludeBillId ? [patientId, excludeBillId] : [patientId]);
  const paidAt = last?.paid_at || null;

  if (!paidAt) return { due: true, amount, reason: 'First registration — new CRN.', last_paid_at: null };
  if (settings.reg_fee_rule === 'First registration') {
    return { due: false, amount: 0, reason: `Already registered — fee paid on ${fmtDate(paidAt)}.`, last_paid_at: paidAt };
  }
  const days = Math.floor((Date.now() - new Date(paidAt).getTime()) / 86400000);
  return days >= settings.reg_fee_validity_days
    ? { due: true, amount, reason: `Registration renewal — last paid ${fmtDate(paidAt)} (valid ${settings.reg_fee_validity_days} days).`, last_paid_at: paidAt }
    : { due: false, amount: 0, reason: `Registration valid until ${fmtDate(new Date(paidAt).getTime() + settings.reg_fee_validity_days * 86400000)}.`, last_paid_at: paidAt };
}

// Registration lines of an order: typed 'Registration', or older screens'
// 'Other' line named "Registration Fee".
export const isRegistrationLine = (item) =>
  item.service_type === 'Registration' || (item.service_type === 'Other' && /^registration fee/i.test(String(item.service_name || item.name || '').trim()));

/**
 * Applies the registration-fee rule to an order's lines: keeps one
 * registration line at the configured amount when the fee is due, removes it
 * when it is not. Returns { items, registration }.
 */
export async function applyRegistrationRule(conn, { items, patientId, settings, excludeBillId = null }) {
  const registration = await registrationFeeStatus(conn, { patientId, settings, excludeBillId });
  const others = items.filter((i) => !isRegistrationLine(i));
  const hadLine = others.length !== items.length;
  if (!registration.due || !hadLine) return { items: others, registration };
  return {
    items: [{ service_type: 'Registration', service_id: null, service_name: 'Registration Fee', service_code: 'REG-FEE',
      quantity: 1, unit_price: registration.amount, total_price: registration.amount }, ...others],
    registration,
  };
}
