import db from '../config/db.js';
import { SERVICE_POINTS, ALLOWED_TRANSITIONS, recordTokenEvent, eventTypeFor } from '../utils/queueTokens.js';

// Non-Central staff are pinned to their own branch from the JWT; Central
// users may name one, and otherwise it falls back to the only branch that
// exists (single-facility deployments).
async function resolveBranch(req) {
  const fromJwt = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
  let branch_id = fromJwt || req.body?.branch_id || req.query?.branch_id || null;
  if (!branch_id) {
    const [rows] = await db.query('SELECT id FROM branches LIMIT 2');
    if (rows.length === 1) branch_id = rows[0].id;
  }
  return branch_id;
}

// GET /api/queue/tokens?service_point=&status= — today's tokens, STAT/Urgent
// first, then by issue order.
export const listTokens = async (req, res) => {
  try {
    const { service_point, status } = req.query;
    const branch_id = await resolveBranch(req);
    if (!branch_id) return res.json({ success: true, tokens: [], summary: {} });

    let query = `SELECT t.*, CONCAT(u.first_name, ' ', u.last_name) AS issued_by_name
                 FROM patient_queue_tokens t
                 LEFT JOIN users u ON u.id = t.issued_by
                 WHERE t.branch_id = ? AND t.token_date = CURDATE()`;
    const params = [branch_id];
    if (service_point) { query += ' AND t.service_point = ?'; params.push(service_point); }
    if (status)        { query += ' AND t.status = ?';        params.push(status); }
    query += ` ORDER BY FIELD(t.priority, 'STAT', 'Urgent', 'Routine'), t.seq ASC`;

    const [tokens] = await db.query(query, params);

    const summary = {};
    for (const t of tokens) {
      const s = (summary[t.service_point] ||= { Waiting: 0, Called: 0, 'In Service': 0, Completed: 0, Skipped: 0, Cancelled: 0 });
      s[t.status] += 1;
    }
    res.json({ success: true, tokens, summary });
  } catch (error) {
    console.error('Error listing queue tokens:', error);
    res.status(500).json({ success: false, message: 'Server error listing tokens' });
  }
};

// PUT /api/queue/tokens/:id/status — move a token through its lifecycle.
// The state change and its audit event commit together or not at all, and
// the token row is locked for the duration so two operators clicking at once
// can't both "call" it.
export const updateTokenStatus = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    const { status, counter } = req.body;

    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    await connection.beginTransaction();

    const [[token]] = await connection.query(
      `SELECT * FROM patient_queue_tokens WHERE id = ? ${scope ? 'AND branch_id = ?' : ''} FOR UPDATE`,
      scope ? [id, scope] : [id]
    );
    if (!token) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Token not found.' });
    }
    if (!(ALLOWED_TRANSITIONS[token.status] || []).includes(status)) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: `Cannot move a token from "${token.status}" to "${status}".` });
    }

    const sets = ['status = ?'];
    const values = [status];
    if (status === 'Called') {
      sets.push('called_at = NOW()', 'called_by = ?', 'counter = COALESCE(?, counter)');
      values.push(req.user?.id || null, counter || null);
    }
    if (status === 'In Service') sets.push('started_at = NOW()');
    if (status === 'Completed')  sets.push('completed_at = NOW()');
    values.push(id);
    await connection.query(`UPDATE patient_queue_tokens SET ${sets.join(', ')} WHERE id = ?`, values);

    await recordTokenEvent(connection, {
      token_id: token.id, branch_id: token.branch_id, service_point: token.service_point,
      token_number: token.token_number,
      event_type: eventTypeFor(token.status, status),
      from_status: token.status, to_status: status,
      counter: status === 'Called' ? (counter || token.counter || null) : (token.counter || null),
      actor_id: req.user?.id || null, actor_role: req.user?.role || null, ip: req.ip,
    });

    await connection.commit();
    res.json({ success: true, message: `Token marked ${status}.` });
  } catch (error) {
    await connection.rollback();
    console.error('Error updating queue token:', error);
    res.status(500).json({ success: false, message: 'Server error updating token' });
  } finally {
    connection.release();
  }
};

// ── Audit ────────────────────────────────────────────────────────────────
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);

function auditRange(req) {
  const to = isoDate(req.query.date_to) || new Date().toISOString().slice(0, 10);
  const from = isoDate(req.query.date_from) || to;
  return { from, to };
}

// GET /api/queue/audit/events — the raw append-only log: every issue, call,
// recall, start, completion, skip and cancellation, with who and when.
export const getAuditEvents = async (req, res) => {
  try {
    const branch_id = await resolveBranch(req);
    if (!branch_id) return res.json({ success: true, events: [], total: 0 });
    const { from, to } = auditRange(req);
    const { token, event_type, actor } = req.query;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let where = 'WHERE e.branch_id = ? AND DATE(e.created_at) BETWEEN ? AND ?';
    const params = [branch_id, from, to];
    if (token)      { where += ' AND e.token_number = ?'; params.push(String(token)); }
    if (event_type) { where += ' AND e.event_type = ?';   params.push(event_type); }
    if (actor)      { where += ' AND e.actor_name LIKE ?'; params.push(`%${actor}%`); }

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM queue_token_events e ${where}`, params);
    const [events] = await db.query(
      `SELECT e.*, t.patient_name, t.patient_reg_no, t.priority
       FROM queue_token_events e
       LEFT JOIN patient_queue_tokens t ON t.id = e.token_id
       ${where}
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ success: true, events, total });
  } catch (error) {
    console.error('Error fetching queue audit events:', error);
    res.status(500).json({ success: false, message: 'Server error fetching audit events' });
  }
};

// GET /api/queue/audit/tokens — one row per token with its full journey and
// the derived timings: waited (issued -> first called), service (started ->
// completed), and total turnaround.
export const getAuditTokens = async (req, res) => {
  try {
    const branch_id = await resolveBranch(req);
    if (!branch_id) return res.json({ success: true, tokens: [] });
    const { from, to } = auditRange(req);
    const { token, status } = req.query;

    let where = 'WHERE t.branch_id = ? AND t.token_date BETWEEN ? AND ?';
    const params = [branch_id, from, to];
    if (token)  { where += ' AND t.token_number = ?'; params.push(String(token)); }
    if (status) { where += ' AND t.status = ?';       params.push(status); }

    const [tokens] = await db.query(
      `SELECT t.id, t.token_date, t.service_point, t.token_number, t.patient_name, t.patient_reg_no,
              t.bill_id, t.priority, t.status, t.counter,
              t.issued_at, t.called_at, t.started_at, t.completed_at,
              CONCAT(ui.first_name, ' ', ui.last_name) AS issued_by_name,
              CONCAT(uc.first_name, ' ', uc.last_name) AS called_by_name,
              TIMESTAMPDIFF(MINUTE, t.issued_at, t.called_at)     AS wait_minutes,
              TIMESTAMPDIFF(MINUTE, t.started_at, t.completed_at) AS service_minutes,
              TIMESTAMPDIFF(MINUTE, t.issued_at, t.completed_at)  AS total_minutes,
              (SELECT COUNT(*) FROM queue_token_events e WHERE e.token_id = t.id) AS event_count
       FROM patient_queue_tokens t
       LEFT JOIN users ui ON ui.id = t.issued_by
       LEFT JOIN users uc ON uc.id = t.called_by
       ${where}
       ORDER BY t.token_date DESC, t.seq DESC
       LIMIT 1000`,
      params
    );
    res.json({ success: true, tokens });
  } catch (error) {
    console.error('Error fetching queue audit tokens:', error);
    res.status(500).json({ success: false, message: 'Server error fetching audit tokens' });
  }
};

// GET /api/lab/kiosk-tokens?branch_id= — PUBLIC, for the lobby TV. Token
// numbers, counters and status only: no patient names or reg numbers, since
// this is read by a screen anyone in the waiting room can see.
export const getPublicTokenBoard = async (req, res) => {
  try {
    let branch_id = req.query.branch_id;
    if (!branch_id) {
      const [rows] = await db.query('SELECT id FROM branches LIMIT 2');
      if (rows.length === 1) branch_id = rows[0].id;
    }
    if (!branch_id) return res.json({ success: true, boards: {} });

    const [rows] = await db.query(
      `SELECT service_point, token_number, status, counter, priority
       FROM patient_queue_tokens
       WHERE branch_id = ? AND token_date = CURDATE()
         AND status IN ('Called', 'In Service', 'Waiting')
       ORDER BY FIELD(priority, 'STAT', 'Urgent', 'Routine'), seq ASC`,
      [branch_id]
    );

    const boards = {};
    for (const sp of SERVICE_POINTS) {
      const mine = rows.filter((r) => r.service_point === sp);
      boards[sp] = {
        serving: mine.filter((r) => r.status !== 'Waiting').map(({ token_number, counter, status }) => ({ token_number, counter, status })),
        waiting: mine.filter((r) => r.status === 'Waiting').slice(0, 8).map(({ token_number, priority }) => ({ token_number, priority })),
        waiting_count: mine.filter((r) => r.status === 'Waiting').length,
      };
    }
    res.json({ success: true, boards });
  } catch (error) {
    console.error('Error building public token board:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
