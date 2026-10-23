import db from '../config/db.js';
import { ensureSample, advanceSample, recordSampleEvent, actorFromReq } from '../utils/sampleLifecycle.js';

// The Sample Collection desk: the list of today's orders waiting at the
// collection point, one order's tests and barcodes, label reprints and
// marking an order collected. (Merging tests into one container is
// POST /lab/merge-samples — mergeSamplesController.js.)

const branchScopeOf = (req) =>
  (req.user?.role_level !== 'Central' ? req.user?.branch_id : (req.query?.branch_id || req.body?.branch_id)) || null;
const actorOf = (req) => actorFromReq(req);

// GET /api/lab/collection/orders — today's orders with lab tests, in queue
// order (STAT/Urgent first, then token number).
export const listCollectionOrders = async (req, res) => {
  try {
    const scope = branchScopeOf(req);
    const { search } = req.query;

    let where = `WHERE DATE(b.created_at) = CURDATE() AND b.status = 'Active'`;
    const params = [];
    if (scope) { where += ' AND b.branch_id = ?'; params.push(scope); }
    if (search) {
      where += ' AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.reg_no LIKE ? OR p.telephone LIKE ? OR qt.token_number = ?)';
      const q = `%${search}%`;
      params.push(q, q, q, q, String(search).trim());
    }

    const [orders] = await db.query(
      `SELECT b.id AS bill_id, b.bill_number, b.priority, b.created_at,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.reg_no,
              qt.token_number, qt.status AS token_status,
              COUNT(bi.id) AS test_count,
              COUNT(DISTINCT bi.sample_id) AS sample_count,
              SUM(CASE WHEN s.stage IS NOT NULL AND s.stage <> 'Accessioned' THEN 1 ELSE 0 END) AS tests_collected,
              GROUP_CONCAT(DISTINCT bi.service_name ORDER BY bi.id SEPARATOR ', ') AS tests,
              (SELECT COUNT(*) FROM sample_rejections r WHERE r.bill_id = b.id AND r.status = 'Recollection Pending') AS recollections
       FROM bills b
       JOIN bill_items bi ON bi.bill_id = b.id AND bi.service_type = 'Laboratory'
       JOIN patients p ON p.id = b.patient_id
       LEFT JOIN patient_queue_tokens qt ON qt.bill_id = b.id AND qt.service_point = 'Sample Collection'
       LEFT JOIN lab_samples s ON s.sample_id = bi.sample_id
       ${where}
       GROUP BY b.id, qt.id
       ORDER BY FIELD(b.priority, 'STAT', 'Urgent', 'Routine'), COALESCE(qt.seq, 999999), b.created_at`,
      params
    );

    res.json({
      success: true,
      orders: orders.map((o) => ({
        ...o,
        test_count: Number(o.test_count),
        sample_count: Number(o.sample_count),
        recollections: Number(o.recollections),
        collected: Number(o.tests_collected) >= Number(o.test_count),
      })),
    });
  } catch (error) {
    console.error('Error listing collection orders:', error);
    res.status(500).json({ success: false, message: 'Server error listing orders' });
  }
};

// GET /api/lab/collection/orders/:bill_id — the order's tests grouped by the
// container (barcode) they travel in.
async function loadOrder(connection, bill_id, scope) {
  const [[bill]] = await connection.query(
    `SELECT b.id AS bill_id, b.bill_number, b.priority, b.branch_id, b.clinical_notes, b.created_at,
            CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.reg_no, p.gender, p.dob,
            qt.token_number, qt.status AS token_status
     FROM bills b JOIN patients p ON p.id = b.patient_id
     LEFT JOIN patient_queue_tokens qt ON qt.bill_id = b.id AND qt.service_point = 'Sample Collection'
     WHERE b.id = ? ${scope ? 'AND b.branch_id = ?' : ''}`,
    scope ? [bill_id, scope] : [bill_id]
  );
  if (!bill) return null;

  const [tests] = await connection.query(
    `SELECT bi.id AS bill_item_id, bi.service_name AS test_name, bi.sample_id, bi.short_id, bi.status,
            bi.merged_at, lt.sample_type, lt.tube_color,
            (SELECT COUNT(*) FROM lab_test_result r WHERE r.bill_item_id = bi.id OR r.sample_id = bi.sample_id) AS has_result,
            s.stage, rj.reason_label AS recollect_reason, rj.sample_id AS recollect_of, rj.rejected_at AS recollect_since
     FROM bill_items bi
     LEFT JOIN sample_rejections rj ON rj.recollect_sample_id = bi.sample_id AND rj.status = 'Recollection Pending'
     LEFT JOIN lab_tests lt ON lt.id = bi.service_id
     LEFT JOIN lab_samples s ON s.sample_id = bi.sample_id
     WHERE bi.bill_id = ? AND bi.service_type = 'Laboratory'
     ORDER BY bi.id`,
    [bill_id]
  );

  const containers = new Map();
  for (const t of tests) {
    const key = t.sample_id || `item-${t.bill_item_id}`;
    if (!containers.has(key)) {
      containers.set(key, {
        sample_id: t.sample_id, short_id: t.short_id, stage: t.stage || 'Accessioned',
        sample_type: t.sample_type, tube_color: t.tube_color, tests: [],
        recollection: t.recollect_of ? { reason: t.recollect_reason, of: t.recollect_of, since: t.recollect_since } : null,
      });
    }
    containers.get(key).tests.push({
      bill_item_id: t.bill_item_id, test_name: t.test_name, has_result: Number(t.has_result) > 0,
      sample_type: t.sample_type, tube_color: t.tube_color,
    });
  }
  const list = [...containers.values()].map((c) => ({ ...c, merged: c.tests.length > 1 }));
  return { ...bill, tests: tests.length, containers: list };
}

export const getCollectionOrder = async (req, res) => {
  try {
    const order = await loadOrder(db, req.params.bill_id, branchScopeOf(req));
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    res.json({ success: true, order });
  } catch (error) {
    console.error('Error loading collection order:', error);
    res.status(500).json({ success: false, message: 'Server error loading order' });
  }
};

// POST /api/lab/collection/orders/:bill_id/collect — the collector has drawn
// the specimens: every container in the order moves Accessioned -> Collected.
export const collectOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const scope = branchScopeOf(req);
    // The LIS-Agent can mark an order collected while offline and sync it later,
    // sending when it really happened. Anything in the future, or older than a
    // week, is not believed and the server's own clock is used instead.
    const claimed = req.body?.collected_at ? new Date(req.body.collected_at) : null;
    const now = Date.now();
    const at = claimed && !Number.isNaN(claimed.getTime()) && claimed.getTime() <= now + 5 * 60 * 1000 && claimed.getTime() >= now - 7 * 24 * 3600 * 1000
      ? claimed : null;
    const note = at && req.body?.offline
      ? `Collected at the sample collection desk — recorded offline at ${at.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })}, synced later`
      : 'Collected at the sample collection desk';
    const order = await loadOrder(connection, req.params.bill_id, scope);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    await connection.beginTransaction();
    let moved = 0;
    for (const c of order.containers) {
      if (!c.sample_id) continue;
      await ensureSample(connection, c.sample_id, actorOf(req));
      const out = await advanceSample(connection, {
        sample_id: c.sample_id, to: 'Collected', note,
        actor: actorOf(req), branchScope: scope, at,
      }).catch((e) => { if (e.status === 409) return null; throw e; }); // already past Collected
      if (out?.changed) moved += 1;
    }
    await connection.commit();
    res.json({ success: true, message: moved ? `${moved} container${moved > 1 ? 's' : ''} marked collected.` : 'Already collected.', order: await loadOrder(db, req.params.bill_id, scope) });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Error collecting order:', error);
    res.status(500).json({ success: false, message: 'Server error marking collected' });
  } finally {
    connection.release();
  }
};

// GET /api/lab/collection/snapshot — today's orders with their containers
// (sample IDs, tubes) in one call, for the LIS-Agent to keep on the machine
// so the collection desk still works when the network drops (tender #59).
export const collectionSnapshot = async (req, res) => {
  try {
    const scope = branchScopeOf(req);
    const [rows] = await db.query(
      `SELECT DISTINCT b.id AS bill_id FROM bills b
         JOIN bill_items bi ON bi.bill_id = b.id AND bi.service_type = 'Laboratory'
        WHERE DATE(b.created_at) = CURDATE() AND b.status = 'Active' AND b.payment_status <> 'Cancelled' AND b.order_state = 'Confirmed'
          ${scope ? 'AND b.branch_id = ?' : ''} ORDER BY b.id DESC LIMIT 400`, scope ? [scope] : []);
    const orders = [];
    for (const r of rows) {
      // eslint-disable-next-line no-await-in-loop
      const o = await loadOrder(db, r.bill_id, scope);
      if (o) orders.push(o);
    }
    res.json({ success: true, generated_at: new Date().toISOString(), orders });
  } catch (error) {
    console.error('Error building collection snapshot:', error);
    res.status(500).json({ success: false, message: 'Server error building snapshot' });
  }
};

// POST /api/lab/collection/reprint { sample_id } — logs that a label was
// printed again (a duplicate of something identifying a patient's blood) and
// returns what the label should carry.
export const logReprint = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const scope = branchScopeOf(req);
    const sample_id = String(req.body.sample_id || '').trim();
    const [[row]] = await connection.query(
      `SELECT bi.bill_id FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
       WHERE bi.sample_id = ? ${scope ? 'AND b.branch_id = ?' : ''} LIMIT 1`,
      scope ? [sample_id, scope] : [sample_id]
    );
    if (!row) return res.status(404).json({ success: false, message: 'Sample not found.' });

    await connection.beginTransaction();
    const sample = await ensureSample(connection, sample_id, actorOf(req));
    await recordSampleEvent(connection, {
      sample_id, branch_id: sample.branch_id, event_type: 'Reprinted',
      from_stage: sample.stage, to_stage: sample.stage, note: 'Barcode label printed again',
      actor_id: actorOf(req).id, actor_role: actorOf(req).role, ip: req.ip, device: actorOf(req).device,
    });
    await connection.commit();
    res.json({ success: true });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Error logging reprint:', error);
    res.status(500).json({ success: false, message: 'Server error logging reprint' });
  } finally {
    connection.release();
  }
};
