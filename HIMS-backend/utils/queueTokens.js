// Token engine for the Sample Collection queue. Shared by the queue API
// (queueController.js) and billing (auto-issues a token per bill with lab
// tests), so the numbering and the daily reset live in one place.

// Registration tokens are taken at the kiosk by patients with no order yet.
export const SERVICE_POINTS = ['Sample Collection', 'Registration'];

// Appends one row to the audit log (queue_token_events). Always called with
// the SAME connection/transaction as the change it records, so a token can
// never move without leaving a trace, nor leave a trace of a move that was
// rolled back. The actor's name is snapshotted here — see the migration.
export async function recordTokenEvent(connection, {
  token_id, branch_id, service_point, token_number, event_type,
  from_status = null, to_status, counter = null,
  actor_id = null, actor_role = null, ip = null,
}) {
  let actor_name = null;
  if (actor_id) {
    const [[u]] = await connection.query(
      "SELECT CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id = ?",
      [actor_id]
    );
    actor_name = u?.name || null;
  }
  await connection.query(
    `INSERT INTO queue_token_events
       (token_id, branch_id, service_point, token_number, event_type,
        from_status, to_status, counter, actor_id, actor_name, actor_role, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [token_id, branch_id, service_point, token_number, event_type,
     from_status, to_status, counter, actor_id, actor_name, actor_role, ip]
  );
}

// Same race-safe counter idiom as reserveRegNo (patientController.js): the
// row lock during ON DUPLICATE KEY UPDATE serializes concurrent issuers, and
// LAST_INSERT_ID(last_seq + 1) returns the post-increment value in the same
// round trip. The first insert of a day must ALSO go through LAST_INSERT_ID(1)
// in VALUES — otherwise only the update path sets it and the first token
// would read back a stale 0. Sequences restart every day per branch + service point.
export async function issueToken(connection, {
  branch_id, service_point, patient_reg_no = null, patient_name = null,
  bill_id = null, priority = 'Routine', issued_by = null,
  actor_role = null, ip = null, issued_via = 'Counter',
}) {
  if (!SERVICE_POINTS.includes(service_point)) throw new Error(`Unknown service point "${service_point}"`);

  await connection.query(
    `INSERT INTO queue_token_sequences (branch_id, token_date, service_point, last_seq)
     VALUES (?, CURDATE(), ?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1)`,
    [branch_id, service_point]
  );
  const [[{ seq }]] = await connection.query('SELECT LAST_INSERT_ID() AS seq');
  // Plain running number (1, 2, 3 …) — what patients read off the TV and their slip.
  const token_number = String(seq);

  const [result] = await connection.query(
    `INSERT INTO patient_queue_tokens
       (branch_id, token_date, service_point, token_number, seq,
        patient_reg_no, patient_name, bill_id, priority, issued_by, issued_via)
     VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [branch_id, service_point, token_number, seq, patient_reg_no, patient_name, bill_id, priority, issued_by, issued_via]
  );

  await recordTokenEvent(connection, {
    token_id: result.insertId, branch_id, service_point, token_number,
    event_type: 'Issued', to_status: 'Waiting',
    actor_id: issued_by, actor_role, ip,
  });

  // How many people are still ahead in this queue — lets the receptionist
  // tell the patient "you are number 5, three people before you".
  const [[{ ahead }]] = await connection.query(
    `SELECT COUNT(*) AS ahead FROM patient_queue_tokens
     WHERE branch_id = ? AND token_date = CURDATE() AND service_point = ?
       AND status IN ('Waiting', 'Called', 'In Service') AND seq < ?`,
    [branch_id, service_point, seq]
  );

  return { id: result.insertId, token_number, seq, service_point, status: 'Waiting', ahead };
}

// The Sample Collection token for a bill: returns the one already issued, or
// issues it now if the bill only gained lab tests after it was first created
// (invoice modified). Null when the bill has no lab tests.
export async function getOrIssueSampleToken(connection, bill_id, { has_lab_items, issued_by = null, actor_role = null, ip = null, issued_via = 'Counter' }) {
  const [[existing]] = await connection.query(
    `SELECT id, token_number, seq, status, branch_id FROM patient_queue_tokens
     WHERE bill_id = ? AND service_point = 'Sample Collection' LIMIT 1`,
    [bill_id]
  );
  if (existing) {
    const [[{ ahead }]] = await connection.query(
      `SELECT COUNT(*) AS ahead FROM patient_queue_tokens
       WHERE branch_id = ? AND token_date = CURDATE() AND service_point = 'Sample Collection'
         AND status IN ('Waiting', 'Called', 'In Service') AND seq < ?`,
      [existing.branch_id, existing.seq]
    );
    return { id: existing.id, token_number: existing.token_number, seq: existing.seq, service_point: 'Sample Collection', status: existing.status, ahead, reused: true };
  }
  if (!has_lab_items) return null;

  const [[bill]] = await connection.query(
    `SELECT b.branch_id, b.priority, p.reg_no, p.first_name, p.last_name
     FROM bills b JOIN patients p ON p.id = b.patient_id WHERE b.id = ?`,
    [bill_id]
  );
  if (!bill) return null;
  return issueToken(connection, {
    branch_id: bill.branch_id, service_point: 'Sample Collection',
    patient_reg_no: bill.reg_no, patient_name: `${bill.first_name} ${bill.last_name}`,
    bill_id, priority: bill.priority, issued_by, actor_role, ip, issued_via,
  });
}

// Waiting -> Called -> In Service -> Completed, plus Skipped/Cancelled exits.
// Only forward moves are allowed, so a stray double-click or a stale screen
// can't rewind a completed token.
export const ALLOWED_TRANSITIONS = {
  'Waiting':    ['Called', 'Skipped', 'Cancelled'],
  'Called':     ['In Service', 'Skipped', 'Cancelled'],
  'In Service': ['Completed', 'Cancelled'],
  'Skipped':    ['Called', 'Cancelled'],
  'Completed':  [],
  'Cancelled':  [],
};

// Which audit event a status change produces. Skipped -> Called is a
// "Recalled" rather than a second "Called", so the log reads truthfully.
export function eventTypeFor(from, to) {
  if (to === 'Called') return from === 'Skipped' ? 'Recalled' : 'Called';
  if (to === 'In Service') return 'Started';
  return to; // Completed | Skipped | Cancelled
}
