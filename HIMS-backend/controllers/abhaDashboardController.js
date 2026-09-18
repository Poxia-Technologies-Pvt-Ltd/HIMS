import db from '../config/db.js';

// Results confirmed saved into CARE — and nothing else.
//
// CARE is what forwards a result to ABHA; we never push to ABHA ourselves. So
// the only thing we can honestly report is which results a technician
// confirmed they saved on CARE's form, which the browser extension records
// against bill_items.care_saved_at.
//
// An earlier version of this page also listed patients whose results had NOT
// reached CARE, inferred from our own push tables. That was showing our
// internal push state as if it were ABHA state — two different things — so it
// is gone. A row here means: this result is in CARE, and CARE will carry it
// to the patient's ABHA record.

/**
 * GET /api/care/abha-dashboard
 * Query: branch_id (id or 'all'), search, from, to
 */
export const getAbhaDashboard = async (req, res) => {
  try {
    const { branch_id, search, from, to } = req.query;

    const params = [];
    // care_saved_at IS NOT NULL is the whole filter: no confirmation, no row.
    let where = `WHERE bi.care_saved_at IS NOT NULL`;

    if (branch_id && branch_id !== 'all') {
      where += ` AND b.branch_id = ?`;
      params.push(branch_id);
    }
    if (from) { where += ` AND bi.care_saved_at >= ?`; params.push(`${from} 00:00:00`); }
    if (to)   { where += ` AND bi.care_saved_at <= ?`; params.push(`${to} 23:59:59`); }

    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      where += ` AND (p.reg_no LIKE ? OR p.abha_id LIKE ? OR p.telephone LIKE ?
                      OR CONCAT_WS(' ', p.first_name, p.last_name) LIKE ?
                      OR bi.sample_id LIKE ? OR bi.service_name LIKE ?)`;
      params.push(term, term, term, term, term, term);
    }

    const [rows] = await db.query(`
      SELECT bi.id AS bill_item_id, bi.service_name AS test_name, bi.sample_id,
             bi.care_request_id, bi.care_saved_at, bi.care_saved_by,
             p.id AS patient_id, p.reg_no, p.abha_id, p.telephone,
             CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name,
             b.branch_id, br.branch_name,
             tr.status AS result_status, tr.verified_at
        FROM bill_items bi
        JOIN bills b ON b.id = bi.bill_id
        LEFT JOIN patients p ON p.id = b.patient_id
        LEFT JOIN branches br ON br.id = b.branch_id
        LEFT JOIN lab_test_result tr ON tr.bill_item_id = bi.id
        ${where}
       ORDER BY bi.care_saved_at DESC
       LIMIT 500
    `, params);

    // ABHA presence is reported, never used as a filter. A result saved into
    // CARE for a patient with no ABHA linked still reached CARE — hiding it
    // would misrepresent what was sent.
    const totals = {
      results: rows.length,
      patients: new Set(rows.map((r) => r.patient_id)).size,
      with_abha: rows.filter((r) => r.abha_id).length,
      today: rows.filter((r) => isToday(r.care_saved_at)).length,
    };

    res.json({ success: true, count: rows.length, results: rows, totals });
  } catch (error) {
    console.error('getAbhaDashboard error:', error);
    res.status(500).json({ success: false, message: 'Server error building ABHA dashboard' });
  }
};

function isToday(ts) {
  if (!ts) return false;
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}
