// Physical-sample lifecycle: Accessioned -> Collected -> Received ->
// Processing -> Stored -> Disposed. Every change is written to sample_events
// (the custody log) on the SAME connection/transaction as the change itself,
// so a sample can never move without leaving a trace.
//
// Keyed by sample_id — the string on the label's barcode. Several merged
// tests can share one sample_id, and they share one physical tube, so they
// share one lifecycle.

// Who may see/handle a sample: the facility that issued its barcode, and the
// facility currently holding it (a referral destination). Everyone else — and
// any other facility — gets "not found".
export const sampleVisibleTo = (sample, scope) =>
  !scope || Number(sample.branch_id) === Number(scope) || Number(sample.holder_branch_id) === Number(scope);

export const STAGES = ['Accessioned', 'Collected', 'Received', 'Processing', 'Stored', 'Disposed'];

// Manual (scan) moves are strictly forward, one step at a time — except a
// specimen can be discarded straight from the bench once it has been used
// up. Nothing moves backwards: a wrong scan is corrected by a supervisor,
// not by quietly rewinding the record.
export const NEXT_STAGES = {
  Accessioned: ['Collected'],
  Collected:   ['Received'],
  Received:    ['Processing'],
  Processing:  ['Stored', 'Disposed'],
  Stored:      ['Disposed'],
  Disposed:    [],
  Rejected:    [],
  'In Transit': [],
};

const STAGE_COLUMN = {
  Collected: 'collected_at', Received: 'received_at', Processing: 'processing_at',
  Stored: 'stored_at', Disposed: 'disposed_at',
};

// bill_items.status -> the stage an already-existing sample must have
// reached. Used only for samples that pre-date this table.
const STAGE_FOR_TEST_STATUS = {
  'Pending': 'Accessioned',
  'Collected': 'Collected',
  'In Progress': 'Processing',
  'Test Done': 'Processing',
  'Completed': 'Processing',
};

import { bumpWorklist } from './worklistSignal.js';

// Who is acting, for the custody log. A staff session is a person; a LIS-Agent
// request carries only a device key, so the step is attributed to that
// workstation. `station` overrides where it happened (e.g. an analyzer).
export const actorFromReq = (req, overrides = {}) => ({
  id: req.user?.id || null,
  role: req.user?.role || null,
  ip: req.ip,
  device: req.user?.isDeviceKey ? (req.user.device_label || 'LIS Agent') : null,
  ...overrides,
});

const DESK_BY_ROLE = {
  'Receptionist': 'Registration / billing desk',
  'Sample Collector': 'Sample collection desk',
  'Phlebotomist': 'Sample collection desk',
  'Lab Technician': 'Laboratory',
  'Lab Doctor': 'Laboratory',
  'Lab Head': 'Laboratory',
};

// "Facility · desk or workstation" — where the step was recorded.
async function stationFor(connection, branch_id, actor) {
  let facility = null;
  if (branch_id) {
    const [[b]] = await connection.query('SELECT branch_name FROM branches WHERE id = ?', [branch_id]);
    facility = b?.branch_name || null;
  }
  const where = actor.station || (actor.device ? `LIS Agent: ${actor.device}` : DESK_BY_ROLE[actor.role] || null);
  return [facility, where].filter(Boolean).join(' · ').slice(0, 160) || null;
}

export async function recordSampleEvent(connection, {
  sample_id, branch_id, event_type, from_stage = null, to_stage,
  location = null, note = null, auto = false,
  actor_id = null, actor_role = null, ip = null, device = null, station = null,
}) {
  let actor_name = null;
  if (actor_id) {
    const [[u]] = await connection.query(
      "SELECT CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id = ?", [actor_id]
    );
    actor_name = u?.name || null;
  } else if (device) {
    actor_name = `Workstation: ${device}`;
  }
  const where = await stationFor(connection, branch_id, { role: actor_role, device, station });
  await connection.query(
    `INSERT INTO sample_events
       (sample_id, branch_id, event_type, from_stage, to_stage, location, station, note, auto,
        actor_id, actor_name, actor_role, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [sample_id, branch_id, event_type, from_stage, to_stage, location, where, note, auto ? 1 : 0,
     actor_id, actor_name, actor_role, ip]
  );
  bumpWorklist(branch_id);
}

// Called when a sample ID is first issued (utils/sampleId.js).
export async function registerSample(connection, { sample_id, branch_id, actor = {} }) {
  const [res] = await connection.query(
    "INSERT IGNORE INTO lab_samples (sample_id, branch_id, stage) VALUES (?, ?, 'Accessioned')",
    [sample_id, branch_id]
  );
  if (res.affectedRows === 1) {
    await recordSampleEvent(connection, {
      sample_id, branch_id, event_type: 'Accessioned', to_stage: 'Accessioned',
      actor_id: actor.id || null, actor_role: actor.role || null, ip: actor.ip || null, device: actor.device || null, station: actor.station || null,
    });
  }
}

// A sample created before this feature has no lab_samples row yet. Create
// one on first touch, inferring the stage from its tests' status — logged as
// "Registered" so nobody mistakes the inferred stage for a scan.
export async function ensureSample(connection, sample_id, actor = {}) {
  const [[existing]] = await connection.query('SELECT * FROM lab_samples WHERE sample_id = ?', [sample_id]);
  if (existing) return existing;

  const [items] = await connection.query(
    `SELECT bi.status, b.branch_id
     FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
     WHERE bi.sample_id = ?`,
    [sample_id]
  );
  if (items.length === 0) return null;

  const rank = (s) => STAGES.indexOf(STAGE_FOR_TEST_STATUS[s] || 'Accessioned');
  const stage = STAGES[Math.max(...items.map((i) => rank(i.status)))];
  const branch_id = items[0].branch_id;

  await connection.query(
    'INSERT IGNORE INTO lab_samples (sample_id, branch_id, stage) VALUES (?, ?, ?)',
    [sample_id, branch_id, stage]
  );
  await recordSampleEvent(connection, {
    sample_id, branch_id, event_type: 'Registered', to_stage: stage,
    note: 'Existing sample brought under tracking — stage inferred from test status',
    auto: true, actor_id: actor.id || null, actor_role: actor.role || null, ip: actor.ip || null, device: actor.device || null, station: actor.station || null,
  });
  const [[row]] = await connection.query('SELECT * FROM lab_samples WHERE sample_id = ?', [sample_id]);
  return row;
}

// Moves a sample to `to`. Locks the row for the duration so two stations
// scanning the same tube at once can't both win.
//   auto = true  -> system-driven (e.g. an analyzer result arrived): forward
//                   jumps are allowed and the event is flagged `auto`.
//   auto = false -> a person scanned it: only NEXT_STAGES are allowed.
// Throws an Error with .status for the caller to map to an HTTP code.
export async function advanceSample(connection, {
  sample_id, to, location = null, note = null, auto = false,
  actor = {}, branchScope = null, at = null,
}) {
  const sample = await ensureSample(connection, sample_id, actor);
  if (!sample) throw Object.assign(new Error('Sample not found.'), { status: 404 });
  if (!sampleVisibleTo(sample, branchScope)) {
    throw Object.assign(new Error('Sample not found.'), { status: 404 });
  }

  const [[locked]] = await connection.query('SELECT * FROM lab_samples WHERE sample_id = ? FOR UPDATE', [sample_id]);
  const from = locked.stage;

  if (from === to) return { sample: locked, changed: false };
  const forwardOk = auto ? STAGES.indexOf(to) > STAGES.indexOf(from) : (NEXT_STAGES[from] || []).includes(to);
  if (!forwardOk) {
    throw Object.assign(
      new Error(`Cannot move a sample from "${from}" to "${to}".` +
        (NEXT_STAGES[from]?.length ? ` Next step: ${NEXT_STAGES[from].join(' or ')}.` : '')),
      { status: 409, from, allowed: NEXT_STAGES[from] || [] }
    );
  }
  if (to === 'Stored' && !location) {
    throw Object.assign(new Error('A storage location is required (rack / freezer / shelf).'), { status: 400 });
  }
  if (to === 'Disposed' && !note) {
    throw Object.assign(new Error('Enter the disposal method.'), { status: 400 });
  }

  // `at`: when it really happened, for a step recorded offline and synced later.
  const sets = ['stage = ?', `${STAGE_COLUMN[to]} = COALESCE(?, NOW())`];
  const values = [to, at];
  if (location) { sets.push('location = ?'); values.push(location); }
  if (to === 'Disposed') { sets.push('disposal_method = ?'); values.push(note); }
  values.push(sample_id);
  await connection.query(`UPDATE lab_samples SET ${sets.join(', ')} WHERE sample_id = ?`, values);

  await recordSampleEvent(connection, {
    sample_id, branch_id: locked.branch_id, event_type: to, from_stage: from, to_stage: to,
    location, note, auto,
    actor_id: actor.id || null, actor_role: actor.role || null, ip: actor.ip || null, device: actor.device || null, station: actor.station || null,
  });

  // A replacement tube issued after a rejection has now been drawn — close
  // the recollection alert.
  if (to === 'Collected') {
    await connection.query(
      "UPDATE sample_rejections SET status = 'Recollected', recollected_at = NOW() WHERE recollect_sample_id = ? AND status = 'Recollection Pending'",
      [sample_id]
    );
  }

  const [[updated]] = await connection.query('SELECT * FROM lab_samples WHERE sample_id = ?', [sample_id]);
  return { sample: updated, changed: true, from };
}

// Never lets a lifecycle problem break the flow that called it (billing,
// acknowledge, result save): those must succeed even if tracking can't.
export async function advanceSampleQuietly(connection, args) {
  try {
    return await advanceSample(connection, { ...args, auto: true });
  } catch (err) {
    if (![404, 409].includes(err.status)) console.error('Sample lifecycle update failed:', err.message);
    return null;
  }
}

// Turns whatever the scanner produced into a sample_id: the full ID printed
// on the label (unique everywhere), or just the 4-digit running number —
// which is only unique per facility per day, so it's matched against
// today's samples at the caller's own branch (same rule as the analyzer
// lookup in labController.getWorklistById).
export async function resolveScannedCode(connection, code, branchScope = null) {
  const raw = String(code || '').trim();
  if (!raw) return null;

  const [[exact]] = await connection.query(
    `SELECT sample_id FROM bill_items WHERE sample_id = ? LIMIT 1`, [raw]
  );
  if (exact) return exact.sample_id;
  const [[direct]] = await connection.query('SELECT sample_id FROM lab_samples WHERE sample_id = ?', [raw]);
  if (direct) return direct.sample_id;

  if (/^\d{1,4}$/.test(raw)) {
    const short = raw.padStart(4, '0');
    const [[row]] = await connection.query(
      `SELECT bi.sample_id
       FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
       WHERE bi.short_id = ? AND DATE(b.created_at) = CURDATE() ${branchScope ? 'AND b.branch_id = ?' : ''}
       ORDER BY bi.id DESC LIMIT 1`,
      branchScope ? [short, branchScope] : [short]
    );
    if (row) return row.sample_id;

    // A referred-in sample keeps its original barcode; the last four digits
    // are also matched against samples this facility received by referral today.
    if (branchScope) {
      const [[ref]] = await connection.query(
        `SELECT r.sample_id FROM sample_referrals r JOIN bill_items bi ON bi.sample_id = r.sample_id
         WHERE bi.short_id = ? AND r.to_branch_id = ? AND r.status = 'Received' AND DATE(r.received_at) = CURDATE()
         ORDER BY r.id DESC LIMIT 1`, [short, branchScope]
      );
      if (ref) return ref.sample_id;
    }
  }
  return null;
}

// For callers that are not already inside a transaction (e.g. the manual
// Acknowledge endpoint, which works on the pool): runs the quiet advance in
// its own short transaction.
export async function advanceSampleInOwnTransaction(pool, args) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const out = await advanceSampleQuietly(connection, args);
    await connection.commit();
    return out;
  } catch (err) {
    await connection.rollback().catch(() => {});
    console.error('Sample lifecycle update failed:', err.message);
    return null;
  } finally {
    connection.release();
  }
}

// Splits a sample already in the lab into child tubes ("aliquots"), each with
// its own barcode (parent ID + -A1, -A2 …), lifecycle and custody history.
// Only a primary sample in the lab (Received / Processing / Stored) can be
// split, and an aliquot can't be split again — one level keeps every ID
// readable and traceable at a glance.
export const ALIQUOTABLE_STAGES = ['Received', 'Processing', 'Stored'];

export async function createAliquots(connection, {
  parent_sample_id, count = 1, purpose = null, volume_ml = null, actor = {}, branchScope = null,
}) {
  const n = Math.floor(Number(count));
  if (!(n >= 1 && n <= 10)) throw Object.assign(new Error('Create between 1 and 10 aliquots at a time.'), { status: 400 });
  if (volume_ml !== null && volume_ml !== '' && !(Number(volume_ml) > 0 && Number(volume_ml) < 1000)) {
    throw Object.assign(new Error('Volume must be a positive number of millilitres.'), { status: 400 });
  }

  const parent = await ensureSample(connection, parent_sample_id, actor);
  if (!parent || !sampleVisibleTo(parent, branchScope)) {
    throw Object.assign(new Error('Sample not found.'), { status: 404 });
  }
  const [[p]] = await connection.query('SELECT * FROM lab_samples WHERE sample_id = ? FOR UPDATE', [parent_sample_id]);

  if (p.parent_sample_id) {
    throw Object.assign(new Error('This is already an aliquot — split the original sample instead.'), { status: 409 });
  }
  if (!ALIQUOTABLE_STAGES.includes(p.stage)) {
    throw Object.assign(
      new Error(`A sample can be split once it is in the lab (Received, Processing or Stored). This one is ${p.stage}.`),
      { status: 409 }
    );
  }

  const [[{ last }]] = await connection.query(
    'SELECT COALESCE(MAX(aliquot_no), 0) AS last FROM lab_samples WHERE parent_sample_id = ?', [parent_sample_id]
  );

  const cleanPurpose = purpose ? String(purpose).trim().slice(0, 80) || null : null;
  const vol = volume_ml === null || volume_ml === '' ? null : Number(volume_ml);
  const created = [];

  for (let i = 1; i <= n; i++) {
    const aliquot_no = last + i;
    const sample_id = `${parent_sample_id}-A${aliquot_no}`;

    // Same cross-facility uniqueness registry as every other sample ID.
    try {
      await connection.query(
        "INSERT INTO lab_sample_ids (sample_id, branch_id, seq_date, dept_key) VALUES (?, ?, CURDATE(), 'ALQ')",
        [sample_id, p.branch_id]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw Object.assign(new Error(`Aliquot ID ${sample_id} already exists.`), { status: 409 });
      throw err;
    }

    await connection.query(
      `INSERT INTO lab_samples (sample_id, branch_id, parent_sample_id, aliquot_no, purpose, volume_ml, stage, received_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Received', NOW())`,
      [sample_id, p.branch_id, parent_sample_id, aliquot_no, cleanPurpose, vol]
    );
    await recordSampleEvent(connection, {
      sample_id, branch_id: p.branch_id, event_type: 'Aliquoted', from_stage: null, to_stage: 'Received',
      note: `Aliquot ${aliquot_no} of ${parent_sample_id}${cleanPurpose ? ` — ${cleanPurpose}` : ''}`,
      actor_id: actor.id || null, actor_role: actor.role || null, ip: actor.ip || null, device: actor.device || null, station: actor.station || null,
    });
    created.push({ sample_id, aliquot_no, purpose: cleanPurpose, volume_ml: vol });
  }

  await recordSampleEvent(connection, {
    sample_id: parent_sample_id, branch_id: p.branch_id, event_type: 'Aliquoted',
    from_stage: p.stage, to_stage: p.stage,
    note: `Split into ${created.map((c) => `A${c.aliquot_no}`).join(', ')}${cleanPurpose ? ` — ${cleanPurpose}` : ''}`,
    actor_id: actor.id || null, actor_role: actor.role || null, ip: actor.ip || null, device: actor.device || null, station: actor.station || null,
  });

  return { parent: p, aliquots: created };
}

// A merge makes some samples' labels redundant: their tests now travel under
// the surviving sample's barcode, so the tubes/labels they were issued for
// are never used. Retire each such sample (unless another test still uses
// it) so it doesn't sit in "Accessioned" forever, and note the surviving
// sample so the log shows what was combined.
export async function recordMerge(connection, { anchor_sample_id, released_sample_ids = [], test_names = [], actor = {} }) {
  const anchor = await ensureSample(connection, anchor_sample_id, actor);
  if (anchor) {
    await recordSampleEvent(connection, {
      sample_id: anchor_sample_id, branch_id: anchor.branch_id, event_type: 'Merged',
      from_stage: anchor.stage, to_stage: anchor.stage,
      note: `Tests combined in one container: ${test_names.join(', ')}`,
      actor_id: actor.id || null, actor_role: actor.role || null, ip: actor.ip || null, device: actor.device || null, station: actor.station || null,
    });
  }

  for (const sid of [...new Set(released_sample_ids)]) {
    if (!sid || sid === anchor_sample_id) continue;
    const [[{ still }]] = await connection.query('SELECT COUNT(*) AS still FROM bill_items WHERE sample_id = ?', [sid]);
    if (Number(still) > 0) continue; // another test still travels under this ID

    const row = await ensureSample(connection, sid, actor).catch(() => null);
    if (!row || row.stage === 'Disposed') continue;
    await connection.query(
      "UPDATE lab_samples SET stage = 'Disposed', disposed_at = NOW(), disposal_method = ? WHERE sample_id = ?",
      [`Label discarded — merged into ${anchor_sample_id}`, sid]
    );
    await recordSampleEvent(connection, {
      sample_id: sid, branch_id: row.branch_id, event_type: 'Merged', from_stage: row.stage, to_stage: 'Disposed',
      note: `Merged into ${anchor_sample_id} — this label is no longer used`,
      actor_id: actor.id || null, actor_role: actor.role || null, ip: actor.ip || null, device: actor.device || null, station: actor.station || null,
    });
  }
}
