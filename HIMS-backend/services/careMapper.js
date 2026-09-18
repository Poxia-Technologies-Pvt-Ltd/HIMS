/**
 * Translation layer between CARE's HL7 ORM/ORU payloads and this LIS's local
 * schema. Modeled on services/cdacMapper.js's findOrCreateCdacPatient/
 * resolveCdacTest/mapCdacOrderToLocalBill (match-or-create patient,
 * match-or-placeholder test, idempotent-by-correlation-id), adapted to CARE's
 * field names and filler-order-number correlation.
 */
import db from '../config/db.js';
import { buildORU } from '../utils/hl7Builder.js';
import { findLoincParameterMapping } from './careAutoMapper.js';

async function findOrCreateCarePatient(connection, patient, branchId) {
  // Deterministic reg_no from CARE's own patient identifier (PID-3), used for
  // BOTH lookup and insert — the previous implementation looked up by
  // `patient.externalId` but inserted `CARE-${Date.now()}`, so a second order
  // for the same CARE patient never matched and always created a duplicate.
  const regNo = patient.externalId ? `CARE-${patient.externalId}` : `CARE-${Date.now()}`;

  const [[byRegNo]] = await connection.query('SELECT id FROM patients WHERE reg_no = ? LIMIT 1', [regNo]);
  if (byRegNo) return byRegNo.id;

  if (patient.phone) {
    const [[byPhone]] = await connection.query('SELECT id FROM patients WHERE telephone = ? LIMIT 1', [patient.phone]);
    if (byPhone) return byPhone.id;
  }

  const [result] = await connection.query(
    `INSERT INTO patients (reg_no, reg_date, first_name, middle_name, last_name, dob, gender, telephone, branch_id)
     VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
    [
      regNo,
      patient.firstName || 'Unknown',
      patient.middleName || '',
      patient.lastName || '',
      patient.dob || null,
      patient.gender || 'Other',
      patient.phone || '0000000000',
      branchId,
    ]
  );
  return result.insertId;
}

/**
 * Resolve loincCode -> lab_tests.id, creating a LOINC- placeholder test if
 * unmapped. Global, like CDAC's resolveCdacTest — LOINC is a public standard,
 * even more clearly not hospital-specific than CDAC's own codes.
 */
async function resolveCareLoincTest(connection, loincCode, loincName) {
  const [[mapped]] = await connection.query(
    `SELECT * FROM care_loinc_test_map WHERE loinc_code = ? LIMIT 1`,
    [loincCode]
  );

  if (mapped?.lab_test_id) {
    const [[test]] = await connection.query(
      `SELECT id, test_name, price FROM lab_tests WHERE id = ? LIMIT 1`,
      [mapped.lab_test_id]
    );
    if (test) return { ...test, mappingStatus: mapped.mapping_status };
  }

  const placeholderCode = `LOINC-${loincCode}`;
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
       VALUES (?, ?, ?, 'Serum', 0, 'Active')`,
      [placeholderCode, loincName || `LOINC test ${loincCode}`, catId]
    );
    testRow = { id: ins.insertId, test_name: loincName || `LOINC test ${loincCode}`, price: 0 };
  }

  if (mapped) {
    await connection.query(
      `UPDATE care_loinc_test_map SET lab_test_id = ?, mapping_status = 'Placeholder', loinc_name = ?, updated_at = NOW() WHERE id = ?`,
      [testRow.id, loincName, mapped.id]
    );
  } else {
    await connection.query(
      `INSERT INTO care_loinc_test_map (loinc_code, loinc_name, lab_test_id, mapping_status)
       VALUES (?, ?, ?, 'Placeholder')`,
      [loincCode, loincName, testRow.id]
    );
  }

  return { ...testRow, mappingStatus: 'Placeholder' };
}

/**
 * Parsed ORM -> local patient + bill + bill_items + care_lab_orders.
 * Idempotent per filler_order_number (UNIQUE): re-delivery of the same order
 * skips lines already materialized rather than erroring or duplicating.
 */
export async function mapCareOrderToLocalBill(orm, branchId, extras = {}) {
  const { deviceIp, devicePort, ormMode } = extras;

  if (!orm.orders?.length) {
    const err = new Error('No OBR test orders found in raw_message');
    err.status = 400;
    throw err;
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const newOrders = [];
    const alreadyReceived = [];
    const invalidItems = [];
    for (const o of orm.orders) {
      if (!o.testCode || !o.placerOrderNumber || !o.fillerOrderNumber) {
        invalidItems.push({
          fillerOrderNumber: o.fillerOrderNumber || null,
          testName: o.testName || null,
          reason: !o.testCode ? 'missing OBR-4 test code' : !o.placerOrderNumber ? 'missing OBR-2 placer order number' : 'missing OBR-3 filler order number',
        });
        continue;
      }

      const [[existing]] = await connection.query(
        `SELECT bill_item_id FROM care_lab_orders WHERE filler_order_number = ? LIMIT 1`,
        [o.fillerOrderNumber]
      );
      if (existing) alreadyReceived.push({ billItemId: existing.bill_item_id, fillerOrderNumber: o.fillerOrderNumber, skipped: 'already received' });
      else newOrders.push(o);
    }

    if (!newOrders.length) {
      await connection.rollback();
      return {
        patientId: null, billId: null, billNumber: null,
        items: alreadyReceived, invalidItems,
        allAlreadyReceived: alreadyReceived.length > 0 && invalidItems.length === 0,
      };
    }

    const patientId = await findOrCreateCarePatient(connection, orm.patient, branchId);

    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const [billCount] = await connection.query(`SELECT COUNT(*) as count FROM bills WHERE DATE(created_at) = CURDATE()`);
    const billNumber = `CARE-${date}-${(billCount[0].count + 1).toString().padStart(4, '0')}`;

    const [billResult] = await connection.query(
      `INSERT INTO bills (patient_id, bill_number, total_amount, net_amount, payment_status, notes, branch_id, created_at, updated_at)
       VALUES (?, ?, 0, 0, 'Pending', 'External CARE order', ?, NOW(), NOW())`,
      [patientId, billNumber, branchId]
    );
    const billId = billResult.insertId;

    const items = [...alreadyReceived];
    for (const o of newOrders) {
      const test = await resolveCareLoincTest(connection, o.testCode, o.testName);

      const [billItemResult] = await connection.query(
        `INSERT INTO bill_items (bill_id, service_type, service_id, service_name, unit_price, total_price, status, created_at, updated_at)
         VALUES (?, 'Laboratory', ?, ?, ?, ?, 'Pending', NOW(), NOW())`,
        [billId, test.id, test.test_name, test.price || 0, test.price || 0]
      );
      const billItemId = billItemResult.insertId;

      await connection.query(
        `INSERT INTO care_lab_orders
           (bill_item_id, branch_id, placer_order_number, filler_order_number, loinc_code, loinc_name,
            coding_system, message_control_id, device_ip, device_port, orm_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          billItemId, branchId, o.placerOrderNumber, o.fillerOrderNumber, o.testCode, o.testName || null,
          o.codingSystem || null, orm.messageControlId || null, deviceIp || null, devicePort || null, ormMode || null,
        ]
      );

      items.push({ billItemId, fillerOrderNumber: o.fillerOrderNumber, testName: test.test_name, mappingStatus: test.mappingStatus });
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

/**
 * Builds the outbound ORU payload from whatever the lab actually reported
 * (lab_test_result.results_json), matching each parameter against
 * care_loinc_parameter_map. Unmapped parameters are skipped and logged, not
 * fatal — mirrors cdacMapper.buildResultRowDataPayload.
 */
export async function buildResultOruPayload(careOrderRow, labTestResult) {
  const results = typeof labTestResult.results_json === 'string'
    ? JSON.parse(labTestResult.results_json)
    : (labTestResult.results_json || []);

  const [[billItem]] = await db.query(
    `SELECT bi.bill_id, b.patient_id, p.reg_no, p.first_name, p.last_name, p.dob, p.gender, p.telephone
     FROM bill_items bi
     JOIN bills b ON bi.bill_id = b.id
     JOIN patients p ON b.patient_id = p.id
     WHERE bi.id = ? LIMIT 1`,
    [careOrderRow.bill_item_id]
  );
  if (!billItem) throw new Error(`No bill_item found for care_lab_orders.bill_item_id=${careOrderRow.bill_item_id}`);

  const oruResults = [];
  const skipped = [];
  for (const r of results) {
    if (r.is_subheader || !r.parameter_name) continue;

    const map = await findLoincParameterMapping(careOrderRow.loinc_code, r.parameter_name);
    if (!map) { skipped.push(r.parameter_name); continue; }

    oruResults.push({
      paramLoincCode: map.parameter_loinc_code,
      paramName: r.parameter_name,
      value: r.result_value,
      uom: map.uom || '',
      referenceRange: r.reference_range || '',
      resultFlag: r.result_flag,
    });
  }

  if (skipped.length) {
    console.warn(`CARE ORU: skipped ${skipped.length} unmapped parameter(s) for filler_order_number=${careOrderRow.filler_order_number}: ${skipped.join(', ')}`);
  }

  // CARE-origin patient identifier is the reg_no we minted at receive time
  // (`CARE-${externalId}`) stripped back to the original externalId when
  // possible, so we echo back the same PID-3 CARE originally sent.
  const externalId = billItem.reg_no?.startsWith('CARE-') ? billItem.reg_no.slice(5) : billItem.reg_no;

  // mysql2 returns DATE columns as JS Date objects, not 'YYYY-MM-DD' strings —
  // String(date) gives a locale-formatted string ("Mon Jan 19 1990..."), not
  // an HL7 YYYYMMDD date, so this must format explicitly rather than assume
  // a string comes back from the driver.
  const formatHL7Date = (d) => {
    if (!d) return '';
    const date = d instanceof Date ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  };

  const { rawMessage } = buildORU({
    patient: {
      externalId,
      lastName: billItem.last_name,
      firstName: billItem.first_name,
      dob: formatHL7Date(billItem.dob),
      gender: billItem.gender,
    },
    order: {
      placerOrderNumber: careOrderRow.placer_order_number,
      fillerOrderNumber: careOrderRow.filler_order_number,
      loincCode: careOrderRow.loinc_code,
      loincName: careOrderRow.loinc_name,
      codingSystem: careOrderRow.coding_system,
    },
    results: oruResults,
  });

  return { rawMessage, skippedParameters: skipped, resultCount: oruResults.length };
}
