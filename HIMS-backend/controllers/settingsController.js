import db from '../config/db.js';
import { normalizeRole } from '../middleware/auth.js';

const ADMIN_ROLES = ['Admin', 'Super Admin'];

// VAPT #15 (Improper Input Validation): the settings PoC stored raw
// `<h1>TEST</h1>` in the hospital address field, which then renders wherever
// the hospital profile is displayed (reports, letterheads, the settings page
// itself) — a persistent XSS. These fields are plain display text, never
// meant to carry markup, so strip tags outright rather than trying to
// allowlist a safe HTML subset.
const stripHtml = (value) =>
  typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : value;

export const getSettings = async (req, res) => {
  try {
    const [settings] = await db.query(`SELECT * FROM hospital_settings LIMIT 1`);
    if (settings.length > 0) {
      const data = { ...settings[0] };
      // This endpoint is shared by non-admin pages that only need
      // registration_fee (Billing.jsx, PurchaseManagement.jsx) — the SMTP
      // credential itself has no reason to leave the server for anyone but
      // the admin editing it in Settings.jsx.
      if (!ADMIN_ROLES.includes(normalizeRole(req.user?.role))) {
        delete data.smtp_pass;
      }
      res.json({ success: true, data });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (error) {
    // VAPT #8 (Improper Error Handling): log the real error server-side only
    // — the client shouldn't see raw DB/driver error text (table/column
    // names, SQL fragments) that error.message can carry.
    console.error('Error fetching settings:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching settings' });
  }
};

export const updateSettings = async (req, res) => {
  try {
    let {
      hospital_name, logo_url, address, phone, website, email,
      smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name, registration_fee
    } = req.body;

    hospital_name = stripHtml(hospital_name);
    address = stripHtml(address);
    phone = stripHtml(phone);
    website = stripHtml(website);
    email = stripHtml(email);
    smtp_from_name = stripHtml(smtp_from_name);

    const [existing] = await db.query(`SELECT id FROM hospital_settings LIMIT 1`);
    if (existing.length > 0) {
      await db.query(
        `UPDATE hospital_settings SET hospital_name=?, logo_url=?, address=?, phone=?, website=?, email=?,
         smtp_host=?, smtp_port=?, smtp_user=?, smtp_pass=?, smtp_from_name=?, registration_fee=? WHERE id=?`,
        [hospital_name, logo_url, address, phone, website, email,
         smtp_host, smtp_port || 587, smtp_user, smtp_pass, smtp_from_name, registration_fee || 15.00,
         existing[0].id]
      );
    } else {
      await db.query(
        `INSERT INTO hospital_settings
           (hospital_name, logo_url, address, phone, website, email,
            smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name, registration_fee)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [hospital_name, logo_url, address, phone, website, email,
         smtp_host, smtp_port || 587, smtp_user, smtp_pass, smtp_from_name, registration_fee || 15.00]
      );
    }

    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ success: false, message: 'Server error while updating settings' });
  }
};
