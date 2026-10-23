import db from '../config/db.js';
import { logResultAudit } from '../utils/resultAudit.js';
import { actorFromReq } from '../utils/sampleLifecycle.js';

// Critical-result alerts and the documented notification / acknowledgement trail.

const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null);
const parse = (v) => (typeof v === 'string' ? JSON.parse(v || 'null') : v);
const METHODS = ['Phone', 'In person', 'SMS', 'WhatsApp', 'Email', 'Other'];
const OUTCOMES = ['Acknowledged', 'No answer', 'Left message'];

// GET /api/lab/critical-alerts?status=open|all
export const listCriticalAlerts = async (req, res) => {
  try {
    const pin = pinned(req);
    const openOnly = req.query.status !== 'all';
    const [rows] = await db.query(
      `SELECT ca.*, tr.test_name, CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.reg_no, p.telephone,
              (SELECT b.referring_clinician FROM bill_items bi JOIN bills b ON b.id = bi.bill_id WHERE bi.sample_id = ca.sample_id LIMIT 1) AS referring_clinician,
              (SELECT b.referring_facility FROM bill_items bi JOIN bills b ON b.id = bi.bill_id WHERE bi.sample_id = ca.sample_id LIMIT 1) AS referring_facility,
              TIMESTAMPDIFF(MINUTE, ca.raised_at, COALESCE(ca.acknowledged_at, NOW())) AS minutes_open
       FROM critical_alerts ca
       JOIN lab_test_result tr ON tr.id = ca.result_id
       LEFT JOIN patients p ON p.id = ca.patient_id
       WHERE ${openOnly ? "ca.status = 'Open'" : "(ca.status = 'Open' OR ca.raised_at >= CURDATE() - INTERVAL 7 DAY)"} ${pin ? 'AND ca.branch_id = ?' : ''}
       ORDER BY (ca.status = 'Open') DESC, ca.raised_at DESC`,
      pin ? [pin] : []
    );
    const ids = rows.map((r) => r.id);
    const [notes] = ids.length ? await db.query('SELECT * FROM critical_notifications WHERE alert_id IN (?) ORDER BY notified_at ASC, id ASC', [ids]) : [[]];
    const alerts = rows.map((r) => {
      const minutes = Number(r.minutes_open);
      return {
        ...r, parameters: parse(r.parameters), minutes_open: minutes,
        overdue: r.status === 'Open' && minutes > r.notify_within_minutes,
        notifications: notes.filter((n) => n.alert_id === r.id),
      };
    });
    res.json({ success: true, alerts, open: alerts.filter((a) => a.status === 'Open').length, overdue: alerts.filter((a) => a.overdue).length });
  } catch (error) {
    console.error('Error listing critical alerts:', error);
    res.status(500).json({ success: false, message: 'Server error listing critical alerts' });
  }
};

// POST /api/lab/critical-alerts/:id/notify
//   { method, outcome, notified_to_name, notified_to_role, read_back, note, recorded_by_name (LIS-Agent only) }
export const recordCriticalNotification = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const b = req.body || {};
    const method = METHODS.includes(b.method) ? b.method : null;
    const outcome = OUTCOMES.includes(b.outcome) ? b.outcome : null;
    const toName = String(b.notified_to_name || '').trim().slice(0, 200);
    const toRole = String(b.notified_to_role || '').trim().slice(0, 100);
    const note = String(b.note || '').trim().slice(0, 500);
    if (!method) return res.status(400).json({ success: false, message: 'Choose how the clinician was contacted.' });
    if (!outcome) return res.status(400).json({ success: false, message: 'Choose the outcome.' });
    if (outcome === 'Acknowledged') {
      if (toName.length < 3) return res.status(400).json({ success: false, message: 'Enter the name of the person who acknowledged.' });
      if (!b.read_back) return res.status(400).json({ success: false, message: 'Acknowledgement needs the recipient to read the values back — confirm read-back.' });
    }

    // Who is recording this: a signed-in person, or — on a LIS-Agent
    // workstation, which has no personal login — a name typed by the technician.
    let recordedName = null;
    if (req.user?.id) {
      const [[u]] = await connection.query("SELECT CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id = ?", [req.user.id]);
      recordedName = u?.name || null;
    } else {
      recordedName = String(b.recorded_by_name || '').trim().slice(0, 200);
      if (recordedName.length < 3) return res.status(400).json({ success: false, message: 'Enter your name — this is recorded as who made the notification.' });
      recordedName = `${recordedName} (via ${req.user?.device_label || 'workstation'})`;
    }

    await connection.beginTransaction();
    const pin = pinned(req);
    const [[alert]] = await connection.query(
      `SELECT * FROM critical_alerts WHERE id = ? ${pin ? 'AND branch_id = ?' : ''} FOR UPDATE`, pin ? [req.params.id, pin] : [req.params.id]);
    if (!alert) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Alert not found.' }); }
    if (alert.status !== 'Open') { await connection.rollback(); return res.status(409).json({ success: false, message: `This alert is already ${alert.status.toLowerCase()}.` }); }

    await connection.query(
      `INSERT INTO critical_notifications (alert_id, method, outcome, notified_to_name, notified_to_role, read_back, recorded_by, recorded_by_name, recorded_role, note, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [alert.id, method, outcome, toName || null, toRole || null, b.read_back ? 1 : 0, req.user?.id || null, recordedName, req.user?.role || null, note || null, req.ip || null]
    );
    if (outcome === 'Acknowledged') {
      await connection.query("UPDATE critical_alerts SET status = 'Acknowledged', acknowledged_at = NOW(), acknowledged_by_name = ? WHERE id = ?", [toName, alert.id]);
    }
    await logResultAudit(connection, {
      result_id: alert.result_id, sample_id: alert.sample_id, branch_id: alert.branch_id,
      action: outcome === 'Acknowledged' ? 'Critical result acknowledged' : 'Critical result notification attempted',
      actor: actorFromReq(req), version: alert.report_version,
      reason: null, note: `${method} → ${toName || 'clinician'}${toRole ? ` (${toRole})` : ''}: ${outcome}${outcome === 'Acknowledged' ? ' with read-back' : ''}${note ? ` — ${note}` : ''}${req.user?.id ? '' : ` [recorded by ${recordedName}]`}`,
      details: { alert_id: alert.id, recorded_by: recordedName },
    });
    await connection.commit();
    res.json({ success: true, message: outcome === 'Acknowledged' ? 'Acknowledgement documented. The alert is closed.' : 'Attempt recorded. The alert stays open until it is acknowledged.' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Error recording critical notification:', error);
    res.status(500).json({ success: false, message: 'Server error recording notification' });
  } finally {
    connection.release();
  }
};
