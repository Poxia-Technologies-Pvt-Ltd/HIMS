import db from '../config/db.js';
import { identifierSearchClause } from '../utils/identifierSearch.js';

// Results that arrived from an analyzer without a matching order.
//
// They are parked against a placeholder patient (reg_no 'ANL-…') and are
// deliberately excluded from the verification queue — getPendingVerifications
// filters out ANL-% — so a doctor is never asked to authorise a result that
// isn't attached to a real patient yet.
//
// Previously such a result was simply dropped by the agent, which is the worst
// option: the analyzer has consumed the sample, the run happened, and nobody
// finds out it went nowhere. Keeping it and letting the technician attach it
// afterwards means no run is ever silently lost.

const UNMAPPED_WHERE = `(p.reg_no LIKE 'ANL-%' OR tr.sample_id LIKE 'UNMAPPED-%')`;

/** GET /api/lab/unmapped-results — everything awaiting a technician. */
export const getUnmappedResults = async (req, res) => {
  try {
    const { branch_id } = req.query;
    const params = [];
    let sql = `
      SELECT tr.id AS result_id, tr.sample_id, tr.test_name, tr.machine_no,
             tr.tested_at, tr.results_json, tr.status,
             bi.id AS bill_item_id, b.branch_id,
             CONCAT(p.first_name, ' ', COALESCE(p.last_name, '')) AS placeholder_name
        FROM lab_test_result tr
        LEFT JOIN bill_items bi ON bi.sample_id = tr.sample_id
        LEFT JOIN bills b ON b.id = bi.bill_id
        LEFT JOIN patients p ON p.id = tr.patient_id
       WHERE ${UNMAPPED_WHERE}
         AND tr.status <> 'Approved'`;

    // Branch scoping: an unmapped result belongs to whoever ran it. Fall back
    // to showing it when the branch is unknown rather than hiding it — an
    // orphaned result nobody can see is how runs get lost.
    if (branch_id && branch_id !== 'all') {
      sql += ` AND (b.branch_id = ? OR b.branch_id IS NULL)`;
      params.push(branch_id);
    }
    sql += ` ORDER BY tr.tested_at DESC LIMIT 200`;

    const [rows] = await db.query(sql, params);
    const results = rows.map((r) => {
      let parsed = [];
      try {
        parsed = typeof r.results_json === 'string' ? JSON.parse(r.results_json) : (r.results_json || []);
      } catch { parsed = []; }
      return { ...r, results: parsed, parameter_count: parsed.length };
    });

    res.json({ success: true, count: results.length, results });
  } catch (error) {
    console.error('getUnmappedResults error:', error);
    res.status(500).json({ success: false, message: 'Server error listing unmapped results' });
  }
};

/**
 * GET /api/lab/open-tests?search=…
 * The candidate list for the picker: every test currently awaiting a result
 * for whoever matches the search term. A CARE patient typically has three or
 * four ordered at once, which is exactly the choice the technician has to
 * make — the analyzer only tells us a sample number, not which order it was.
 */
export const getOpenTestsForPatient = async (req, res) => {
  try {
    const { search, branch_id } = req.query;
    if (!search || !String(search).trim()) {
      return res.status(400).json({ success: false, message: 'search is required' });
    }

    const params = [];
    let sql = `
      SELECT bi.id AS bill_item_id, bi.sample_id, bi.service_name AS test_name,
             bi.status, b.id AS bill_id, b.bill_number, b.branch_id,
             p.id AS patient_id, p.reg_no,
             CONCAT(p.first_name, ' ', COALESCE(p.last_name, '')) AS patient_name,
             p.telephone, p.abha_id,
             bi.care_patient_external_id,
             (SELECT COUNT(*) FROM lab_test_result r WHERE r.sample_id = bi.sample_id) AS has_result
        FROM bill_items bi
        JOIN bills b ON b.id = bi.bill_id
        JOIN patients p ON p.id = b.patient_id
       WHERE bi.service_type = 'Laboratory'
         AND bi.status IN ('Pending', 'Collected', 'In Progress')
         AND p.reg_no NOT LIKE 'ANL-%'`;

    if (branch_id && branch_id !== 'all') {
      sql += ` AND b.branch_id = ?`;
      params.push(branch_id);
    }

    // Same one-box lookup as the worklist: UHID, ABHA, phone, CARE id, our
    // reg_no or sample id, or a name.
    const { clause, params: searchParams } = identifierSearchClause(search, {
      patients: 'p', billItems: 'bi', sampleId: 'bi.sample_id', testName: 'bi.service_name',
    });
    sql += clause;
    params.push(...searchParams);

    sql += ` ORDER BY p.id, bi.id LIMIT 50`;

    const [rows] = await db.query(sql, params);
    res.json({ success: true, count: rows.length, tests: rows });
  } catch (error) {
    console.error('getOpenTestsForPatient error:', error);
    res.status(500).json({ success: false, message: 'Server error finding open tests' });
  }
};

/**
 * POST /api/lab/attach-result  { result_id, bill_item_id }
 * Moves an orphaned analyzer result onto the test the technician picked.
 * Once attached it belongs to a real patient, so it leaves the unmapped list
 * and appears in the doctor's verification queue — which is the point: nothing
 * reaches a doctor until a human has confirmed whose sample it was.
 */
export const attachResultToTest = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { result_id, bill_item_id } = req.body || {};
    if (!result_id || !bill_item_id) {
      return res.status(400).json({ success: false, message: 'result_id and bill_item_id are required' });
    }

    await conn.beginTransaction();

    const [[result]] = await conn.query(
      'SELECT id, sample_id, results_json, machine_no FROM lab_test_result WHERE id = ? LIMIT 1',
      [result_id]
    );
    if (!result) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Result not found' });
    }

    const [[target]] = await conn.query(
      `SELECT bi.id, bi.sample_id, bi.service_id, bi.service_name, b.patient_id, b.branch_id
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
        WHERE bi.id = ? LIMIT 1`,
      [bill_item_id]
    );
    if (!target) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Target test not found' });
    }

    // Refuse to overwrite a result the target already has — that would destroy
    // a completed test to salvage an orphan, which is never the right trade.
    const [[clash]] = await conn.query(
      'SELECT id FROM lab_test_result WHERE sample_id = ? AND id <> ? LIMIT 1',
      [target.sample_id, result_id]
    );
    if (clash) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: 'That test already has a result. Pick a different test, or have the existing result reviewed first.',
      });
    }

    // Re-point the result at the chosen test, its patient and its branch.
    await conn.query(
      `UPDATE lab_test_result
          SET sample_id = ?, bill_item_id = ?, patient_id = ?, branch_id = ?,
              test_id = ?, test_name = ?, status = 'Test Done', updated_at = NOW()
        WHERE id = ?`,
      [target.sample_id, target.id, target.patient_id, target.branch_id,
       target.service_id, target.service_name, result_id]
    );

    await conn.query(
      `UPDATE bill_items SET status = 'Test Done', updated_at = NOW() WHERE id = ?`,
      [target.id]
    );

    await conn.commit();
    res.json({
      success: true,
      message: `Result attached to ${target.service_name}. It is now with the doctor for verification.`,
      sample_id: target.sample_id,
      test_name: target.service_name,
    });
  } catch (error) {
    await conn.rollback();
    console.error('attachResultToTest error:', error);
    res.status(500).json({ success: false, message: 'Server error attaching result' });
  } finally {
    conn.release();
  }
};
