import db from '../config/db.js';
import { generateSampleIdForItem } from '../utils/sampleId.js';
import { recordMerge, actorFromReq } from '../utils/sampleLifecycle.js';

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

// "Whole Blood / Serum" -> {blood, serum}; "Serum / Plasma" -> {serum, plasma}.
// Anticoagulant/handling words are dropped so "EDTA Blood" and "Blood" match.
const specimenTokens = (type) => new Set(
  String(type || '').toLowerCase()
    .split(/[\/,;]|\bor\b/)
    .map((t) => t.replace(/\b(whole|edta|citrate|heparin|fluoride|random|first|morning|sample|specimen)\b/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
);

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
             b.patient_id, b.branch_id, lt.sample_type,
             (SELECT COUNT(*) FROM lab_test_result r
               WHERE r.bill_item_id = bi.id OR r.sample_id = bi.sample_id) AS has_result
        FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
        LEFT JOIN lab_tests lt ON lt.id = bi.service_id
       WHERE bi.id IN (?) FOR UPDATE`, [ids]);

    // Staff outside Central can only touch their own facility's samples.
    const scopeBranch = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    if (scopeBranch && items.some((i) => Number(i.branch_id) !== Number(scopeBranch))) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Some selected tests no longer exist' });
    }

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

    // One container holds one kind of specimen: serum and whole blood (or
    // urine…) can't share a tube. The test master writes specimen types
    // loosely ("Serum", "Serum / Plasma", "Whole Blood / Serum"), so this is a
    // compatibility check, not string equality — the tests must share at
    // least one specimen type they can all be run on.
    const typed = items.filter((i) => (i.sample_type || '').trim());
    if (typed.length > 1) {
      const common = typed.map((i) => specimenTokens(i.sample_type)).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
      if (common.size === 0) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: `These tests need different specimen types (${[...new Set(typed.map((i) => i.sample_type))].join(' vs ')}) and cannot share one container.`,
        });
      }
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

    await recordMerge(conn, {
      anchor_sample_id: anchor.sample_id,
      released_sample_ids: targets.map((t) => t.sample_id),
      test_names: items.map((i) => i.service_name),
      actor: actorFromReq(req),
    });

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

    const scopeBranch = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    if (!item || (scopeBranch && Number(item.branch_id) !== Number(scopeBranch))) {
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

    // A fresh ID from the shared generator (same counter, date handling and
    // cross-facility uniqueness registry as everywhere else), so an unmerged
    // test can never collide with a live one. 'Pathology' = the 5000 range
    // this path has always used.
    const { sampleId, shortId } = await generateSampleIdForItem(conn, item.branch_id, 'Pathology', {
      ...actorFromReq(req),
    });

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
