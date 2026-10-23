import db from '../config/db.js';
import { linkSampleToTicket } from './equipmentController.js';
import { resolveScannedCode, ensureSample, recordSampleEvent, actorFromReq, sampleVisibleTo } from '../utils/sampleLifecycle.js';

// Referral of samples between facilities. The barcode never changes — a
// referral only moves custody (lab_samples.holder_branch_id) and records each
// hand-over in the custody log, so the receiving lab scans the very same
// label and results still land on the referring facility's patient record.

const branchScopeOf = (req) =>
  (req.user?.role_level !== 'Central' ? req.user?.branch_id : (req.query?.branch_id || req.body?.branch_id)) || null;

const REFERRABLE = ['Collected', 'Received', 'Stored'];
const fail = (res, status, message) => res.status(status).json({ success: false, message });

// The facility currently holding a sample.
const holderOf = (s) => Number(s.holder_branch_id || s.branch_id);

// GET /api/lab/referral-facilities — where a sample can be sent: the labs of
// this hospital (between labs) and other hospitals with their labs.
export const listReferralFacilities = async (req, res) => {
  try {
    const scope = branchScopeOf(req);
    const [hospitals] = await db.query(
      `SELECT id, branch_name, hospital_code, facility_type
       FROM branches WHERE (status IS NULL OR status = 'Active') AND hospital_code IS NOT NULL ${scope ? 'AND id <> ?' : ''}
       ORDER BY branch_name`,
      scope ? [scope] : []
    );
    const [labs] = await db.query("SELECT id, name, branch_id FROM infrastructure WHERE type = 'Lab' AND branch_id IS NOT NULL ORDER BY name");
    const withLabs = hospitals.map((h) => ({ ...h, labs: labs.filter((l) => l.branch_id === h.id).map(({ id, name }) => ({ id, name })) }));
    const own = scope ? labs.filter((l) => Number(l.branch_id) === Number(scope)).map(({ id, name }) => ({ id, name })) : [];
    res.json({ success: true, facilities: withLabs, own_labs: own });
  } catch (error) {
    console.error('Error listing referral facilities:', error);
    res.status(500).json({ success: false, message: 'Server error listing facilities' });
  }
};

// POST /api/lab/referrals { code, to_branch_id, reason, consignment_ref?, remarks? }
export const createReferral = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const scope = branchScopeOf(req);
    const { code } = req.body;
    const betweenLabs = req.body.transfer_type === 'labs';
    const to_lab_id = req.body.to_lab_id ? Number(req.body.to_lab_id) : null;
    let to_branch_id = req.body.to_branch_id;
    const reason = String(req.body.reason || '').trim().slice(0, 160);
    const consignment_ref = req.body.consignment_ref ? String(req.body.consignment_ref).trim().slice(0, 80) : null;
    const remarks = req.body.remarks ? String(req.body.remarks).trim().slice(0, 255) : null;
    if (!reason) return fail(res, 400, 'Enter the reason for referral.');
    if (betweenLabs) {
      if (!scope) return fail(res, 400, 'Choose the hospital first.');
      if (!to_lab_id) return fail(res, 400, 'Choose the lab to transfer to.');
      to_branch_id = scope;
    } else if (!to_branch_id) return fail(res, 400, 'Choose the hospital to refer to.');

    const [[dest]] = await connection.query(
      "SELECT id, branch_name FROM branches WHERE id = ? AND hospital_code IS NOT NULL AND (status IS NULL OR status = 'Active')", [to_branch_id]
    );
    if (!dest) return fail(res, 400, 'That facility cannot receive referrals.');
    let destLab = null;
    if (to_lab_id) {
      [[destLab]] = await connection.query("SELECT id, name FROM infrastructure WHERE id = ? AND type = 'Lab' AND branch_id = ?", [to_lab_id, to_branch_id]);
      if (!destLab) return fail(res, 400, 'That lab does not belong to the chosen hospital.');
    }

    // Optional: the analyzer breakdown this referral is because of.
    const ticketId = req.body.ticket_id ? Number(req.body.ticket_id) : null;
    const sample_id = await resolveScannedCode(connection, code, scope);
    if (!sample_id) return fail(res, 404, 'No sample found for that barcode.');

    await connection.beginTransaction();
    const actor = actorFromReq(req);
    const found = await ensureSample(connection, sample_id, actor);
    if (!found || !sampleVisibleTo(found, scope)) { await connection.rollback(); return fail(res, 404, 'No sample found for that barcode.'); }
    const [[s]] = await connection.query('SELECT * FROM lab_samples WHERE sample_id = ? FOR UPDATE', [sample_id]);

    // Only the facility that physically holds the tube can send it on.
    const holder = holderOf(s);
    if (scope && holder !== Number(scope)) { await connection.rollback(); return fail(res, 409, 'This sample is not currently held at your facility.'); }
    if (!betweenLabs && holder === Number(to_branch_id)) { await connection.rollback(); return fail(res, 400, 'The sample is already at that hospital — use "Between labs" to move it to another lab.'); }
    if (s.stage === 'In Transit') { await connection.rollback(); return fail(res, 409, 'This sample is already in transit.'); }
    if (!REFERRABLE.includes(s.stage)) {
      await connection.rollback();
      return fail(res, 409, s.stage === 'Accessioned'
        ? 'This sample has not been collected yet.'
        : `A sample that is ${s.stage} cannot be referred. Only Collected, Received or Stored samples can be sent.`);
    }

    const baseId = s.parent_sample_id || sample_id;
    const [items] = await connection.query(
      `SELECT bi.bill_id, bi.service_name, bi.status, bi.lab_id,
              (SELECT COUNT(*) FROM lab_test_result r WHERE r.bill_item_id = bi.id OR r.sample_id = bi.sample_id) AS has_result
       FROM bill_items bi WHERE bi.sample_id = ?`, [baseId]
    );
    if (items.length === 0) { await connection.rollback(); return fail(res, 409, 'No tests are linked to this sample.'); }
    if (items.some((i) => Number(i.has_result) > 0)) { await connection.rollback(); return fail(res, 409, 'Results already exist for this sample.'); }

    const fromLabId = s.holder_lab_id || items[0].lab_id || null;
    if (betweenLabs && Number(fromLabId) === to_lab_id) { await connection.rollback(); return fail(res, 400, 'The sample is already in that lab.'); }
    let fromLab = null;
    if (fromLabId) [[fromLab]] = await connection.query('SELECT name FROM infrastructure WHERE id = ?', [fromLabId]);

    const [[u]] = actor.id ? await connection.query("SELECT CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id = ?", [actor.id]) : [[null]];
    const tests = items.map((i) => i.service_name).join(', ').slice(0, 500);

    await connection.query("UPDATE lab_samples SET stage = 'In Transit', holder_branch_id = ? WHERE sample_id = ?", [to_branch_id, sample_id]);
    const [ins] = await connection.query(
      `INSERT INTO sample_referrals (sample_id, bill_id, transfer_type, from_branch_id, from_lab_id, to_branch_id, to_lab_id, reason, consignment_ref,
                                     dispatch_remarks, prior_stage, prior_holder_branch_id, prior_holder_lab_id, tests, dispatched_by, dispatched_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sample_id, items[0].bill_id, betweenLabs ? 'Between labs' : 'Between hospitals', holder, fromLabId, to_branch_id, destLab?.id || null, reason,
       consignment_ref, remarks, s.stage, s.holder_branch_id, s.holder_lab_id, tests, actor.id, u?.name || null]
    );
    if (ticketId) {
      const [[tk]] = await connection.query("SELECT id, branch_id FROM equipment_tickets WHERE id = ? AND status IN ('Open', 'In Progress', 'Resolved')", [ticketId]);
      if (!tk || (tk.branch_id && Number(tk.branch_id) !== Number(holder))) { await connection.rollback(); return fail(res, 400, 'That breakdown ticket is not open at this hospital.'); }
      await connection.query('UPDATE sample_referrals SET ticket_id = ? WHERE id = ?', [ticketId, ins.insertId]);
      await linkSampleToTicket(connection, { ticketId, sampleId: sample_id, branchId: tk.branch_id, action: 'Referred', referralId: ins.insertId, note: reason, userId: actor.id });
    }
    await recordSampleEvent(connection, {
      sample_id, branch_id: holder, event_type: 'Referred', from_stage: s.stage, to_stage: 'In Transit',
      note: `${betweenLabs ? `Transferred from ${fromLab?.name || 'lab'} to ${destLab.name}` : `Referred to ${dest.branch_name}${destLab ? ` (${destLab.name})` : ''}`} — ${reason}${consignment_ref ? ` (consignment ${consignment_ref})` : ''}`,
      actor_id: actor.id, actor_role: actor.role, ip: actor.ip, device: actor.device,
    });
    await connection.commit();
    res.json({ success: true, message: betweenLabs ? `Sample ${sample_id.slice(-4)} sent to ${destLab.name}.` : `Sample ${sample_id.slice(-4)} dispatched to ${dest.branch_name}.`, referral_id: ins.insertId, sample_id });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Error creating referral:', error);
    res.status(500).json({ success: false, message: 'Server error creating referral' });
  } finally {
    connection.release();
  }
};

// GET /api/lab/referrals?direction=out|in&status=active|all
export const listReferrals = async (req, res) => {
  try {
    const scope = branchScopeOf(req);
    const dir = req.query.direction === 'in' ? 'in' : 'out';
    const col = dir === 'in' ? 'r.to_branch_id' : 'r.from_branch_id';
    let where = `WHERE 1=1`;
    const params = [];
    if (scope) { where += ` AND ${col} = ?`; params.push(scope); }
    if (req.query.status !== 'all') where += " AND (r.status = 'In Transit' OR DATE(r.dispatched_at) = CURDATE() OR DATE(r.received_at) = CURDATE())";

    const [rows] = await db.query(
      `SELECT r.id, r.sample_id, r.transfer_type, r.reason, r.consignment_ref, r.dispatch_remarks, r.tests, r.status,
              r.dispatched_by_name, r.dispatched_at, r.received_by_name, r.received_at, r.receipt_condition,
              fb.branch_name AS from_facility, tb.branch_name AS to_facility, fl.name AS from_lab, tl.name AS to_lab,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.reg_no, b.priority,
              TIMESTAMPDIFF(MINUTE, r.dispatched_at, COALESCE(r.received_at, NOW())) AS minutes
       FROM sample_referrals r
       JOIN branches fb ON fb.id = r.from_branch_id
       JOIN branches tb ON tb.id = r.to_branch_id
       LEFT JOIN infrastructure fl ON fl.id = r.from_lab_id
       LEFT JOIN infrastructure tl ON tl.id = r.to_lab_id
       JOIN bills b ON b.id = r.bill_id
       JOIN patients p ON p.id = b.patient_id
       ${where}
       ORDER BY (r.status = 'In Transit') DESC, r.dispatched_at DESC`,
      params
    );
    res.json({ success: true, referrals: rows.map((r) => ({ ...r, minutes: Number(r.minutes) })), in_transit: rows.filter((r) => r.status === 'In Transit').length });
  } catch (error) {
    console.error('Error listing referrals:', error);
    res.status(500).json({ success: false, message: 'Server error listing referrals' });
  }
};

// POST /api/lab/referrals/receive { code, condition? } — the destination scans
// the label it was handed: same barcode, now Received at this facility.
export const receiveReferral = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const scope = branchScopeOf(req);
    const condition = req.body.condition ? String(req.body.condition).trim().slice(0, 160) : null;
    const sample_id = await resolveScannedCode(connection, req.body.code, scope) || String(req.body.code || '').trim();

    await connection.beginTransaction();
    const [[r]] = await connection.query(
      `SELECT * FROM sample_referrals WHERE sample_id = ? AND status = 'In Transit' ${scope ? 'AND to_branch_id = ?' : ''} ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      scope ? [sample_id, scope] : [sample_id]
    );
    if (!r) { await connection.rollback(); return fail(res, 404, 'No sample in transit to your facility matches that barcode.'); }

    const actor = actorFromReq(req);
    const [[u]] = actor.id ? await connection.query("SELECT CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id = ?", [actor.id]) : [[null]];
    await connection.query(
      "UPDATE sample_referrals SET status = 'Received', received_at = NOW(), received_by = ?, received_by_name = ?, receipt_condition = ? WHERE id = ?",
      [actor.id, u?.name || null, condition, r.id]
    );
    await connection.query("UPDATE lab_samples SET stage = 'Received', received_at = NOW(), holder_branch_id = ?, holder_lab_id = ? WHERE sample_id = ?", [r.to_branch_id, r.to_lab_id, sample_id]);
    const [[from]] = await connection.query('SELECT branch_name FROM branches WHERE id = ?', [r.from_branch_id]);
    const [[toLab]] = r.to_lab_id ? await connection.query('SELECT name FROM infrastructure WHERE id = ?', [r.to_lab_id]) : [[null]];
    await recordSampleEvent(connection, {
      sample_id, branch_id: r.to_branch_id, event_type: 'Referral Received', from_stage: 'In Transit', to_stage: 'Received',
      note: `${r.transfer_type === 'Between labs' ? 'Received in' : 'Received from'} ${r.transfer_type === 'Between labs' ? (toLab?.name || 'lab') : (from?.branch_name || 'referring facility')}${condition ? ` — condition: ${condition}` : ''}`,
      actor_id: actor.id, actor_role: actor.role, ip: actor.ip, device: actor.device,
    });
    await connection.commit();
    res.json({ success: true, message: `Sample ${sample_id.slice(-4)} received.`, sample_id });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Error receiving referral:', error);
    res.status(500).json({ success: false, message: 'Server error receiving referral' });
  } finally {
    connection.release();
  }
};

// POST /api/lab/referrals/:id/cancel — recall a dispatch before it is received.
export const cancelReferral = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const scope = branchScopeOf(req);
    await connection.beginTransaction();
    const [[r]] = await connection.query(
      `SELECT * FROM sample_referrals WHERE id = ? AND status = 'In Transit' ${scope ? 'AND from_branch_id = ?' : ''} FOR UPDATE`,
      scope ? [req.params.id, scope] : [req.params.id]
    );
    if (!r) { await connection.rollback(); return fail(res, 404, 'No dispatched referral found to cancel.'); }
    const actor = actorFromReq(req);
    await connection.query("UPDATE sample_referrals SET status = 'Cancelled', cancelled_at = NOW() WHERE id = ?", [r.id]);
    await connection.query('UPDATE lab_samples SET stage = ?, holder_branch_id = ?, holder_lab_id = ? WHERE sample_id = ?', [r.prior_stage, r.prior_holder_branch_id, r.prior_holder_lab_id, r.sample_id]);
    await recordSampleEvent(connection, {
      sample_id: r.sample_id, branch_id: r.from_branch_id, event_type: 'Referral Cancelled', from_stage: 'In Transit', to_stage: r.prior_stage,
      note: 'Referral recalled before receipt', actor_id: actor.id, actor_role: actor.role, ip: actor.ip, device: actor.device,
    });
    await connection.commit();
    res.json({ success: true, message: 'Referral cancelled — sample is back with your facility.' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Error cancelling referral:', error);
    res.status(500).json({ success: false, message: 'Server error cancelling referral' });
  } finally {
    connection.release();
  }
};
