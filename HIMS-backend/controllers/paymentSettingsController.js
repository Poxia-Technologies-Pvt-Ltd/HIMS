import db from '../config/db.js';
import { getPaymentSettings, registrationFeeStatus, ALL_METHODS, REG_FEE_RULES } from '../utils/paymentSettings.js';
import { razorpayEnabled, razorpayKeyId } from '../services/razorpayService.js';

// Settings → Payment Settings: per-hospital registration fee, payment
// methods, discount, part payment and online-payment switches.

const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null);
const branchOf = (req) => pinned(req) || Number(req.query.branch_id || req.body?.branch_id) || null;

// GET /api/payment-settings?branch_id=
export const getSettings = async (req, res) => {
  try {
    const branchId = branchOf(req);
    const [branches] = pinned(req)
      ? await db.query('SELECT id, branch_name FROM branches WHERE id = ?', [branchId])
      : await db.query("SELECT id, branch_name FROM branches WHERE status = 'Active' ORDER BY branch_name");
    const key = razorpayKeyId();
    res.json({
      success: true,
      branches,
      settings: branchId ? await getPaymentSettings(db, branchId) : null,
      options: { methods: ALL_METHODS, reg_fee_rules: REG_FEE_RULES },
      razorpay: { configured: razorpayEnabled(), mode: key ? (key.startsWith('rzp_live_') ? 'Live' : 'Test') : null, webhook: !!process.env.RAZORPAY_WEBHOOK_SECRET },
    });
  } catch (error) {
    console.error('getSettings error:', error);
    res.status(500).json({ success: false, message: 'Server error loading payment settings' });
  }
};

// PUT /api/payment-settings { branch_id, ...settings }
export const saveSettings = async (req, res) => {
  try {
    const branchId = branchOf(req);
    if (!branchId) return res.status(400).json({ success: false, message: 'Choose a hospital.' });
    const b = req.body || {};
    const methods = (Array.isArray(b.methods) ? b.methods : []).filter((m) => ALL_METHODS.includes(m));
    const amount = Number(b.reg_fee_amount);
    const days = parseInt(b.reg_fee_validity_days, 10);
    const maxDisc = Number(b.max_discount_percent);
    const expiry = parseInt(b.link_expiry_hours, 10);
    const errors = [];
    if (!methods.length) errors.push('Enable at least one payment method.');
    if (!methods.includes(b.default_method)) errors.push('The default method must be one of the enabled methods.');
    if (!REG_FEE_RULES.includes(b.reg_fee_rule)) errors.push('Choose when the registration fee is charged.');
    if (b.reg_fee_enabled && !(amount >= 0 && amount <= 100000)) errors.push('Enter a registration fee between ₹0 and ₹1,00,000.');
    if (b.reg_fee_rule === 'Renew after days' && !(days >= 1 && days <= 3650)) errors.push('Registration validity must be 1–3650 days.');
    if (!(maxDisc >= 0 && maxDisc <= 100)) errors.push('Maximum discount must be 0–100%.');
    if (!(expiry >= 1 && expiry <= 720)) errors.push('Payment-link validity must be 1–720 hours.');
    if (errors.length) return res.status(400).json({ success: false, message: errors.join(' ') });

    await db.query(
      `INSERT INTO branch_payment_settings (branch_id, reg_fee_enabled, reg_fee_amount, reg_fee_rule, reg_fee_validity_days, methods, default_method,
         allow_discount, max_discount_percent, allow_part_payment, online_counter, online_link, online_kiosk, link_expiry_hours, prepaid_diagnostics, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reg_fee_enabled = VALUES(reg_fee_enabled), reg_fee_amount = VALUES(reg_fee_amount), reg_fee_rule = VALUES(reg_fee_rule),
         reg_fee_validity_days = VALUES(reg_fee_validity_days), methods = VALUES(methods), default_method = VALUES(default_method),
         allow_discount = VALUES(allow_discount), max_discount_percent = VALUES(max_discount_percent), allow_part_payment = VALUES(allow_part_payment),
         online_counter = VALUES(online_counter), online_link = VALUES(online_link), online_kiosk = VALUES(online_kiosk),
         link_expiry_hours = VALUES(link_expiry_hours), prepaid_diagnostics = VALUES(prepaid_diagnostics), updated_by = VALUES(updated_by)`,
      [branchId, b.reg_fee_enabled ? 1 : 0, Number.isFinite(amount) ? amount : 0, b.reg_fee_rule, Number.isFinite(days) ? days : 365,
       methods.join(','), b.default_method, b.allow_discount ? 1 : 0, maxDisc, b.allow_part_payment ? 1 : 0,
       b.online_counter ? 1 : 0, b.online_link ? 1 : 0, b.online_kiosk ? 1 : 0, expiry, b.prepaid_diagnostics === false ? 0 : 1, req.user?.id || null]);
    res.json({ success: true, message: 'Payment settings saved.', settings: await getPaymentSettings(db, branchId) });
  } catch (error) {
    console.error('saveSettings error:', error);
    res.status(500).json({ success: false, message: 'Server error saving payment settings' });
  }
};

// GET /api/payment-settings/billing?patient_id=&exclude_bill_id= — what the
// billing screen needs: this hospital's rules and whether this patient owes
// the registration fee.
export const billingContext = async (req, res) => {
  try {
    const branchId = branchOf(req);
    const settings = await getPaymentSettings(db, branchId);
    const registration = await registrationFeeStatus(db, {
      patientId: Number(req.query.patient_id) || null, settings, excludeBillId: Number(req.query.exclude_bill_id) || null,
    });
    const methods = settings.methods.filter((m) => m !== 'Online' || (settings.online_counter && razorpayEnabled()));
    res.json({
      success: true,
      registration,
      methods,
      default_method: methods.includes(settings.default_method) ? settings.default_method : methods[0],
      allow_discount: settings.allow_discount,
      max_discount_percent: settings.allow_discount ? settings.max_discount_percent : 0,
      allow_part_payment: settings.allow_part_payment,
      prepaid_diagnostics: settings.prepaid_diagnostics,
      online_link: settings.online_link && razorpayEnabled(),
    });
  } catch (error) {
    console.error('billingContext error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
