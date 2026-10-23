import crypto from 'crypto';
import db from '../config/db.js';
import { openPkcs12, DscError } from './dscSigner.js';
import { openPassword } from './dscVault.js';
import { checkSignature } from './reportSignature.js';

// Doctors' own Digital Signature Certificates (tender #36). A hospital admin
// uploads the .pfx; the doctor types its password each time they authorise a
// report, and the server signs that report with it and keeps the signed PDF.
// The password is never stored or logged.

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_WRONG = 5;

export const getActiveDsc = async (conn, userId) => {
  const [[row]] = await conn.query("SELECT * FROM user_dsc_certificates WHERE user_id = ? AND kind = 'Doctor' AND status = 'Active' ORDER BY id DESC LIMIT 1", [userId]);
  return row || null;
};

export const usesAgent = async (conn, branchId) => {
  if (!branchId) return false;
  const [[s]] = await conn.query('SELECT use_agent FROM branch_signing_settings WHERE branch_id = ?', [branchId]);
  return !!s?.use_agent;
};

export const requiresDsc = async (conn, branchId) => {
  if (!branchId) return false;
  const [[s]] = await conn.query('SELECT require_dsc FROM branch_signing_settings WHERE branch_id = ?', [branchId]);
  return !!s?.require_dsc;
};

/** The certificate that applies to a doctor: their own, otherwise their hospital's. */
export async function getSigningCertificate(conn, userId, branchId) {
  const own = await getActiveDsc(conn, userId);
  if (own) return own;
  if (!branchId) return null;
  const [[hospital]] = await conn.query(
    "SELECT * FROM user_dsc_certificates WHERE branch_id = ? AND kind = 'Hospital' AND status = 'Active' ORDER BY id DESC LIMIT 1", [branchId]);
  return hospital || null;
}

/**
 * Called while a doctor authorises a report, before anything is committed.
 *   { signer: null }                    — no DSC applies; the login e-signature alone is used
 *   { signer, row, auto }               — the certificate is open and ready to sign
 *                                         (auto: its password was remembered, nobody typed it)
 *   { error: { status, code, message }} — refuse the approval
 */
export async function prepareDscForApproval(conn, actor, branchId, password) {
  const row = await getSigningCertificate(conn, actor.id, branchId);
  const required = await requiresDsc(conn, branchId);

  if (!row) {
    return required
      ? { error: { status: 409, code: 'DSC_REQUIRED', message: 'This hospital requires a Digital Signature Certificate to authorise reports. Ask your hospital admin to set one up.' } }
      : { signer: null };
  }
  if (row.valid_to && new Date(row.valid_to) < new Date()) {
    return required
      ? { error: { status: 409, code: 'DSC_EXPIRED', message: `The Digital Signature Certificate expired on ${new Date(row.valid_to).toLocaleDateString('en-IN')}. Ask your hospital admin to upload the renewed one.` } }
      : { signer: null, warning: 'The Digital Signature Certificate has expired — this report was signed with your login credentials only.' };
  }

  // Remembered password: signing happens by itself once the doctor has
  // authenticated with their login password (checked just before this).
  if (row.password_enc) {
    try {
      const signer = openPkcs12(row.p12_blob, openPassword(row.password_enc));
      return { signer, row, auto: true };
    } catch (e) {
      return { error: { status: 409, code: 'DSC_VAULT_UNREADABLE', message: 'The stored certificate password can no longer be read. Ask your hospital admin to upload the certificate again.' } };
    }
  }

  if (!password) {
    return { error: { status: 400, code: 'DSC_PASSWORD_REQUIRED', message: 'Enter your DSC password to sign this report.' } };
  }
  const now = Date.now();
  const recent = (attempts.get(actor.id) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_WRONG) {
    return { error: { status: 429, code: 'DSC_LOCKED', message: 'Too many wrong DSC passwords. Try again in 15 minutes.' } };
  }
  try {
    const signer = openPkcs12(row.p12_blob, password);
    attempts.delete(actor.id);
    return { signer, row, auto: false };
  } catch (e) {
    if (e instanceof DscError && e.code === 'DSC_PASSWORD_WRONG') {
      recent.push(now); attempts.set(actor.id, recent);
      return { error: { status: 401, code: 'DSC_PASSWORD_WRONG', message: 'The DSC password is incorrect — the report was not signed.' } };
    }
    return { error: { status: 409, code: e.code || 'DSC_UNREADABLE', message: e.message } };
  }
}

export async function saveSignedReport(conn, { signatureId, resultId, sampleId, branchId, dscId, signerId, pdf }) {
  await conn.query(
    `INSERT INTO signed_reports (signature_id, result_id, sample_id, branch_id, dsc_id, signer_id, pdf, pdf_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [signatureId, resultId, sampleId, branchId || null, dscId, signerId, pdf, crypto.createHash('sha256').update(pdf).digest('hex')]);
}

/**
 * The signed PDF kept when this sample's report was authorised with a doctor's
 * DSC — but only while the report is still exactly what was signed. Once
 * results change (an amendment revokes the signature) it is no longer served.
 */
export async function storedSignedPdf(sampleId) {
  if (!sampleId) return null;
  const [[tr]] = await db.query("SELECT id FROM lab_test_result WHERE sample_id = ? AND status = 'Approved' ORDER BY verified_at DESC, id DESC LIMIT 1", [sampleId]);
  if (!tr) return null;
  const [[sig]] = await db.query("SELECT * FROM report_signatures WHERE result_id = ? AND status = 'Valid' ORDER BY id DESC LIMIT 1", [tr.id]);
  if (!sig) return null;
  const [[stored]] = await db.query('SELECT pdf FROM signed_reports WHERE signature_id = ? ORDER BY id DESC LIMIT 1', [sig.id]);
  if (!stored) return null;
  const check = await checkSignature(db, sig);
  return check.state === 'Authentic' ? stored.pdf : null;
}

/** Details of the DSC that signed a given authorisation (for the public verification page). */
export async function dscForSignature(signatureId) {
  const [[r]] = await db.query(
    `SELECT c.common_name, c.issuer, c.valid_to FROM signed_reports s JOIN user_dsc_certificates c ON c.id = s.dsc_id
      WHERE s.signature_id = ? ORDER BY s.id DESC LIMIT 1`, [signatureId]);
  return r || null;
}
