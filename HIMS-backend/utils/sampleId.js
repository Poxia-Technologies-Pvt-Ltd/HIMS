// Single source of truth for the LAB-{hospitalCode}-{YYYYMMDD}-{NNNN} sample
// ID scheme, shared between billing-time auto-generation
// (billingController.js createBill) and the Worklist's manual
// "Acknowledge" endpoint (labController.js generateSampleId).
//
// The ID has two parts with different jobs:
//   LAB-{hospital}-{date}   the UNIQUE part — identifies the facility and the
//                           day, so the same number on another day or at
//                           another facility can never be mistaken for it.
//   {NNNN}                  the SEQUENTIAL part — a running number per
//                           facility, day and department. It is what the
//                           technician keys into the analyzer, so it runs
//                           consecutively (…5001, 5002…) and lines up with
//                           the analyzer's own auto-incrementing default ID.
//
// Each department owns a number range, so two departments' tubes never share
// the same last four digits on the same day.
import { registerSample } from './sampleLifecycle.js';

const DEPARTMENT_RANGES = {
  hematology: { start: 1,    end: 2999 },
  biochemistry: { start: 3000, end: 4999 },
  clinical: { start: 5000, end: 6999 }, // serology / microbiology / pathology / urine
  other: { start: 7000, end: 9999 },
};

export function rangeForDepartment(department) {
  const dep = (department || '').toLowerCase();
  if (dep.includes('hematology') || dep.includes('haematology')) return DEPARTMENT_RANGES.hematology;
  if (dep.includes('biochem')) return DEPARTMENT_RANGES.biochemistry;
  if (dep.includes('serology') || dep.includes('microbiology') || dep.includes('pathology') || dep.includes('urine')) return DEPARTMENT_RANGES.clinical;
  return DEPARTMENT_RANGES.other;
}

// `executor` is either a pooled connection already inside the caller's
// transaction (billing) or the pool itself (manual acknowledge). The counter
// bump and the read-back MUST happen on one connection inside one
// transaction: the bump takes a row lock that is held until commit, so no
// other request can increment between our write and our read. (Reading the
// counter in a separate, autocommitted step — what this used to do — let two
// simultaneous requests be handed the same number.)
//
// The read-back is a plain SELECT, not LAST_INSERT_ID(): this table has an
// AUTO_INCREMENT id, and on the first insert of a day MySQL reports THAT id
// through LAST_INSERT_ID() instead of the counter value.
export async function generateSampleIdForItem(executor, branch_id, department, actor = {}) {
  const { start, end } = rangeForDepartment(department);
  const deptKey = start.toString();

  const ownsConnection = typeof executor.getConnection === 'function';
  const connection = ownsConnection ? await executor.getConnection() : executor;

  try {
    if (ownsConnection) await connection.beginTransaction();

    // Per branch + department + day; first sample of the day gets `start`.
    await connection.query(
      `INSERT INTO lab_sample_sequences (branch_id, seq_date, dept_key, last_seq)
       VALUES (?, CURDATE(), ?, ?)
       ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
      [branch_id, deptKey, start]
    );
    const [[row]] = await connection.query(
      `SELECT s.last_seq, DATE_FORMAT(CURDATE(), '%Y%m%d') AS day, b.hospital_code
       FROM lab_sample_sequences s
       LEFT JOIN branches b ON b.id = s.branch_id
       WHERE s.branch_id = ? AND s.seq_date = CURDATE() AND s.dept_key = ?`,
      [branch_id, deptKey]
    );

    // A facility without a code would mint IDs shared with every other
    // code-less facility. Refuse rather than guess.
    if (!row.hospital_code) {
      throw new Error(`Branch ${branch_id} has no hospital code — sample IDs must be prefixed with the facility's unique code.`);
    }

    const seq = row.last_seq;
    if (seq > end) {
      throw new Error(
        `Sample number range for this department is exhausted for today (${start}–${end}). ` +
        `Continuing would reuse numbers belonging to another department.`
      );
    }

    // The ID itself, built here so it can be registered before it is used.
    const shortId  = String(seq).padStart(4, '0');
    const sampleId = `LAB-${row.hospital_code}-${row.day}-${shortId}`;

    // Database-enforced uniqueness across ALL facilities and days — see
    // migrations/2026_09_20_lab_sample_id_registry.sql. Same transaction as
    // the caller's, so a rolled-back bill takes its registry row with it.
    try {
      await connection.query(
        'INSERT INTO lab_sample_ids (sample_id, branch_id, seq_date, dept_key) VALUES (?, ?, CURDATE(), ?)',
        [sampleId, branch_id, deptKey]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new Error(`Sample ID ${sampleId} has already been issued — refusing to reuse it.`);
      }
      throw err;
    }

    // Start the sample's tracked lifecycle (Accessioned) and its custody log.
    await registerSample(connection, { sample_id: sampleId, branch_id, actor });

    if (ownsConnection) await connection.commit();

    // (The date in the ID comes from the database — the same CURDATE() the
    // counter row is keyed on — not from JS: new Date().toISOString() is UTC
    // and showed yesterday's date on IDs made between midnight and 05:30 IST.)
    return { sampleId, shortId, sequence: seq };
  } catch (err) {
    if (ownsConnection) await connection.rollback().catch(() => {});
    throw err;
  } finally {
    if (ownsConnection) connection.release();
  }
}
