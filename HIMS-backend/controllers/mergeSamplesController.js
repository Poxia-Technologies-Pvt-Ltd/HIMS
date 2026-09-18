import db from '../config/db.js';

// Merging several of a patient's tests onto one sample.
//
// One tube of serum can run LFT and KFT together on a biochemistry analyzer,
// so making the technician draw, label and load a separate sample for each is
// wasted blood and wasted work. Merging gives the group a single sample ID and
// short code — one tube, one barcode, one load.
//
// This reverses, deliberately and only where a human asks for it, the
// one-ID-per-test rule the CARE importer follows. That rule exists because an
// analyzer result is matched on sample ID, so a shared ID means a result lands
// on the whole group at once. For a genuinely shared tube that is correct: the
// analyzer ran one sample and reported everything it measured, and the group
// gets one result and one report listing the merged tests.
//
// It is refused once any member has a result. At that point the tests have
// diverged and re-pointing their IDs would orphan or duplicate real values.

/** GET /api/lab/mergeable?patient_id=…&branch_id=… — a patient's open tests. */
export const getMergeableTests = async (req, res) => {
  try {
    const { patient_id, sample_id, branch_id } = req.query;
    if (!patient_id && !sample_id) {
      return res.status(400).json({ success: false, message: 'patient_id or sample_id is required' });
    }

    const params = [];
    let where = `WHERE bi.service_type = 'Laboratory'
                   AND bi.status IN ('Pending', 'Collected', 'In Progress')`;

    if (patient_id) { where += ' AND b.patient_id = ?'; params.push(patient_id); }
    // Lets the agent start from a row the technician clicked rather than
    // making them find the patient again.
    if (sample_id) { where += ' AND b.patient_id = (SELECT b2.patient_id FROM bill_items bi2 JOIN bills b2 ON b2.id = bi2.bill_id WHERE bi2.sample_id = ? LIMIT 1)'; params.push(sample_id); }
    if (branch_id && branch_id !== 'all') { where += ' AND b.branch_id = ?'; params.push(branch_id); }

    const [rows] = await db.query(`
      SELECT bi.id AS bill_item_id, bi.service_name AS test_name, bi.sample_id, bi.short_id,
             bi.status, bi.merged_at,
             b.patient_id, p.reg_no,
             CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name,
             (SELECT COUNT(*) FROM lab_test_result r WHERE r.bill_item_id = bi.id) AS has_result
        FROM bill_items bi
        JOIN bills b ON b.id = bi.bill_id
        JOIN patients p ON p.id = b.patient_id
        ${where}
       ORDER BY bi.id`, params);

    res.json({ success: true, count: rows.length, tests: rows });
  } catch (error) {
    console.error('getMergeableTests error:', error);
    res.status(500).json({ success: false, message: 'Server error listing tests' });
  }
};

/** POST /api/lab/merge-samples  { bill_item_ids: [...] } */
export const mergeSamples = async (req, res) => {
  const ids = Array.isArray(req.body?.bill_item_ids)
    ? req.body.bill_item_ids.map(Number).filter(Boolean)
    : [];

  if (ids.length < 2) {
    return res.status(400).json({ success: false, message: 'Pick at least two tests to merge' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [items] = await conn.query(`
      SELECT bi.id, bi.service_name, bi.sample_id, bi.short_id, bi.status,
             b.patient_id, b.branch_id,
             (SELECT COUNT(*) FROM lab_test_result r
               WHERE r.bill_item_id = bi.id OR r.sample_id = bi.sample_id) AS has_result
        FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
       WHERE bi.id IN (?) FOR UPDATE`, [ids]);

    if (items.length !== ids.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Some selected tests no longer exist' });
    }

    // One patient only. Merging across patients would put two people's blood
    // under one barcode — the single worst outcome available here.
    const patients = new Set(items.map((i) => i.patient_id));
    if (patients.size > 1) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: 'Those tests belong to different patients and cannot share a sample.',
      });
    }

    const withResults = items.filter((i) => Number(i.has_result) > 0);
    if (withResults.length) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: `Already has a result: ${withResults.map((i) => i.service_name).join(', ')}. `
               + 'Merge before the sample is run, not after.',
      });
    }

    // The lowest-numbered item keeps its identifiers and the rest adopt them,
    // so the barcode already printed for it stays valid.
    const anchor = items.reduce((a, b) => (a.id <= b.id ? a : b));
    const targets = items.filter((i) => i.id !== anchor.id);

    await conn.query(
      `UPDATE bill_items SET sample_id = ?, short_id = ?, merged_at = NOW()
        WHERE id IN (?)`,
      [anchor.sample_id, anchor.short_id, items.map((i) => i.id)]
    );

    await conn.commit();

    res.json({
      success: true,
      sample_id: anchor.sample_id,
      short_id: anchor.short_id,
      merged: items.map((i) => i.service_name),
      count: items.length,
      message: `${items.length} tests now share sample ${anchor.sample_id}: ${items.map((i) => i.service_name).join(' & ')}`,
      // Named so the UI can tell the technician which labels to discard.
      released_sample_ids: targets.map((t) => t.sample_id).filter((s) => s && s !== anchor.sample_id),
    });
  } catch (error) {
    await conn.rollback();
    console.error('mergeSamples error:', error);
    res.status(500).json({ success: false, message: 'Server error merging samples' });
  } finally {
    conn.release();
  }
};

/** POST /api/lab/unmerge-sample  { bill_item_id } — undo for one test. */
export const unmergeSample = async (req, res) => {
  const billItemId = Number(req.body?.bill_item_id);
  if (!billItemId) {
    return res.status(400).json({ success: false, message: 'bill_item_id is required' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[item]] = await conn.query(`
      SELECT bi.id, bi.service_name, bi.sample_id, bi.short_id, b.branch_id,
             (SELECT COUNT(*) FROM lab_test_result r WHERE r.sample_id = bi.sample_id) AS has_result
        FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
       WHERE bi.id = ? FOR UPDATE`, [billItemId]);

    if (!item) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Test not found' });
    }
    if (Number(item.has_result) > 0) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: 'That sample already has a result — splitting it now would orphan the values.',
      });
    }

    // A fresh ID from the same per-branch/day sequence the rest of the system
    // uses, so an unmerged test can never collide with a live one.
    const DEPT_KEY = '5000';
    await conn.query(
      `INSERT INTO lab_sample_sequences (branch_id, seq_date, dept_key, last_seq)
       VALUES (?, CURDATE(), ?, ?) ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
      [item.branch_id, DEPT_KEY, Number(DEPT_KEY)]
    );
    const [[seq]] = await conn.query(
      `SELECT last_seq FROM lab_sample_sequences
        WHERE branch_id = ? AND seq_date = CURDATE() AND dept_key = ?`,
      [item.branch_id, DEPT_KEY]
    );
    const [[branch]] = await conn.query('SELECT hospital_code FROM branches WHERE id = ?', [item.branch_id]);

    const shortId = String(seq.last_seq).padStart(4, '0');
    const sampleId = `LAB-${(branch?.hospital_code || 'LAB').replace(/\s+/g, '')}-`
                   + `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${shortId}`;

    await conn.query(
      'UPDATE bill_items SET sample_id = ?, short_id = ?, merged_at = NULL WHERE id = ?',
      [sampleId, shortId, item.id]
    );

    await conn.commit();
    res.json({
      success: true,
      sample_id: sampleId,
      short_id: shortId,
      message: `${item.service_name} split off as ${sampleId} — print a new label.`,
    });
  } catch (error) {
    await conn.rollback();
    console.error('unmergeSample error:', error);
    res.status(500).json({ success: false, message: 'Server error splitting sample' });
  } finally {
    conn.release();
  }
};
