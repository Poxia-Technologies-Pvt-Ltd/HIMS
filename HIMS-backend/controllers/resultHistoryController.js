import db from '../config/db.js';
import { logResultAudit, snapshotVersion } from '../utils/resultAudit.js';
import { confirmPassword } from '../utils/reportSignature.js';
import { actorFromReq } from '../utils/sampleLifecycle.js';

// Verification history of one lab result, and cancellation / reissue of an
// authorized report.

const pinnedBranch = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null);
const parse = (v) => (typeof v === 'string' ? JSON.parse(v || 'null') : v);

async function loadResult(conn, id, req, forUpdate = false) {
  const pin = pinnedBranch(req);
  const [[row]] = await conn.query(
    `SELECT tr.*, CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.reg_no
     FROM lab_test_result tr LEFT JOIN patients p ON p.id = tr.patient_id
     WHERE tr.id = ? ${pin ? 'AND (tr.branch_id = ? OR tr.branch_id IS NULL)' : ''} ${forUpdate ? 'FOR UPDATE' : ''}`,
    pin ? [id, pin] : [id]
  );
  return row || null;
}

// GET /api/lab/results/:id/history
export const getResultHistory = async (req, res) => {
  try {
    const result = await loadResult(db, req.params.id, req);
    if (!result) return res.status(404).json({ success: false, message: 'Result not found.' });
    const [events] = await db.query('SELECT * FROM lab_result_audit WHERE result_id = ? ORDER BY created_at ASC, id ASC', [result.id]);
    const [versions] = await db.query(
      `SELECT id, version, status_at_change, approved_by, approved_at, signature_id, superseded_reason, superseded_by_name, superseded_at, results_json
       FROM lab_result_versions WHERE result_id = ? ORDER BY version ASC`, [result.id]);
    const [signatures] = await db.query(
      `SELECT id, signer_name, signer_role, registration_no, designation, signed_at, status, revoked_at, LEFT(content_hash, 16) AS seal_short
       FROM report_signatures WHERE result_id = ? ORDER BY id ASC`, [result.id]);
    res.json({
      success: true,
      result: { id: result.id, sample_id: result.sample_id, test_name: result.test_name, status: result.status, report_version: result.report_version, patient_name: result.patient_name, reg_no: result.reg_no,
                machine_no: result.machine_no, reagent_lots: parse(result.reagent_lots) },
      events: events.map((e) => ({ ...e, details: parse(e.details) })),
      versions: versions.map((v) => ({ ...v, results: parse(v.results_json), results_json: undefined })),
      signatures,
    });
  } catch (error) {
    console.error('Error reading result history:', error);
    res.status(500).json({ success: false, message: 'Server error reading history' });
  }
};

// POST /api/lab/results/:id/cancel { reason, password } — withdraws an authorized report.
export const cancelReport = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const actor = req.user;
    if (!actor?.id || actor.isDeviceKey) return res.status(403).json({ success: false, message: 'Sign in as a staff member to cancel a report.' });
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 5) return res.status(400).json({ success: false, message: 'Give the reason for cancelling this report (at least 5 characters).' });

    await connection.beginTransaction();
    const result = await loadResult(connection, req.params.id, req, true);
    if (!result) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Result not found.' }); }
    if (result.status !== 'Approved') { await connection.rollback(); return res.status(409).json({ success: false, message: `Only an authorized report can be cancelled. This one is ${result.status}.` }); }

    const pw = await confirmPassword(connection, actor.id, req.body.password);
    if (!pw.ok) { await connection.rollback(); return res.status(pw.status).json({ success: false, code: 'PASSWORD_REQUIRED', message: req.body.password ? pw.message : 'Enter your password to cancel this report.' }); }

    const a = actorFromReq(req);
    await snapshotVersion(connection, { result, reason, actor: a });
    await connection.query("UPDATE lab_test_result SET status = 'Cancelled', updated_at = NOW() WHERE id = ?", [result.id]);
    await connection.query("UPDATE bill_items SET status = 'Test Done', updated_at = NOW() WHERE sample_id = ? AND status = 'Completed'", [result.sample_id]);
    await logResultAudit(connection, { result_id: result.id, sample_id: result.sample_id, branch_id: result.branch_id, action: 'Report cancelled',
      from_status: 'Approved', to_status: 'Cancelled', actor: a, reason, version: result.report_version, note: 'Signature revoked; report withdrawn from release' });
    await connection.commit();
    res.json({ success: true, message: 'Report cancelled. It is no longer released, and its QR now shows the signature as revoked.' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Error cancelling report:', error);
    res.status(500).json({ success: false, message: 'Server error cancelling report' });
  } finally {
    connection.release();
  }
};

// POST /api/lab/results/:id/reissue { reason } — puts a cancelled report back
// through validation and authorization as the next version.
export const reissueReport = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const actor = req.user;
    if (!actor?.id || actor.isDeviceKey) return res.status(403).json({ success: false, message: 'Sign in as a staff member.' });
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 5) return res.status(400).json({ success: false, message: 'Give the reason for reissuing (at least 5 characters).' });

    await connection.beginTransaction();
    const result = await loadResult(connection, req.params.id, req, true);
    if (!result) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Result not found.' }); }
    if (result.status !== 'Cancelled') { await connection.rollback(); return res.status(409).json({ success: false, message: 'Only a cancelled report can be reissued.' }); }

    await connection.query(
      `UPDATE lab_test_result SET status = 'Test Done', verified_by = NULL, verified_at = NULL, approved_by = NULL, approved_at = NULL,
              report_version = report_version + 1, updated_at = NOW() WHERE id = ?`, [result.id]);
    await logResultAudit(connection, { result_id: result.id, sample_id: result.sample_id, branch_id: result.branch_id, action: 'Reissue started — re-verification required',
      from_status: 'Cancelled', to_status: 'Test Done', actor: actorFromReq(req), reason, version: Number(result.report_version) + 1 });
    await connection.commit();
    res.json({ success: true, message: 'Sent back for validation and authorization as a new version.' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Error reissuing report:', error);
    res.status(500).json({ success: false, message: 'Server error reissuing report' });
  } finally {
    connection.release();
  }
};
