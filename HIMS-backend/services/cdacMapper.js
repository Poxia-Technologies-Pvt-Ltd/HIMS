/**
 * Translation layer between CDAC's e-Sushrut HMIS payload shapes and this
 * LIS's local schema. Modeled on controllers/careController.js's
 * findOrCreatePatient/resolveTests (match-or-create patient, match-or-placeholder
 * test) — same idea, adapted to CDAC's field names and requisition-level
 * (hmis_req_no/hmis_req_dno) correlation.
 */
import db from '../config/db.js';
import { findParameterMapping } from './cdacAutoMapper.js';

const CDAC_MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/** CDAC sends DOB as "23-Feb-2006" — parse explicitly rather than trust Date(). */
function parseCdacDob(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const [, day, mon, year] = m;
  const monthNum = CDAC_MONTHS[mon];
  if (!monthNum) return null;
  return `${year}-${monthNum}-${day.padStart(2, '0')}`;
}

const asStrOrNull = (v) => (v === undefined || v === null || v === '' ? null : String(v));

async function findOrCreateCdacPatient(connection, cdacData, branchId) {
  const patCrNo = cdacData.hmis_patCrNo;
  const regNo = `CDAC-${patCrNo}`;

  const [[byRegNo]] = await connection.query('SELECT id FROM patients WHERE reg_no = ? LIMIT 1', [regNo]);
  if (byRegNo) return byRegNo.id;

  const phone = cdacData.hmis_patAddMobileNo || cdacData.hmis_patAddPhoneNo || null;
  if (phone) {
    const [[byPhone]] = await connection.query('SELECT id FROM patients WHERE telephone = ? LIMIT 1', [phone]);
    if (byPhone) return byPhone.id;
  }

  const genderMap = { M: 'Male', F: 'Female' };
  const gender = genderMap[(cdacData.hmis_patGenderCode || '').toUpperCase()] || 'Other';

  const [result] = await connection.query(
    `INSERT INTO patients
       (reg_no, reg_date, title, first_name, middle_name, last_name, dob, gender, telephone,
        aadhar_number, city, address, branch_id)
     VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      regNo,
      cdacData.hmis_initial || 'Mr.',
      cdacData.hmis_patfirstname || 'Unknown',
      cdacData.hmis_patmiddlename || '',
      cdacData.hmis_patlastname || '',
      parseCdacDob(cdacData.hmis_patdob),
      gender,
      phone || '0000000000',
      cdacData.hmis_patAadharNo || null,
      cdacData.hmis_patadddistrict || null,
      cdacData.hmis_patAddHNo || null,
      branchId,
    ]
  );
  return result.insertId;
}

/**
 * Resolve hmis_test_code -> lab_tests.id, creating a CDAC- placeholder test
 * if unmapped. Global, not scoped to the pulling branch's hospital code —
 * lab_tests is one shared catalog and CDAC's test codes are a national
 * registry, so a mapping confirmed by any branch applies to every branch.
 */
async function resolveCdacTest(connection, hospMappingCode, inv) {
  const testCode = asStrOrNull(inv.hmis_test_code);
  const labCode = asStrOrNull(inv.hmis_lab_code);
  const sampleCode = asStrOrNull(inv.hmis_sample_code);
  const testName = inv.hmis_test_name || `CDAC test ${testCode}`;

  const [[mapped]] = await connection.query(
    `SELECT * FROM cdac_test_code_map WHERE hmis_test_code = ? LIMIT 1`,
    [testCode]
  );

  if (mapped?.lab_test_id) {
    const [[test]] = await connection.query(
      `SELECT id, test_name, price FROM lab_tests WHERE id = ? LIMIT 1`,
      [mapped.lab_test_id]
    );
    if (test) return { ...test, mappingStatus: mapped.mapping_status };
  }

  // No confirmed mapping — reuse or create a placeholder lab_tests row
  const placeholderCode = `CDAC-${testCode}`;
  const [[existingTest]] = await connection.query(
    `SELECT id, test_name, price FROM lab_tests WHERE test_code = ? LIMIT 1`,
    [placeholderCode]
  );

  let testRow = existingTest;
  if (!testRow) {
    const [cats] = await connection.query('SELECT id FROM lab_categories LIMIT 1');
    const catId = cats.length > 0 ? cats[0].id : 1;
    const [ins] = await connection.query(
      `INSERT INTO lab_tests (test_code, test_name, category_id, sample_type, price, status)
       VALUES (?, ?, ?, ?, 0, 'Active')`,
      [placeholderCode, testName, catId, inv.hmis_sample_name || 'Serum']
    );
    testRow = { id: ins.insertId, test_name: testName, price: 0 };
  }

  if (mapped) {
    await connection.query(
      `UPDATE cdac_test_code_map
         SET lab_test_id = ?, mapping_status = 'Placeholder', hmis_test_name = ?, hmis_lab_code = ?, hmis_sample_code = ?, updated_at = NOW()
       WHERE id = ?`,
      [testRow.id, testName, labCode, sampleCode, mapped.id]
    );
  } else {
    await connection.query(
      `INSERT INTO cdac_test_code_map
         (hmis_hosp_mapping_code, hmis_lab_code, hmis_test_code, hmis_test_name, hmis_sample_code, lab_test_id, mapping_status)
       VALUES (?, ?, ?, ?, ?, ?, 'Placeholder')`,
      [hospMappingCode, labCode, testCode, testName, sampleCode, testRow.id]
    );
  }

  return { ...testRow, mappingStatus: 'Placeholder' };
}

/**
 * API1 response.data -> local patient + bills + bill_items + cdac_lab_requisitions.
 * Idempotent per investigation line (hmis_req_dno is UNIQUE): re-pulling the
 * same patient skips lines already materialized rather than erroring.
 */
export async function mapCdacOrderToLocalBill(cdacData, branchId, branchConfig) {
  // CDAC has been observed to return hmis_investigation_data as the literal
  // string "NA" (not an array, not null) when a patient has no investigations
  // — `"NA" || []` is truthy and would otherwise iterate it character by
  // character ("N", "A") as if each were a malformed investigation object.
  const investigationData = Array.isArray(cdacData.hmis_investigation_data) ? cdacData.hmis_investigation_data : [];
  if (!investigationData.length) {
    const err = new Error(`No investigations found in CDAC response for patCrNo=${cdacData.hmis_patCrNo}`);
    err.status = 404;
    throw err;
  }

  const hospMappingCode = asStrOrNull(cdacData.hmis_hospital_code) || branchConfig?.hmis_hosp_mapping_code;
  const patCrNo = cdacData.hmis_patCrNo;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // CDAC's own response has been observed to contain investigation lines
    // missing required fields (e.g. hmis_test_code entirely absent) — those
    // can't be turned into a bill_item at all (hmis_test_code/hmis_req_no/
    // hmis_req_dno are all NOT NULL in cdac_lab_requisitions), so they're
    // skipped and reported back rather than crashing the whole pull and
    // losing the other, valid investigations in the same response.
    const newInvestigations = [];
    const alreadyPulled = [];
    const invalidItems = [];
    for (const inv of investigationData) {
      if (!inv.hmis_test_code || !inv.hmis_req_no || !inv.hmis_req_dno) {
        invalidItems.push({
          hmis_req_dno: inv.hmis_req_dno || null,
          hmis_test_name: inv.hmis_test_name || null,
          reason: !inv.hmis_test_code ? 'missing hmis_test_code' : !inv.hmis_req_no ? 'missing hmis_req_no' : 'missing hmis_req_dno',
        });
        console.warn(`CDAC pull-order: skipping investigation with missing required field(s) for patCrNo=${cdacData.hmis_patCrNo}:`, inv);
        continue;
      }

      const [[existingReq]] = await connection.query(
        `SELECT bill_item_id FROM cdac_lab_requisitions WHERE hmis_req_dno = ? LIMIT 1`,
        [inv.hmis_req_dno]
      );
      if (existingReq) alreadyPulled.push({ billItemId: existingReq.bill_item_id, hmis_req_dno: inv.hmis_req_dno, skipped: 'already pulled' });
      else newInvestigations.push(inv);
    }

    if (!newInvestigations.length) {
      await connection.rollback();
      return {
        patientId: null, billId: null, billNumber: null,
        items: alreadyPulled, invalidItems,
        allAlreadyPulled: alreadyPulled.length > 0 && invalidItems.length === 0,
      };
    }

    const patientId = await findOrCreateCdacPatient(connection, cdacData, branchId);

    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const [billCount] = await connection.query(`SELECT COUNT(*) as count FROM bills WHERE DATE(created_at) = CURDATE()`);
    const billNumber = `CDAC-${date}-${(billCount[0].count + 1).toString().padStart(4, '0')}`;

    const [billResult] = await connection.query(
      `INSERT INTO bills (patient_id, bill_number, total_amount, net_amount, payment_status, notes, branch_id, created_at, updated_at)
       VALUES (?, ?, 0, 0, 'Pending', 'External CDAC order', ?, NOW(), NOW())`,
      [patientId, billNumber, branchId]
    );
    const billId = billResult.insertId;

    const items = [...alreadyPulled];
    for (const inv of newInvestigations) {
      const test = await resolveCdacTest(connection, hospMappingCode, inv);

      const [billItemResult] = await connection.query(
        `INSERT INTO bill_items (bill_id, service_type, service_id, service_name, unit_price, total_price, status, created_at, updated_at)
         VALUES (?, 'Laboratory', ?, ?, ?, ?, 'Pending', NOW(), NOW())`,
        [billId, test.id, test.test_name, test.price || 0, test.price || 0]
      );
      const billItemId = billItemResult.insertId;

      await connection.query(
        `INSERT INTO cdac_lab_requisitions
           (bill_item_id, branch_id, hmis_hosp_mapping_code, hmis_patCrNo, hmis_episode_code, hmis_episode_visitno,
            hmis_req_no, hmis_req_dno, hmis_lab_code, hmis_test_code, hmis_test_name, hmis_sample_code, hmis_sample_name,
            req_type, cdac_inv_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          billItemId, branchId, hospMappingCode, patCrNo,
          asStrOrNull(cdacData.hmis_episode_code), asStrOrNull(cdacData.hmis_episode_visitno),
          inv.hmis_req_no, inv.hmis_req_dno, asStrOrNull(inv.hmis_lab_code), asStrOrNull(inv.hmis_test_code),
          inv.hmis_test_name || null, asStrOrNull(inv.hmis_sample_code), inv.hmis_sample_name || null,
          asStrOrNull(inv.req_type), asStrOrNull(inv.cdac_inv_status),
        ]
      );

      items.push({ billItemId, hmis_req_dno: inv.hmis_req_dno, testName: test.test_name, mappingStatus: test.mappingStatus });
    }

    await connection.commit();
    return { patientId, billId, billNumber, items, invalidItems };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export function buildSampleCollectionPayload(cdacRow, poctStatus = 'SAMPLE_COLLECTED') {
  return {
    hospMappingCode: cdacRow.hmis_hosp_mapping_code,
    patCrNo: cdacRow.hmis_patCrNo,
    episodeCode: cdacRow.hmis_episode_code,
    episodeVisitNo: cdacRow.hmis_episode_visitno,
    investigationData: [{
      hmis_req_no: cdacRow.hmis_req_no,
      hmis_req_dno: cdacRow.hmis_req_dno,
      poct_lab_code: cdacRow.hmis_lab_code,
      poct_test_code: cdacRow.hmis_test_code,
      poct_sample_code: cdacRow.hmis_sample_code,
      poct_status: poctStatus,
      req_type: cdacRow.req_type,
    }],
  };
}

export function buildStatusUpdatePayload(cdacRow, poctStatus) {
  return {
    hospMappingCode: cdacRow.hmis_hosp_mapping_code,
    patCrNo: cdacRow.hmis_patCrNo,
    investigationData: [{
      hmis_req_no: cdacRow.hmis_req_no,
      hmis_req_dno: cdacRow.hmis_req_dno,
      poct_status: poctStatus,
    }],
  };
}

export function buildReportPayload(cdacRow, pdfBase64, poctStatus = 'PRINTED') {
  return {
    hospMappingCode: cdacRow.hmis_hosp_mapping_code,
    patCrNo: cdacRow.hmis_patCrNo,
    investigationData: [{
      hmis_req_no: cdacRow.hmis_req_no,
      hmis_req_dno: cdacRow.hmis_req_dno,
      poct_status: poctStatus,
      poct_pdf_rpt_base64: pdfBase64,
    }],
  };
}

/**
 * Builds the API31 parameter-result payload straight from whatever the
 * analyzer/lab actually reported (lab_test_result.results_json) — no
 * dependency on a pre-configured parameter catalog. An order can say "CBC"
 * while the lab only ran Platelet for this sample; if "Platelet" (or a close
 * enough name) has a CDAC code on file for this test, it gets pushed alone.
 * Parameters with no confident name match are skipped and logged, not fatal.
 *
 * Polarity of hmis_isinrefrange ("0"/"1") is not confirmed by CDAC's docs;
 * this assumes 1 = within range, 0 = out of range, matching result_flag.
 */
export async function buildResultRowDataPayload(cdacRow, labTestResult, poctStatus = 'AUTHORIZED') {
  const results = typeof labTestResult.results_json === 'string'
    ? JSON.parse(labTestResult.results_json)
    : (labTestResult.results_json || []);

  const investigationData = [];
  const skipped = [];

  for (const r of results) {
    if (r.is_subheader || !r.parameter_name) continue;

    const map = await findParameterMapping(cdacRow.hmis_test_code, r.parameter_name);
    if (!map) { skipped.push(r.parameter_name); continue; }

    const inRange = !r.result_flag || r.result_flag === 'Normal';
    investigationData.push({
      hmis_req_no: cdacRow.hmis_req_no,
      hmis_req_dno: cdacRow.hmis_req_dno,
      poct_status: poctStatus,
      hmis_lab_code: cdacRow.hmis_lab_code,
      hmis_test_code: cdacRow.hmis_test_code,
      hmis_sample_code: cdacRow.hmis_sample_code,
      hmis_parent_parameter_code: map.hmis_parent_parameter_code,
      hmis_str_value: String(r.result_value ?? ''),
      hmis_parameter_code: map.hmis_parameter_code,
      hmis_referencerange: r.reference_range || '',
      hmis_str_uom: map.hmis_str_uom,
      hmis_str_ref_range: r.reference_range || '',
      hmis_isinrefrange: inRange ? '1' : '0',
    });
  }

  if (skipped.length) {
    console.warn(`CDAC API31: skipped ${skipped.length} unmapped parameter(s) for req_dno=${cdacRow.hmis_req_dno}: ${skipped.join(', ')}`);
  }

  return {
    hospMappingCode: cdacRow.hmis_hosp_mapping_code,
    patCrNo: cdacRow.hmis_patCrNo,
    investigationData,
    skippedParameters: skipped,
  };
}
