import db from '../config/db.js';
import {
  STAGES, NEXT_STAGES, ALIQUOTABLE_STAGES, actorFromReq, sampleVisibleTo, ensureSample, advanceSample, createAliquots, resolveScannedCode,
} from '../utils/sampleLifecycle.js';

// Non-Central staff are pinned to their own branch from the JWT; a Central
// user may name one, or see everything.
const branchScopeOf = (req) =>
  (req.user?.role_level !== 'Central' ? req.user?.branch_id : (req.query?.branch_id || req.body?.branch_id)) || null;

const actorOf = (req) => actorFromReq(req);

// Everything the tracking screen shows for one sample: its tests (with the
// tube each needs), custody history, its aliquots, and the other samples in
// the same order. An aliquot has no tests of its own — it shows its parent's.
async function describeSample(connection, sample) {
  const baseId = sample.parent_sample_id || sample.sample_id;

  const [tests] = await connection.query(
    `SELECT bi.service_name AS test_name, bi.status, b.priority, b.id AS bill_id,
            lt.sample_type, lt.tube_color,
            CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.reg_no
     FROM bill_items bi
     JOIN bills b ON b.id = bi.bill_id
     LEFT JOIN lab_tests lt ON lt.id = bi.service_id
     LEFT JOIN patients p ON p.id = b.patient_id
     WHERE bi.sample_id = ?`,
    [baseId]
  );
  const [events] = await connection.query(
    'SELECT * FROM sample_events WHERE sample_id = ? ORDER BY created_at ASC, id ASC',
    [sample.sample_id]
  );
  const [aliquots] = await connection.query(
    `SELECT sample_id, aliquot_no, purpose, volume_ml, stage, location
     FROM lab_samples WHERE parent_sample_id = ? ORDER BY aliquot_no`,
    [sample.sample_id]
  );
  const [orderSamples] = tests[0]
    ? await connection.query(
        `SELECT bi.sample_id, s.stage, GROUP_CONCAT(DISTINCT bi.service_name SEPARATOR ', ') AS tests
         FROM bill_items bi LEFT JOIN lab_samples s ON s.sample_id = bi.sample_id
         WHERE bi.bill_id = ? AND bi.sample_id IS NOT NULL AND bi.sample_id <> ?
         GROUP BY bi.sample_id, s.stage ORDER BY bi.sample_id`,
        [tests[0].bill_id, baseId]
      )
    : [[]];

  return {
    ...sample,
    patient_name: tests[0]?.patient_name || null,
    reg_no: tests[0]?.reg_no || null,
    priority: tests.some((t) => t.priority === 'STAT') ? 'STAT' : tests.some((t) => t.priority === 'Urgent') ? 'Urgent' : 'Routine',
    tests: tests.map((t) => ({ test_name: t.test_name, status: t.status, sample_type: t.sample_type, tube_color: t.tube_color })),
    next_stages: NEXT_STAGES[sample.stage] || [],
    can_aliquot: !sample.parent_sample_id && ALIQUOTABLE_STAGES.includes(sample.stage),
    aliquots,
    order_samples: orderSamples,
    events,
  };
}

// GET /api/lab/samples/lookup?code= — what is this sample and where is it?
export const lookupSample = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const scope = branchScopeOf(req);
    const sample_id = await resolveScannedCode(connection, req.query.code, scope);
    if (!sample_id) return res.status(404).json({ success: false, message: 'No sample found for that barcode.' });

    await connection.beginTransaction();
    const sample = await ensureSample(connection, sample_id, actorOf(req));
    await connection.commit();
    if (!sample || !sampleVisibleTo(sample, scope)) {
      return res.status(404).json({ success: false, message: 'No sample found for that barcode.' });
    }
    res.json({ success: true, sample: await describeSample(connection, sample) });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Error looking up sample:', error);
    res.status(500).json({ success: false, message: 'Server error looking up sample' });
  } finally {
    connection.release();
  }
};

// POST /api/lab/samples/scan { code, to, location?, note? } — a station scans a
// barcode and moves the sample to the next stage. Strict: one step forward,
// logged with who/where/when.
export const scanSample = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { code, to, location, note } = req.body;
    if (!STAGES.includes(to) || to === 'Accessioned') {
      return res.status(400).json({ success: false, message: `"to" must be one of: ${STAGES.slice(1).join(', ')}.` });
    }
    const scope = branchScopeOf(req);
    const sample_id = await resolveScannedCode(connection, code, scope);
    if (!sample_id) return res.status(404).json({ success: false, message: 'No sample found for that barcode.' });

    await connection.beginTransaction();
    const out = await advanceSample(connection, {
      sample_id, to,
      location: location?.trim() || null,
      note: note?.trim() || null,
      actor: actorOf(req), branchScope: scope,
    });
    await connection.commit();

    res.json({
      success: true,
      changed: out.changed,
      message: out.changed ? `${sample_id} → ${to}` : `${sample_id} is already ${to}.`,
      sample: await describeSample(connection, out.sample),
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message, current_stage: error.from, allowed: error.allowed });
    }
    console.error('Error scanning sample:', error);
    res.status(500).json({ success: false, message: 'Server error updating sample' });
  } finally {
    connection.release();
  }
};

// GET /api/lab/samples?stage=&search=&days= — the tracking board: every
// tracked sample from the last N days plus anything not yet disposed
// (so a tube sitting in a freezer for a month still shows up).
export const listSamples = async (req, res) => {
  try {
    const scope = branchScopeOf(req);
    const days = Math.min(Math.max(Number(req.query.days) || 1, 1), 90);
    const { stage, search } = req.query;

    let base = `WHERE (s.accessioned_at >= CURDATE() - INTERVAL ? DAY OR s.stage <> 'Disposed')`;
    const params = [days - 1];
    if (scope) { base += ' AND (s.branch_id = ? OR s.holder_branch_id = ?)'; params.push(scope, scope); }

    const [counts] = await db.query(`SELECT s.stage, COUNT(*) AS n FROM lab_samples s ${base} GROUP BY s.stage`, params);
    const summary = Object.fromEntries(STAGES.map((st) => [st, 0]));
    counts.forEach((c) => { summary[c.stage] = c.n; });

    let where = base;
    const p2 = [...params];
    if (stage)  { where += ' AND s.stage = ?'; p2.push(stage); }
    if (search) {
      where += ` AND (s.sample_id LIKE ? OR s.location LIKE ? OR EXISTS (
        SELECT 1 FROM bill_items bi JOIN bills b ON b.id = bi.bill_id JOIN patients p ON p.id = b.patient_id
        WHERE bi.sample_id = s.sample_id AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.reg_no LIKE ?)))`;
      const q = `%${search}%`;
      p2.push(q, q, q, q, q);
    }

    const [samples] = await db.query(
      `SELECT s.*,
         (SELECT GROUP_CONCAT(DISTINCT bi.service_name SEPARATOR ', ') FROM bill_items bi WHERE bi.sample_id = s.sample_id) AS tests,
         (SELECT CONCAT(p.first_name, ' ', p.last_name) FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
            JOIN patients p ON p.id = b.patient_id WHERE bi.sample_id = s.sample_id LIMIT 1) AS patient_name
       FROM lab_samples s ${where}
       ORDER BY s.updated_at DESC LIMIT 300`,
      p2
    );
    res.json({ success: true, samples, summary });
  } catch (error) {
    console.error('Error listing samples:', error);
    res.status(500).json({ success: false, message: 'Server error listing samples' });
  }
};

// GET /api/lab/samples/events — the custody log across samples (who/where/when).
export const listSampleEvents = async (req, res) => {
  try {
    const scope = branchScopeOf(req);
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_to || '') ? req.query.date_to : new Date().toISOString().slice(0, 10);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_from || '') ? req.query.date_from : to;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let where = 'WHERE DATE(e.created_at) BETWEEN ? AND ?';
    const params = [from, to];
    if (scope) { where += ' AND e.branch_id = ?'; params.push(scope); }
    if (req.query.sample) { where += ' AND e.sample_id LIKE ?'; params.push(`%${req.query.sample}%`); }
    if (req.query.event_type) { where += ' AND e.event_type = ?'; params.push(req.query.event_type); }
    if (req.query.actor) { where += ' AND e.actor_name LIKE ?'; params.push(`%${req.query.actor}%`); }

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM sample_events e ${where}`, params);
    const [events] = await db.query(
      `SELECT e.* FROM sample_events e ${where} ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ success: true, events, total });
  } catch (error) {
    console.error('Error listing sample events:', error);
    res.status(500).json({ success: false, message: 'Server error listing sample events' });
  }
};

// POST /api/lab/samples/:sample_id/aliquots { count, purpose?, volume_ml? } —
// split a sample in the lab into labelled child tubes.
export const makeAliquots = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const scope = branchScopeOf(req);
    const sample_id = await resolveScannedCode(connection, req.params.sample_id, scope);
    if (!sample_id) return res.status(404).json({ success: false, message: 'No sample found for that barcode.' });

    await connection.beginTransaction();
    const out = await createAliquots(connection, {
      parent_sample_id: sample_id,
      count: req.body.count,
      purpose: req.body.purpose,
      volume_ml: req.body.volume_ml,
      actor: actorOf(req), branchScope: scope,
    });
    await connection.commit();

    const [[parent]] = await connection.query('SELECT * FROM lab_samples WHERE sample_id = ?', [sample_id]);
    res.status(201).json({
      success: true,
      message: `${out.aliquots.length} aliquot${out.aliquots.length > 1 ? 's' : ''} created.`,
      created: out.aliquots,
      sample: await describeSample(connection, parent),
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error('Error creating aliquots:', error);
    res.status(500).json({ success: false, message: 'Server error creating aliquots' });
  } finally {
    connection.release();
  }
};

// GET /api/lab/samples/custody?code= — the full chain of custody for one
// sample (and its aliquots), oldest first, with the time each step took. Feeds
// the printable custody report.
export const getCustodyReport = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const scope = branchScopeOf(req);
    const sample_id = await resolveScannedCode(connection, req.query.code, scope);
    if (!sample_id) return res.status(404).json({ success: false, message: 'No sample found for that barcode.' });
    const sample = await ensureSample(connection, sample_id, actorFromReq(req));
    if (!sample || !sampleVisibleTo(sample, scope)) {
      return res.status(404).json({ success: false, message: 'No sample found for that barcode.' });
    }
    const [[facility]] = await connection.query('SELECT branch_name, hospital_code FROM branches WHERE id = ?', [sample.branch_id]);
    const [[patient]] = await connection.query(
      `SELECT CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.reg_no
       FROM bill_items bi JOIN bills b ON b.id = bi.bill_id JOIN patients p ON p.id = b.patient_id
       WHERE bi.sample_id = ? LIMIT 1`, [sample.parent_sample_id || sample_id]
    );
    const [events] = await connection.query(
      `SELECT id, sample_id, event_type, from_stage, to_stage, location, station, note, auto,
              actor_name, actor_role, ip_address, created_at
       FROM sample_events
       WHERE sample_id = ? OR sample_id IN (SELECT sample_id FROM lab_samples WHERE parent_sample_id = ?)
       ORDER BY created_at ASC, id ASC`,
      [sample_id, sample_id]
    );
    let prev = null;
    const steps = events.map((e) => {
      const t = new Date(e.created_at).getTime();
      const out = { ...e, seconds_since_previous: prev && e.sample_id === sample_id ? Math.round((t - prev) / 1000) : null };
      if (e.sample_id === sample_id) prev = t;
      return out;
    });
    res.json({ success: true, report: { sample_id, stage: sample.stage, facility, ...patient, generated_at: new Date(), steps } });
  } catch (error) {
    console.error('Error building custody report:', error);
    res.status(500).json({ success: false, message: 'Server error building custody report' });
  } finally {
    connection.release();
  }
};
