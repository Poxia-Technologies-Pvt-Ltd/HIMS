import db from '../config/db.js';
import { generateSampleIdForItem } from '../utils/sampleId.js';

// Imports lab orders scraped from CARE HMIS by the browser extension.
//
// This exists because CARE's own API is unreliable, so the orders are read
// from their web UI instead. Everything here is deliberately idempotent: the
// operator will re-scrape the same ward repeatedly during a shift, and a
// double-billed patient is a real financial error, not a cosmetic one.
//
// Deliberately does NOT map CARE test names onto the existing catalogue.
// Fuzzy matching scored 0.90 for "CRP" against "CRP/High Sensivity" — a
// different and more expensive test — and 0.20 for "Blood Group & Rh" against
// "Complete Blood Cholestrol". Auto-applying those would bill patients for
// tests they never had. Instead each distinct CARE test name gets its own
// catalogue row, so the technician sees exactly the name CARE sent.

const CARE_TEST_PREFIX = 'CARE';

/** "Malaria Parasite Test (MP)" -> "CARE-MALARIA-PARASITE-TEST-MP" */
const testCodeFor = (name) =>
  `${CARE_TEST_PREFIX}-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 50);

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  if (!parts.length || !parts[0]) return { first_name: 'Unknown', last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

/** "38y, Female" -> { gender: 'Female', dob: <approx> } */
function parseAgeSex(ageSex) {
  const s = String(ageSex || '');
  const genderMatch = s.match(/\b(male|female|other)\b/i);
  const gender = genderMatch
    ? genderMatch[1][0].toUpperCase() + genderMatch[1].slice(1).toLowerCase()
    : null;
  const yearsMatch = s.match(/(\d+)\s*y/i);
  let dob = null;
  if (yearsMatch) {
    // CARE exposes age, not date of birth. Storing an approximate DOB keeps
    // age calculations working downstream; the day/month are not real and must
    // not be presented as if they were.
    const d = new Date();
    d.setFullYear(d.getFullYear() - Number(yearsMatch[1]));
    dob = d.toISOString().slice(0, 10);
  }
  return { gender, dob };
}

/** Find-or-create the catalogue row for a CARE test name. */
async function ensureLabTest(conn, testName, created) {
  const name = String(testName || '').trim();
  if (!name) return null;

  // Match on the CARE-derived code, not the display name: two CARE names that
  // differ only by spacing must not create two rows.
  const code = testCodeFor(name);
  const [[existingByCode]] = await conn.query(
    'SELECT id FROM lab_tests WHERE test_code = ? LIMIT 1', [code]);
  if (existingByCode) return existingByCode.id;

  // An exact name match is reused too — if the catalogue already contains this
  // precise name, creating a near-duplicate helps nobody.
  const [[existingByName]] = await conn.query(
    'SELECT id FROM lab_tests WHERE test_name = ? LIMIT 1', [name]);
  if (existingByName) return existingByName.id;

  // category_id and sample_type are NOT NULL with no default. CARE's list view
  // exposes neither, so both get a neutral placeholder that is obviously
  // provisional rather than a guess that looks authoritative — a wrong
  // sample_type would send a technician to draw the wrong tube.
  const [[fallbackCategory]] = await conn.query(
    "SELECT id FROM lab_categories WHERE name = 'Clinical Pathology' LIMIT 1");
  const categoryId = fallbackCategory?.id
    || (await conn.query('SELECT id FROM lab_categories ORDER BY id LIMIT 1'))[0][0]?.id;

  const [res] = await conn.query(
    `INSERT INTO lab_tests (test_code, test_name, category_id, sample_type, price, status)
     VALUES (?, ?, ?, 'To be confirmed', 0, 'Active')`,
    [code, name, categoryId]
  );
  created.tests.push({ id: res.insertId, test_name: name, test_code: code });
  return res.insertId;
}

/** Find-or-create the patient behind a CARE order. */
async function ensurePatient(conn, p, branchId, created) {
  // UHID is CARE's stable hospital identifier and the best key when present;
  // the scrape UUID is the fallback, since demographics may not have been
  // captured for that patient yet.
  const regNo = p.uhid ? `CARE-${p.uhid}` : `CARE-${p.care_patient_id}`;

  const [[existing]] = await conn.query(
    'SELECT id FROM patients WHERE reg_no = ? LIMIT 1', [regNo]);
  if (existing) return { id: existing.id, reg_no: regNo, isNew: false };

  const { first_name, last_name } = splitName(p.patient_name);
  const { gender, dob } = parseAgeSex(p.age_sex);

  const [res] = await conn.query(
    `INSERT INTO patients
       (reg_no, reg_date, first_name, last_name, telephone, gender, dob,
        abha_id, address, branch_id)
     VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?)`,
    [regNo, first_name, last_name, p.phone || null, gender, dob,
     p.abha_number || null, p.address || null, branchId]
  );
  created.patients.push({ id: res.insertId, reg_no: regNo, name: p.patient_name });
  return { id: res.insertId, reg_no: regNo, isNew: true };
}

// Results the extension may type into CARE. Deliberately only the two states a
// doctor has signed off: an auto-filled Pending or "Test Done" value would put
// an unreviewed number into the state record, where CARE presents it as a
// clinical result like any other.
const RELEASABLE_STATUSES = ['Verified', 'Approved'];

/**
 * GET /api/care-bridge/results/:requestId
 *
 * Looks up our finished result for one CARE order. The extension calls this
 * from CARE's result entry page, which displays the request id, and types the
 * parameter values into their form — CARE's own result API is not usable, so
 * this is the return leg of the same workaround the import uses.
 */
export const getResultsByRequestId = async (req, res) => {
  const requestId = String(req.params.requestId || '').trim();
  if (!requestId) {
    return res.status(400).json({ success: false, message: 'requestId is required' });
  }

  try {
    const [[item]] = await db.query(
      `SELECT bi.id AS bill_item_id, bi.service_name, bi.sample_id, bi.status AS item_status,
              b.patient_name, p.reg_no
         FROM bill_items bi
         JOIN bills b ON b.id = bi.bill_id
    LEFT JOIN patients p ON p.id = b.patient_id
        WHERE bi.care_request_id = ?
        LIMIT 1`,
      [requestId]
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'No billed test in LIMS carries this CARE request id. Scrape this order first.',
      });
    }

    const [[result]] = await db.query(
      `SELECT id, test_name, results_json, status, verified_at, tested_at, notes
         FROM lab_test_result
        WHERE bill_item_id = ?
        ORDER BY id DESC
        LIMIT 1`,
      [item.bill_item_id]
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: `No result entered yet for ${item.service_name} (${item.sample_id}).`,
        test: item.service_name,
        sample_id: item.sample_id,
      });
    }

    if (!RELEASABLE_STATUSES.includes(result.status)) {
      return res.status(409).json({
        success: false,
        message: `Result for ${item.service_name} is "${result.status}" — it has to be verified before it can go into CARE.`,
        test: item.service_name,
        sample_id: item.sample_id,
        status: result.status,
      });
    }

    // results_json is written by the analyzer listeners and by manual entry;
    // both produce an array, but a corrupt row must not 500 the page.
    let parsed = [];
    try {
      parsed = typeof result.results_json === 'string'
        ? JSON.parse(result.results_json)
        : (result.results_json || []);
    } catch {
      return res.status(500).json({
        success: false,
        message: `Result ${result.id} could not be read — its stored values are not valid JSON.`,
      });
    }

    res.json({
      success: true,
      request_id: requestId,
      patient_name: item.patient_name,
      reg_no: item.reg_no,
      test_name: result.test_name || item.service_name,
      sample_id: item.sample_id,
      status: result.status,
      verified_at: result.verified_at,
      notes: result.notes || null,
      parameters: (Array.isArray(parsed) ? parsed : []).map((p) => ({
        name: p.parameter_name,
        value: p.result_value,
        unit: p.unit || null,
        flag: p.flag || null,
        ref_range: p.ref_range || null,
      })),
    });
  } catch (err) {
    console.error('CARE bridge result lookup error:', err);
    res.status(500).json({ success: false, message: 'Lookup failed', error: err.message });
  }
};

/**
 * POST /api/care-bridge/mark-saved  { request_id, saved_by }
 *
 * The technician has pressed save on CARE's own form. CARE is what forwards a
 * result to ABHA, so this confirmation is the only evidence we can have that
 * the result reached the national record — and it is the sole thing the ABHA
 * dashboard reports.
 *
 * Deliberately a separate, explicit action rather than a side effect of the
 * auto-fill: filling a form is not saving it, and a result typed in and then
 * abandoned must never be reported as being in CARE.
 */
export const markCareSaved = async (req, res) => {
  const requestId = String(req.body?.request_id || '').trim();
  const savedBy = String(req.body?.saved_by || '').trim().slice(0, 120) || null;

  if (!requestId) {
    return res.status(400).json({ success: false, message: 'request_id is required' });
  }

  try {
    const [[item]] = await db.query(
      `SELECT bi.id, bi.service_name, bi.sample_id, bi.care_saved_at, b.patient_name
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
        WHERE bi.care_request_id = ? LIMIT 1`,
      [requestId]
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'No billed test carries this CARE request id.',
      });
    }

    // Re-confirming keeps the first timestamp: the question the dashboard
    // answers is when this reached CARE, not when someone last clicked.
    if (item.care_saved_at) {
      return res.json({
        success: true,
        already: true,
        saved_at: item.care_saved_at,
        message: `Already recorded as saved in CARE for ${item.service_name}.`,
      });
    }

    await db.query(
      'UPDATE bill_items SET care_saved_at = NOW(), care_saved_by = ? WHERE id = ?',
      [savedBy, item.id]
    );

    res.json({
      success: true,
      already: false,
      test: item.service_name,
      sample_id: item.sample_id,
      patient_name: item.patient_name,
      message: `Recorded: ${item.service_name} saved in CARE.`,
    });
  } catch (err) {
    console.error('markCareSaved error:', err);
    res.status(500).json({ success: false, message: 'Could not record', error: err.message });
  }
};

export const importCareOrders = async (req, res) => {
  const { branch_id, rows = [], patients = [] } = req.body || {};

  if (!branch_id) {
    return res.status(400).json({ success: false, message: 'branch_id is required' });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ success: false, message: 'rows is required and must not be empty' });
  }

  const conn = await db.getConnection();
  const created = { patients: [], tests: [], bills: [] };
  const skipped = [];
  const problems = [];

  try {
    const [[branch]] = await conn.query(
      'SELECT id, hospital_code FROM branches WHERE id = ? LIMIT 1', [branch_id]);
    if (!branch) {
      conn.release();
      return res.status(404).json({ success: false, message: `Branch ${branch_id} not found` });
    }

    // Demographics arrive separately from the order rows (scraped once per
    // patient), so index them for the join below.
    const demoById = new Map();
    for (const p of patients) if (p.care_patient_id) demoById.set(p.care_patient_id, p);

    // Group orders by CARE patient: one bill per patient, matching how the
    // CDAC importer behaves, rather than a bill per test.
    const byPatient = new Map();
    for (const r of rows) {
      if (!r.care_patient_id || !r.test_name) {
        problems.push(`row skipped — missing care_patient_id or test_name: ${JSON.stringify(r).slice(0, 120)}`);
        continue;
      }
      if (!byPatient.has(r.care_patient_id)) byPatient.set(r.care_patient_id, []);
      byPatient.get(r.care_patient_id).push(r);
    }

    await conn.beginTransaction();

    for (const [careId, orderRows] of byPatient.entries()) {
      const demo = demoById.get(careId) || {};
      const patientInfo = {
        care_patient_id: careId,
        patient_name: orderRows[0].patient_name,
        ...demo,
      };

      const patient = await ensurePatient(conn, patientInfo, branch_id, created);

      // Which of this patient's tests are already on a bill? Keyed on the CARE
      // patient id stamped into bill_items, so a re-scrape is a no-op rather
      // than a duplicate bill.
      const [alreadyBilled] = await conn.query(
        `SELECT DISTINCT bi.service_name
           FROM bill_items bi
          WHERE bi.care_patient_external_id = ?`, [careId]);
      const billedNames = new Set(alreadyBilled.map((x) => x.service_name));

      const items = [];
      for (const r of orderRows) {
        const name = String(r.test_name).trim();
        if (billedNames.has(name)) {
          skipped.push({ patient: patientInfo.patient_name, test: name, reason: 'already billed' });
          continue;
        }
        // Guard against the same test appearing twice in one scrape.
        if (items.some((i) => i.service_name === name)) continue;

        const testId = await ensureLabTest(conn, name, created);
        if (!testId) continue;
        // The CARE request id is what the result-entry page shows, so it is
        // how a finished result finds its way back to the right order.
        items.push({ service_id: testId, service_name: name, care_request_id: r.care_request_id || null });
      }

      if (!items.length) continue;

      const billNumber =
        `CARE-${(branch.hospital_code || 'BILL').replace(/\s+/g, '')}-` +
        `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-` +
        `${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

      const [billRes] = await conn.query(
        `INSERT INTO bills
           (bill_number, patient_id, patient_name, patient_phone, total_amount,
            discount_amount, net_amount, payment_method, payment_status,
            paid_amount, status, notes, branch_id)
         VALUES (?, ?, ?, ?, 0, 0, 0, 'Cash', 'Pending', 0, 'Active', ?, ?)`,
        [billNumber, patient.id, patientInfo.patient_name, patientInfo.phone || null,
         `Imported from CARE HMIS (patient ${careId})`, branch_id]
      );

      // Auto-acknowledge: allocate a sample ID per TEST and mark each item
      // Collected so they arrive in the technician's worklist ready to run.
      // A CARE order has already been raised by a clinician and the sample
      // drawn on their side, so leaving these Pending would mean a manual
      // acknowledge click that carries no new information.
      //
      // One ID per test, NOT one per patient. Sharing a single ID across a
      // patient's tests looked tidier, but the sample ID is what an analyzer
      // result is matched on — a result posted for that ID would attach to
      // every test on the bill at once, so a CBC result would also land on
      // their Urine R/E and CRP.
      //
      // Uses the shared generator (utils/sampleId.js) — the same atomic
      // per-branch/per-day counter, date handling and cross-facility
      // uniqueness registry as billing and manual acknowledge, so
      // bridge-created and manually-created sample IDs can never collide.
      // 'Pathology' selects the 5000 range these tests are filed under.
      const itemSamples = [];
      for (const item of items) {
        const { sampleId, shortId } = await generateSampleIdForItem(conn, branch_id, 'Pathology');

        await conn.query(
          `INSERT INTO bill_items
             (bill_id, service_type, service_id, service_name, quantity,
              unit_price, total_price, status, sample_id, short_id,
              care_patient_external_id, care_request_id)
           VALUES (?, 'Laboratory', ?, ?, 1, 0, 0, 'Collected', ?, ?, ?, ?)`,
          [billRes.insertId, item.service_id, item.service_name, sampleId, shortId,
           careId, item.care_request_id]
        );
        itemSamples.push({ test: item.service_name, sample_id: sampleId });
      }

      created.bills.push({
        bill_id: billRes.insertId,
        bill_number: billNumber,
        patient: patientInfo.patient_name,
        reg_no: patient.reg_no,
        items: items.length,
        // One sample id per test, so the technician can see which is which.
        samples: itemSamples,
      });
    }

    await conn.commit();

    res.json({
      success: true,
      message:
        `${created.bills.length} bill(s) created, ${skipped.length} test(s) already billed`,
      created,
      skipped,
      problems,
    });
  } catch (err) {
    await conn.rollback();
    console.error('CARE bridge import error:', err);
    res.status(500).json({ success: false, message: 'Import failed', error: err.message });
  } finally {
    conn.release();
  }
};
