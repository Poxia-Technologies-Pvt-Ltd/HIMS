import crypto from 'crypto';
import db from '../config/db.js';
import { extractPrescriptionData } from '../utils/ollamaVision.js';
import { generateSampleIdForItem } from '../utils/sampleId.js';

const REQUIRED_FIELDS = ['first_name', 'last_name', 'gender', 'phone', 'patient_type'];
// How long a completed analysis stays usable for the confirm step — keeps a
// stale/replayed upload_id from being billed long after the patient walked
// away (and bounds how long the extraction sits unbilled in patient_uploads).
const ANALYSIS_TTL_MS = 30 * 60 * 1000;

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

function mergedField(extracted, submitted, key) {
  const s = submitted?.[key];
  if (s !== undefined && s !== null && String(s).trim() !== '') return s;
  return extracted?.[key] ?? null;
}

// Step 1: patient (or the page, unattended) uploads the photo. Runs OCR/
// vision extraction against the real active test catalog and hands back
// what was found — the frontend pre-fills whatever came back and only asks
// the patient to fill in what didn't. Nothing is billed yet.
export const analyzeUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image uploaded' });
    }
    // Public upload has no logged-in staff session to carry a branch_id, and
    // hard-coding 1 doesn't hold across deployments (this one's only branch
    // is id 28) — fall back to whichever branch actually exists.
    let branch_id = req.body.branch_id;
    if (!branch_id) {
      const [[defaultBranch]] = await db.query('SELECT id FROM branches ORDER BY id LIMIT 1');
      branch_id = defaultBranch?.id || null;
    }
    const imageBuffer = req.file.buffer;
    const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

    // Same exact photo already led to a real bill — don't run it through the
    // model again and don't let a duplicate submit (double-tap, page
    // refresh) produce a second bill for it.
    const [[dupe]] = await db.query(
      `SELECT id, bill_id FROM patient_uploads
       WHERE image_hash = ? AND status = 'AutoBilled'
       ORDER BY created_at DESC LIMIT 1`,
      [imageHash]
    );
    if (dupe) {
      return res.status(409).json({
        success: false,
        message: 'This photo has already been billed.',
        already_billed: true,
        bill_id: dupe.bill_id,
      });
    }

    const [catalog] = await db.query(
      `SELECT id, test_code, test_name, price FROM lab_tests WHERE status = 'Active'`
    );

    let extracted;
    try {
      extracted = await extractPrescriptionData(
        imageBuffer.toString('base64'),
        catalog.map((t) => ({ test_code: t.test_code, test_name: t.test_name }))
      );
    } catch (err) {
      console.error('[PublicUpload] Ollama extraction failed:', err.message);
      return res.status(200).json({
        success: true,
        requires_manual_counter: true,
        reason: 'We could not read this image automatically. Please complete billing at the counter.',
      });
    }

    // Never trust the model's codes blindly — only keep ones that are
    // actually in the live active catalog.
    const catalogByCode = new Map(catalog.map((t) => [t.test_code, t]));
    const claimedCodes = Array.isArray(extracted.matched_test_codes) ? extracted.matched_test_codes : [];
    const matchedTests = claimedCodes
      .map((code) => catalogByCode.get(code))
      .filter(Boolean)
      .map((t) => ({ id: t.id, test_code: t.test_code, test_name: t.test_name, price: t.price }));

    const unmatchedLines = Array.isArray(extracted.unmatched_lines) ? extracted.unmatched_lines : [];

    // Any test the model couldn't confidently match, or nothing detected at
    // all — per policy this whole upload falls back to the manual counter
    // rather than have the patient/system guess at what to bill.
    const requiresManualCounter = matchedTests.length === 0 || unmatchedLines.length > 0;

    const missingFields = REQUIRED_FIELDS.filter((f) => {
      const v = extracted[f === 'first_name' ? 'first_name' : f === 'last_name' ? 'last_name' : f];
      return v === undefined || v === null || String(v).trim() === '';
    });

    const [result] = await db.query(
      `INSERT INTO patient_uploads
        (image_hash, extracted_json, matched_test_ids, unmatched_lines, status, branch_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        imageHash,
        JSON.stringify(extracted),
        JSON.stringify(matchedTests.map((t) => t.id)),
        JSON.stringify(unmatchedLines),
        requiresManualCounter ? 'ManualRequired' : 'Analyzed',
        branch_id,
      ]
    );

    res.json({
      success: true,
      upload_id: result.insertId,
      requires_manual_counter: requiresManualCounter,
      reason: requiresManualCounter
        ? 'Some items on this photo could not be identified with confidence — please complete billing at the counter.'
        : null,
      extracted: {
        title: extracted.title || null,
        first_name: extracted.first_name || null,
        middle_name: extracted.middle_name || null,
        last_name: extracted.last_name || null,
        dob: extracted.dob || null,
        age_years: extracted.age_years ?? null,
        age_months: extracted.age_months ?? null,
        age_days: extracted.age_days ?? null,
        gender: extracted.gender || null,
        phone: extracted.phone || null,
        patient_type: extracted.patient_type || null,
        consultant_name: extracted.consultant_name || null,
        source_facility: extracted.source_facility || null,
      },
      missing_fields: missingFields,
      matched_tests: matchedTests,
      unmatched_lines: unmatchedLines,
    });
  } catch (error) {
    console.error('[PublicUpload] analyzeUpload error:', error);
    res.status(500).json({ success: false, message: 'Server error analyzing upload' });
  }
};

// Step 2: patient has filled in whatever the extraction didn't find, and
// confirms. The test list is never taken from the request body — it's
// re-read from the patient_uploads row this upload_id points at, so nothing
// the client sends can add a test that wasn't actually detected in the image.
export const submitUpload = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { upload_id, fields = {} } = req.body;
    if (!upload_id) {
      return res.status(400).json({ success: false, message: 'upload_id is required' });
    }

    const [[upload]] = await connection.query(`SELECT * FROM patient_uploads WHERE id = ?`, [upload_id]);
    if (!upload) {
      return res.status(404).json({ success: false, message: 'Upload not found' });
    }
    if (upload.status === 'AutoBilled') {
      return res.status(409).json({ success: false, message: 'This upload has already been billed.', bill_id: upload.bill_id });
    }
    if (upload.status === 'ManualRequired') {
      return res.status(400).json({ success: false, message: 'This upload requires manual billing at the counter.' });
    }
    if (Date.now() - new Date(upload.created_at).getTime() > ANALYSIS_TTL_MS) {
      return res.status(410).json({ success: false, message: 'This upload has expired — please upload the photo again.' });
    }

    // mysql2 auto-parses JSON columns into objects/arrays already — only
    // fall back to JSON.parse if a driver/version ever hands back the raw
    // string instead.
    const asJson = (v, fallback) => (typeof v === 'string' ? JSON.parse(v || JSON.stringify(fallback)) : (v ?? fallback));
    const extracted = asJson(upload.extracted_json, {});
    const matchedTestIds = asJson(upload.matched_test_ids, []);
    if (matchedTestIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No tests were detected on this upload.' });
    }

    const patientData = {
      title: mergedField(extracted, fields, 'title'),
      first_name: mergedField(extracted, fields, 'first_name'),
      middle_name: mergedField(extracted, fields, 'middle_name'),
      last_name: mergedField(extracted, fields, 'last_name'),
      dob: mergedField(extracted, fields, 'dob'),
      gender: mergedField(extracted, fields, 'gender'),
      phone: normalizePhone(mergedField(extracted, fields, 'phone')),
      patient_type: mergedField(extracted, fields, 'patient_type') || 'OP',
      consultant_name: mergedField(extracted, fields, 'consultant_name'),
    };

    for (const f of ['first_name', 'last_name', 'gender', 'phone', 'patient_type']) {
      if (!patientData[f]) {
        return res.status(400).json({ success: false, message: `Missing required field: ${f}` });
      }
    }
    if (patientData.phone.length !== 10) {
      return res.status(400).json({ success: false, message: 'A valid 10-digit phone number is required.' });
    }

    await connection.beginTransaction();

    // Find-or-create patient — dedupe on phone + name so the same person
    // uploading twice (or later walking into the counter) doesn't get a
    // second patient record.
    const [[existingPatient]] = await connection.query(
      `SELECT id FROM patients
       WHERE telephone = ? AND LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
       LIMIT 1`,
      [patientData.phone, patientData.first_name, patientData.last_name]
    );

    let patientId = existingPatient?.id;
    if (!patientId) {
      let regNo, insertResult;
      for (let attempt = 0; attempt < 5 && !insertResult; attempt++) {
        regNo = 'REG-' + Math.floor(10000 + Math.random() * 90000);
        try {
          [insertResult] = await connection.query(
            `INSERT INTO patients
              (reg_no, reg_date, patient_type, consultant_name, title, first_name, middle_name,
               last_name, dob, gender, telephone, branch_id)
             VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              regNo, patientData.patient_type, patientData.consultant_name || null,
              patientData.title || null, patientData.first_name, patientData.middle_name || null,
              patientData.last_name, patientData.dob || null, patientData.gender,
              patientData.phone, upload.branch_id || 1,
            ]
          );
        } catch (err) {
          if (err.code !== 'ER_DUP_ENTRY') throw err;
        }
      }
      if (!insertResult) throw new Error('Could not allocate a registration number');
      patientId = insertResult.insertId;
    }

    // Same dedupe rule createBill uses: skip any matched test that's still
    // Pending (uncollected) for this patient rather than billing it twice.
    const [pendingRows] = await connection.query(
      `SELECT bi.service_id FROM bill_items bi
       JOIN bills b ON bi.bill_id = b.id
       WHERE b.patient_id = ? AND bi.service_type = 'Laboratory'
         AND bi.service_id IN (?) AND bi.status = 'Pending'`,
      [patientId, matchedTestIds]
    );
    const alreadyPending = new Set(pendingRows.map((r) => r.service_id));
    const testIdsToBill = matchedTestIds.filter((id) => !alreadyPending.has(id));

    if (testIdsToBill.length === 0) {
      await connection.commit();
      return res.status(200).json({
        success: true,
        message: 'All detected tests are already billed and pending collection for this patient — nothing new to bill.',
        patient_id: patientId,
        bill_id: null,
      });
    }

    const [testRows] = await connection.query(
      `SELECT lt.id, lt.test_code, lt.test_name, lt.price, lc.name AS department
       FROM lab_tests lt LEFT JOIN lab_categories lc ON lt.category_id = lc.id
       WHERE lt.id IN (?)`,
      [testIdsToBill]
    );

    const total_amount = testRows.reduce((sum, t) => sum + Number(t.price || 0), 0);
    const bill_number = 'UPLOAD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const patientFullName = `${patientData.first_name} ${patientData.last_name}`;
    const sourceFacility = extracted.source_facility ? String(extracted.source_facility).trim() : null;
    const billNotes = sourceFacility
      ? `Auto-billed from patient-uploaded prescription/bill photo. Source facility on document: ${sourceFacility}`
      : 'Auto-billed from patient-uploaded prescription/bill photo';

    const [billResult] = await connection.query(
      `INSERT INTO bills (bill_number, patient_id, patient_name, patient_phone, total_amount,
        net_amount, payment_status, status, notes, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, 'Pending', 'Active', ?, ?)`,
      [bill_number, patientId, patientFullName, patientData.phone, total_amount, total_amount,
        billNotes, upload.branch_id || 1]
    );
    const bill_id = billResult.insertId;

    const lab_samples = [];
    for (const t of testRows) {
      const [itemResult] = await connection.query(
        `INSERT INTO bill_items (bill_id, service_type, service_id, service_name, service_code, quantity, unit_price, total_price)
         VALUES (?, 'Laboratory', ?, ?, ?, 1, ?, ?)`,
        [bill_id, t.id, t.test_name, t.test_code, t.price || 0, t.price || 0]
      );
      const { sampleId, shortId } = await generateSampleIdForItem(connection, upload.branch_id || 1, t.department);
      await connection.query(
        `UPDATE bill_items SET sample_id = ?, short_id = ?, status = 'Collected', updated_at = NOW() WHERE id = ?`,
        [sampleId, shortId, itemResult.insertId]
      );
      lab_samples.push({ sample_id: sampleId, short_id: shortId, test_name: t.test_name });
    }

    await connection.query(
      `UPDATE patient_uploads SET status = 'AutoBilled', patient_id = ?, bill_id = ? WHERE id = ?`,
      [patientId, bill_id, upload_id]
    );

    await connection.commit();
    res.status(201).json({
      success: true,
      message: 'Bill created successfully from uploaded photo.',
      patient_id: patientId,
      bill_id,
      bill_number,
      total_amount,
      lab_samples,
      skipped_already_pending: matchedTestIds.length - testIdsToBill.length,
    });
  } catch (error) {
    await connection.rollback();
    console.error('[PublicUpload] submitUpload error:', error);
    res.status(500).json({ success: false, message: 'Server error submitting upload' });
  } finally {
    connection.release();
  }
};
