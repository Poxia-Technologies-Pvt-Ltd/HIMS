import db from '../config/db.js';
import { PUBLIC_API_URL } from '../config/publicUrl.js';
import { validateSignatureImage, checkSignature, verifyKeyOk } from '../utils/reportSignature.js';
import { dscForSignature } from '../utils/doctorDsc.js';
import { reportQrSignature } from './labController.js';

// The authorizing doctor's own signature profile, and the public page that
// lets anyone check a printed report.

// GET /api/lab/my-signature
export const getMySignature = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(403).json({ success: false, message: 'Sign in as a staff member.' });
    const [[u]] = await db.query('SELECT registration_no, designation, signature_image, signature_updated_at FROM users WHERE id = ?', [req.user.id]);
    res.json({
      success: true,
      profile: {
        registration_no: u?.registration_no || '', designation: u?.designation || '',
        signature_image: u?.signature_image || null, has_signature: !!u?.signature_image,
        complete: !!(u?.registration_no && u?.signature_image), updated_at: u?.signature_updated_at || null,
      },
    });
  } catch (error) {
    console.error('Error reading signature profile:', error);
    res.status(500).json({ success: false, message: 'Server error reading signature profile' });
  }
};

// PUT /api/lab/my-signature { registration_no, designation, signature_image }
export const saveMySignature = async (req, res) => {
  try {
    if (!req.user?.id || req.user.isDeviceKey) return res.status(403).json({ success: false, message: 'Sign in as a staff member.' });
    const registration_no = String(req.body.registration_no || '').trim().slice(0, 60);
    const designation = String(req.body.designation || '').trim().slice(0, 100);
    if (registration_no.length < 3) return res.status(400).json({ success: false, message: 'Enter your medical registration number.' });
    const image = req.body.signature_image;
    if (image) {
      const problem = validateSignatureImage(image);
      if (problem) return res.status(400).json({ success: false, message: problem });
    }
    await db.query(
      `UPDATE users SET registration_no = ?, designation = ?, signature_image = COALESCE(?, signature_image), signature_updated_at = NOW() WHERE id = ?`,
      [registration_no, designation || null, image || null, req.user.id]
    );
    res.json({ success: true, message: 'Signature profile saved.' });
  } catch (error) {
    console.error('Error saving signature profile:', error);
    res.status(500).json({ success: false, message: 'Server error saving signature profile' });
  }
};

const maskName = (name) => String(name || '').split(/\s+/).filter(Boolean).map((w) => `${w[0]}${'*'.repeat(Math.max(w.length - 1, 1))}`).join(' ');

// GET /api/lab/report-verify/:id?k=  (public, rate-limited)
// Tells whoever scanned the QR whether the report is the one the doctor signed.
export const verifyReportPublic = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !verifyKeyOk(id, String(req.query.k || ''))) {
      return res.status(403).json({ success: false, message: 'This verification link is not valid.' });
    }
    const [[sig]] = await db.query('SELECT * FROM report_signatures WHERE id = ?', [id]);
    if (!sig) return res.status(404).json({ success: false, message: 'No signed report found for this link.' });

    const check = await checkSignature(db, sig);
    const [[info]] = await db.query(
      `SELECT tr.test_name, p.reg_no, CONCAT(p.first_name, ' ', p.last_name) AS patient_name, br.branch_name
       FROM lab_test_result tr LEFT JOIN patients p ON p.id = tr.patient_id
       LEFT JOIN branches br ON br.id = tr.branch_id WHERE tr.id = ?`, [sig.result_id]
    );
    res.json({
      success: true,
      state: check.state,                                   // Authentic | Altered | Revoked
      signer: { name: sig.signer_name, designation: sig.designation, registration_no: sig.registration_no, method: sig.method },
      signed_at: sig.signed_at,
      dsc: await dscForSignature(sig.id).then((d) => (d ? { signer: d.common_name, issuer: d.issuer, valid_to: d.valid_to } : null)).catch(() => null),
      facility: info?.branch_name || null,
      test_name: info?.test_name || null,
      patient: info ? { name: maskName(info.patient_name), reg_no: info.reg_no ? `…${String(info.reg_no).slice(-4)}` : null } : null,
      content_hash: sig.content_hash,
      report_url: `${PUBLIC_API_URL}/api/lab/report/${encodeURIComponent(sig.sample_id)}?k=${reportQrSignature(sig.sample_id)}`,
      sample_id: sig.sample_id,
    });
  } catch (error) {
    console.error('Error verifying report:', error);
    res.status(500).json({ success: false, message: 'Could not verify this report.' });
  }
};
