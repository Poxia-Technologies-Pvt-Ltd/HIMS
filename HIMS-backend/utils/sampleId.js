// Single source of truth for the LAB-{hospitalCode}-{YYYYMMDD}-{shortId}
// sample ID scheme, shared between billing-time auto-generation
// (billingController.js createBill) and the Worklist's manual
// "Acknowledge" endpoint (labController.js generateSampleId) — kept in one
// place so the format and the per-branch/per-department daily sequence
// counter can't drift between the two call sites.
export async function generateSampleIdForItem(connection, branch_id, department) {
  // Department-based range (matches lab workflow convention)
  let startRange = 7000;
  if (department) {
    const dep = department.toLowerCase();
    if (dep.includes('hematology') || dep.includes('haematology')) {
      startRange = 1;
    } else if (dep.includes('biochem')) {
      startRange = 3000;
    } else if (dep.includes('serology') || dep.includes('microbiology') || dep.includes('pathology') || dep.includes('urine')) {
      startRange = 5000;
    }
  }

  const deptKey = startRange.toString();

  // Single atomic upsert per branch+department — no race condition possible
  await connection.query(
    `INSERT INTO lab_sample_sequences (branch_id, seq_date, dept_key, last_seq)
     VALUES (?, CURDATE(), ?, ?)
     ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
    [branch_id, deptKey, startRange]
  );

  const [[row]] = await connection.query(
    `SELECT s.last_seq, b.hospital_code
     FROM lab_sample_sequences s
     JOIN branches b ON b.id = s.branch_id
     WHERE s.branch_id = ? AND s.seq_date = CURDATE() AND s.dept_key = ?`,
    [branch_id, deptKey]
  );

  const dateStr  = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const shortId  = row.last_seq.toString().padStart(4, '0');
  const sampleId = `LAB-${row.hospital_code}-${dateStr}-${shortId}`;

  return { sampleId, shortId, sequence: row.last_seq };
}
