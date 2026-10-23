import db from '../config/db.js';
import { openPkcs12, DscError } from '../utils/dscSigner.js';
import { getSigningCertificate, requiresDsc, usesAgent } from '../utils/doctorDsc.js';
import { sealPassword } from '../utils/dscVault.js';

// Doctors' Digital Signature Certificates, managed by each hospital's admin
// (tender #36). A hospital admin sees and manages only their own hospital's
// doctors; a Central admin can pick any hospital. The certificate password is
// only used to read the file once, at upload — it is never stored.

const SIGNING_ROLES = ['Lab Doctor', 'Lab Head', 'Doctor', 'Admin', 'Super Admin'];
const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null);
const scopeBranch = (req) => pinned(req) || (req.query?.branch_id || req.body?.branch_id || null);

const publicRow = (r) => (r ? {
  id: r.id, auto: !!r.password_enc, common_name: r.common_name, issuer: r.issuer, serial: r.serial,
  valid_from: r.valid_from, valid_to: r.valid_to, uploaded_at: r.uploaded_at,
  expired: !!r.valid_to && new Date(r.valid_to) < new Date(),
  days_left: r.valid_to ? Math.floor((new Date(r.valid_to).getTime() - Date.now()) / 86400000) : null,
} : null);

// GET /api/lab/dsc/users?branch_id= — the hospital's doctors and their certificates.
export const listDscUsers = async (req, res) => {
  try {
    const branch = scopeBranch(req);
    const [branches] = pinned(req)
      ? await db.query('SELECT id, branch_name FROM branches WHERE id = ?', [pinned(req)])
      : await db.query("SELECT id, branch_name FROM branches WHERE status = 'Active' ORDER BY branch_name");
    if (!branch) return res.json({ success: true, branches, users: [], require_dsc: false, branch_id: null, hospital: null });
    const [[hosp]] = await db.query("SELECT * FROM user_dsc_certificates WHERE branch_id = ? AND kind = 'Hospital' AND status = 'Active' ORDER BY id DESC LIMIT 1", [branch]);

    const [users] = await db.query(
      `SELECT u.id, CONCAT_WS(' ', u.first_name, u.last_name) AS name, u.role, u.registration_no, u.branch_id,
              c.id AS dsc_id, c.common_name, c.issuer, c.serial, c.valid_from, c.valid_to, c.uploaded_at, c.password_enc,
              t.id AS token_id, t.common_name AS token_cn, t.serial AS token_serial, t.valid_to AS token_valid_to, t.token_info AS token_info
         FROM users u
         LEFT JOIN user_dsc_certificates c ON c.id = (SELECT MAX(id) FROM user_dsc_certificates WHERE user_id = u.id AND kind = 'Doctor' AND status = 'Active')
         LEFT JOIN user_dsc_certificates t ON t.id = (SELECT MAX(id) FROM user_dsc_certificates WHERE user_id = u.id AND kind = 'Token' AND status = 'Active')
        WHERE u.is_active <> 0 AND u.branch_id = ? AND u.role IN (?)
        ORDER BY name`, [branch, SIGNING_ROLES]);
    res.json({
      success: true, branches, branch_id: Number(branch), require_dsc: await requiresDsc(db, branch), use_agent: await usesAgent(db, branch), hospital: publicRow(hosp),
      users: users.map((u) => ({
        id: u.id, name: u.name, role: u.role, registration_no: u.registration_no,
        token: u.token_id ? { id: u.token_id, common_name: u.token_cn, serial: u.token_serial, valid_to: u.token_valid_to, device: u.token_info,
          expired: !!u.token_valid_to && new Date(u.token_valid_to) < new Date() } : null,
        dsc: u.dsc_id ? publicRow({ id: u.dsc_id, common_name: u.common_name, issuer: u.issuer, serial: u.serial, valid_from: u.valid_from, valid_to: u.valid_to, uploaded_at: u.uploaded_at, password_enc: u.password_enc }) : null,
      })),
    });
  } catch (error) {
    console.error('Error listing DSC users:', error);
    res.status(500).json({ success: false, message: 'Server error loading certificates' });
  }
};

// POST /api/lab/dsc/upload { kind: 'Hospital' | 'Doctor', user_id?, branch_id?, p12_base64, password, remember_password? }
// 'Hospital': the hospital's own Document Signer Certificate, applied to every
// report its doctors authorise. 'Doctor': one doctor's own certificate.
export const uploadDsc = async (req, res) => {
  try {
    const { user_id: userId, p12_base64: b64, password, remember_password: remember } = req.body || {};
    const kind = req.body?.kind === 'Hospital' ? 'Hospital' : 'Doctor';
    if (!b64) return res.status(400).json({ success: false, message: 'Choose the certificate file.' });

    let user = null;
    let branchId;
    if (kind === 'Doctor') {
      if (!userId) return res.status(400).json({ success: false, message: 'Choose the doctor.' });
      [[user]] = await db.query('SELECT id, branch_id, role, CONCAT_WS(\' \', first_name, last_name) AS name FROM users WHERE id = ? AND is_active <> 0', [userId]);
      if (!user || (pinned(req) && Number(user.branch_id) !== Number(pinned(req)))) return res.status(404).json({ success: false, message: 'That user was not found at your hospital.' });
      if (!SIGNING_ROLES.includes(user.role)) return res.status(409).json({ success: false, message: `${user.role} accounts do not authorise reports.` });
      branchId = user.branch_id;
    } else {
      branchId = scopeBranch(req);
      if (!branchId) return res.status(400).json({ success: false, message: 'Choose the hospital.' });
    }

    const raw = Buffer.from(String(b64).replace(/^data:[^,]*,/, ''), 'base64');
    if (raw.length < 100 || raw.length > 200 * 1024) return res.status(400).json({ success: false, message: 'That does not look like a certificate file (.pfx / .p12).' });

    // Read it once with the password, to check it and show what it is.
    let signer;
    try { signer = openPkcs12(raw, password || ''); }
    catch (e) {
      if (e instanceof DscError) return res.status(e.code === 'DSC_PASSWORD_WRONG' ? 401 : 400).json({ success: false, code: e.code, message: e.message });
      throw e;
    }
    const { info } = signer;
    if (info.valid_to < new Date()) return res.status(409).json({ success: false, message: `This certificate expired on ${info.valid_to.toLocaleDateString('en-IN')}.` });
    if (info.valid_from > new Date()) return res.status(409).json({ success: false, message: `This certificate is not valid until ${info.valid_from.toLocaleDateString('en-IN')}.` });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      if (kind === 'Doctor') {
        await conn.query("UPDATE user_dsc_certificates SET status = 'Revoked', revoked_by = ?, revoked_at = NOW() WHERE user_id = ? AND kind = 'Doctor' AND status = 'Active'", [req.user.id, user.id]);
      } else {
        await conn.query("UPDATE user_dsc_certificates SET status = 'Revoked', revoked_by = ?, revoked_at = NOW() WHERE branch_id = ? AND kind = 'Hospital' AND status = 'Active'", [req.user.id, branchId]);
      }
      const [ins] = await conn.query(
        `INSERT INTO user_dsc_certificates (user_id, kind, branch_id, p12_blob, password_enc, common_name, subject, issuer, serial, valid_from, valid_to, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [kind === 'Doctor' ? user.id : null, kind, branchId, raw, remember ? sealPassword(password) : null, info.common_name.slice(0, 200), info.subject.slice(0, 500),
          info.issuer.slice(0, 500), String(info.serial).slice(0, 100), info.valid_from, info.valid_to, req.user.id]);
      await conn.commit();
      const [[row]] = await db.query('SELECT * FROM user_dsc_certificates WHERE id = ?', [ins.insertId]);
      const who = kind === 'Hospital' ? 'this hospital' : user.name;
      res.status(201).json({
        success: true, dsc: publicRow(row),
        message: remember
          ? `Certificate set up for ${who}. Reports will now be signed automatically when a doctor authorises them.`
          : `Certificate set up for ${who}. The signer enters its password each time they authorise a report.`,
      });
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error('Error uploading DSC:', error);
    res.status(500).json({ success: false, message: 'Server error saving the certificate' });
  }
};

// POST /api/lab/dsc/:id/revoke
export const revokeDsc = async (req, res) => {
  try {
    const [[row]] = await db.query('SELECT id, branch_id FROM user_dsc_certificates WHERE id = ? AND status = \'Active\'', [req.params.id]);
    if (!row || (pinned(req) && Number(row.branch_id) !== Number(pinned(req)))) return res.status(404).json({ success: false, message: 'Certificate not found.' });
    await db.query("UPDATE user_dsc_certificates SET status = 'Revoked', revoked_by = ?, revoked_at = NOW() WHERE id = ?", [req.user.id, row.id]);
    res.json({ success: true, message: 'Certificate removed. The doctor can no longer sign with it; reports already signed stay valid.' });
  } catch (error) {
    console.error('Error revoking DSC:', error);
    res.status(500).json({ success: false, message: 'Server error removing the certificate' });
  }
};

// PUT /api/lab/dsc/settings { branch_id?, require_dsc }
export const saveDscSettings = async (req, res) => {
  try {
    const branch = scopeBranch(req);
    if (!branch) return res.status(400).json({ success: false, message: 'Choose a hospital.' });
    // Each switch is saved on its own; a field that is not sent is left as it is.
    const [[cur]] = await db.query('SELECT require_dsc, use_agent FROM branch_signing_settings WHERE branch_id = ?', [branch]);
    const requireDsc = req.body?.require_dsc === undefined ? !!cur?.require_dsc : !!req.body.require_dsc;
    const useAgent = req.body?.use_agent === undefined ? !!cur?.use_agent : !!req.body.use_agent;
    await db.query(
      `INSERT INTO branch_signing_settings (branch_id, require_dsc, use_agent, updated_by) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE require_dsc = VALUES(require_dsc), use_agent = VALUES(use_agent), updated_by = VALUES(updated_by)`,
      [branch, requireDsc ? 1 : 0, useAgent ? 1 : 0, req.user.id]);
    const message = req.body?.use_agent !== undefined
      ? (useAgent ? 'Doctors at this hospital now sign with their USB token through the Poxia DSC Agent.' : 'Doctors at this hospital no longer need the Poxia DSC Agent.')
      : (requireDsc ? 'Reports can now only be authorised with a Digital Signature Certificate.' : 'A Digital Signature Certificate is optional again.');
    res.json({ success: true, require_dsc: requireDsc, use_agent: useAgent, message });
  } catch (error) {
    console.error('Error saving DSC settings:', error);
    res.status(500).json({ success: false, message: 'Server error saving the setting' });
  }
};

// GET /api/lab/dsc/mine — which certificate will sign this doctor's reports, and does the sign dialog need to ask for its password?
export const myDsc = async (req, res) => {
  try {
    if (!req.user?.id || req.user.isDeviceKey) return res.json({ success: true, active: false, required: false });
    const [[u]] = await db.query('SELECT branch_id FROM users WHERE id = ?', [req.user.id]);
    // At a hospital that signs with USB tokens, the sign dialog hands the report to the Poxia DSC Agent.
    if (await usesAgent(db, u?.branch_id)) {
      const [[tok]] = await db.query("SELECT common_name, serial, valid_to FROM user_dsc_certificates WHERE user_id = ? AND kind = 'Token' AND status = 'Active' ORDER BY id DESC LIMIT 1", [req.user.id]);
      return res.json({ success: true, agent: true, active: true, ask_password: false, source: 'Token', dsc: tok ? publicRow({ ...tok, id: 0 }) : null, required: true });
    }
    const row = await getSigningCertificate(db, req.user.id, u?.branch_id);
    const d = publicRow(row);
    res.json({
      success: true, active: !!d && !d.expired, dsc: d, source: row?.kind || null,
      // true when nobody has stored the password, so the doctor must type it
      ask_password: !!d && !d.expired && !row.password_enc,
      required: await requiresDsc(db, u?.branch_id),
    });
  } catch (error) {
    console.error('Error reading own DSC:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
