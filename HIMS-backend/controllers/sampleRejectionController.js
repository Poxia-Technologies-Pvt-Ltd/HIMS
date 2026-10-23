import db from '../config/db.js';
import { generateSampleIdForItem } from '../utils/sampleId.js';
import { resolveScannedCode, ensureSample, recordSampleEvent, actorFromReq, sampleVisibleTo } from '../utils/sampleLifecycle.js';

// Sample rejection with reason codes and the recollection workflow.
// Rejecting retires the tube and issues a replacement sample ID for the same
// tests, so the collector desk can recall the patient; the alert stays open
// until the replacement is collected (see advanceSample).

const branchScopeOf = (req) =>
  (req.user?.role_level !== 'Central' ? req.user?.branch_id : (req.query?.branch_id || req.body?.branch_id)) || null;
const actorOf = (req) => actorFromReq(req);

const REJECTABLE = ['Collected', 'Received', 'Processing'];
const OVERDUE_MINUTES = 30;

// GET /api/lab/rejection-reasons
export const listRejectionReasons = async (req, res) => {
  try {
    const [reasons] = await db.query(
      'SELECT code, label, category, note_required FROM sample_rejection_reasons WHERE active = 1 ORDER BY sort_order'
    );
    res.json({ success: true, reasons: reasons.map((r) => ({ ...r, note_required: !!r.note_required })) });
  } catch (error) {
    console.error('Error listing rejection reasons:', error);
    res.status(500).json({ success: false, message: 'Server error listing reasons' });
  }
};

// POST /api/lab/samples/reject { code, reason_code, note? }
export const rejectSample = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const scope = branchScopeOf(req);
    const { code, reason_code } = req.body;
    const note = req.body.note ? String(req.body.note).trim().slice(0, 255) : null;

    const [[reason]] = await connection.query(
      'SELECT code, label, note_required FROM sample_rejection_reasons WHERE code = ? AND active = 1', [reason_code]
    );
    if (!reason) return res.status(400).json({ success: false, message: 'Choose a rejection reason.' });
    if (reason.note_required && !note) return res.status(400).json({ success: false, message: 'Describe the reason for rejection.' });

    const sample_id = await resolveScannedCode(connection, code, scope);
    if (!sample_id) return res.status(404).json({ success: false, message: 'No sample found for that barcode.' });

    await connection.beginTransaction();
    const sample = await ensureSample(connection, sample_id, actorOf(req));
    if (!sample || !sampleVisibleTo(sample, scope)) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'No sample found for that barcode.' });
    }
    const [[locked]] = await connection.query('SELECT * FROM lab_samples WHERE sample_id = ? FOR UPDATE', [sample_id]);

    if (locked.parent_sample_id) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'This is an aliquot — reject the original sample instead.' });
    }
    if (locked.stage === 'Rejected') {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'This sample has already been rejected.' });
    }
    if (!REJECTABLE.includes(locked.stage)) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: locked.stage === 'Accessioned'
          ? 'This sample has not been collected yet, so there is nothing to reject.'
          : `A sample that is ${locked.stage} can no longer be rejected.`,
      });
    }

    const [items] = await connection.query(
      `SELECT bi.id, bi.bill_id, bi.service_name, bi.status, COALESCE(lc.name, '') AS department,
              (SELECT COUNT(*) FROM lab_test_result r WHERE r.bill_item_id = bi.id OR r.sample_id = bi.sample_id) AS has_result
       FROM bill_items bi
       LEFT JOIN lab_tests lt ON lt.id = bi.service_id
       LEFT JOIN lab_categories lc ON lc.id = lt.category_id
       WHERE bi.sample_id = ? ORDER BY bi.id FOR UPDATE`,
      [sample_id]
    );
    if (items.length === 0) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'No tests are linked to this sample.' });
    }
    if (items.some((i) => Number(i.has_result) > 0 || ['Test Done', 'Completed'].includes(i.status))) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'Results already exist for this sample, so it cannot be rejected. Request a rerun instead.' });
    }

    const actor = actorOf(req);
    const replacement = await generateSampleIdForItem(connection, locked.branch_id, items[0].department, actor);

    await connection.query(
      "UPDATE bill_items SET sample_id = ?, short_id = ?, status = 'Pending' WHERE sample_id = ?",
      [replacement.sampleId, replacement.shortId, sample_id]
    );
    await connection.query("UPDATE lab_samples SET stage = 'Rejected' WHERE sample_id = ?", [sample_id]);

    const [[u]] = actor.id
      ? await connection.query("SELECT CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id = ?", [actor.id])
      : [[null]];
    const testNames = items.map((i) => i.service_name).join(', ').slice(0, 500);

    await connection.query(
      `INSERT INTO sample_rejections
         (sample_id, branch_id, bill_id, reason_code, reason_label, note, tests, recollect_sample_id,
          rejected_by, rejected_by_name, rejected_device)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sample_id, locked.branch_id, items[0].bill_id, reason.code, reason.label, note, testNames,
       replacement.sampleId, actor.id, u?.name || null, req.user?.device_label || null]
    );

    await recordSampleEvent(connection, {
      sample_id, branch_id: locked.branch_id, event_type: 'Rejected', from_stage: locked.stage, to_stage: 'Rejected',
      note: `${reason.label}${note ? ` — ${note}` : ''}. Replacement: ${replacement.sampleId}`,
      actor_id: actor.id, actor_role: actor.role, ip: actor.ip, device: actor.device,
    });
    await recordSampleEvent(connection, {
      sample_id: replacement.sampleId, branch_id: locked.branch_id, event_type: 'Recollection', to_stage: 'Accessioned',
      note: `Recollection of ${sample_id} — ${reason.label}`,
      actor_id: actor.id, actor_role: actor.role, ip: actor.ip, device: actor.device,
    });

    await connection.commit();
    res.json({
      success: true,
      message: `Sample rejected. Recollect with new barcode ${replacement.sampleId}.`,
      rejected_sample_id: sample_id,
      new_sample_id: replacement.sampleId,
      new_short_id: replacement.shortId,
      tests: items.map((i) => i.service_name),
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Error rejecting sample:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error rejecting sample' });
  } finally {
    connection.release();
  }
};

// GET /api/lab/rejections?status=pending|all — today's rejections (pending
// ones from any earlier day too, since those are still open alerts).
export const listRejections = async (req, res) => {
  try {
    const scope = branchScopeOf(req);
    const pendingOnly = req.query.status === 'pending';
    let where = pendingOnly
      ? "WHERE r.status = 'Recollection Pending'"
      : "WHERE (r.status = 'Recollection Pending' OR DATE(r.rejected_at) = CURDATE())";
    const params = [];
    if (scope) { where += ' AND r.branch_id = ?'; params.push(scope); }

    const [rows] = await db.query(
      `SELECT r.id, r.sample_id, r.recollect_sample_id, r.bill_id, r.reason_code, r.reason_label, r.note, r.tests,
              r.status, r.rejected_by_name, r.rejected_at, r.recollected_at,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.reg_no,
              b.priority, qt.token_number,
              TIMESTAMPDIFF(MINUTE, r.rejected_at, COALESCE(r.recollected_at, NOW())) AS minutes_open
       FROM sample_rejections r
       JOIN bills b ON b.id = r.bill_id
       JOIN patients p ON p.id = b.patient_id
       LEFT JOIN patient_queue_tokens qt ON qt.bill_id = b.id AND qt.service_point = 'Sample Collection'
       ${where}
       ORDER BY (r.status = 'Recollection Pending') DESC, r.rejected_at DESC`,
      params
    );
    const rejections = rows.map((r) => ({
      ...r,
      minutes_open: Number(r.minutes_open),
      overdue: r.status === 'Recollection Pending' && Number(r.minutes_open) >= OVERDUE_MINUTES,
    }));
    res.json({
      success: true,
      rejections,
      pending: rejections.filter((r) => r.status === 'Recollection Pending').length,
      overdue: rejections.filter((r) => r.overdue).length,
    });
  } catch (error) {
    console.error('Error listing rejections:', error);
    res.status(500).json({ success: false, message: 'Server error listing rejections' });
  }
};
