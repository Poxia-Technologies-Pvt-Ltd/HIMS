import { logResultAudit } from './resultAudit.js';

// Critical-result alerts: raised when a saved result contains critical
// parameters, cleared automatically if an edit removes them.

const criticalRows = (results) => (results || [])
  .filter((r) => r && (r.result_flag === 'Critical High' || r.result_flag === 'Critical Low'))
  .map((r) => ({ parameter: r.parameter_name, value: r.result_value, unit: r.unit || '', flag: r.result_flag, message: (r.flag_reasons || [])[0]?.message || null }));

const sameSet = (a, b) => JSON.stringify(a.map((x) => `${x.parameter}|${x.value}`).sort()) === JSON.stringify(b.map((x) => `${x.parameter}|${x.value}`).sort());

// Called from saveTestResults with the fully evaluated result list.
export async function syncCriticalAlert(conn, { result_id, sample_id, branch_id, patient_id, report_version, results, workflow, actor = {} }) {
  if (!workflow?.critical_notify) return null;
  const crit = criticalRows(results);
  const [[open]] = await conn.query("SELECT * FROM critical_alerts WHERE result_id = ? AND status IN ('Open','Acknowledged') ORDER BY id DESC LIMIT 1", [result_id]);

  if (crit.length === 0) {
    if (open && open.status === 'Open') {
      await conn.query("UPDATE critical_alerts SET status = 'Cleared', cleared_at = NOW(), cleared_reason = 'Result changed — no longer critical' WHERE id = ?", [open.id]);
      await logResultAudit(conn, { result_id, sample_id, branch_id, action: 'Critical alert cleared', actor, version: report_version, note: 'Result changed — no longer critical' });
    }
    return null;
  }

  let prev = [];
  if (open) { try { prev = typeof open.parameters === 'string' ? JSON.parse(open.parameters) : open.parameters; } catch { prev = []; } }
  if (open && sameSet(prev, crit)) return open.id;                           // nothing new
  if (open && open.status === 'Open') {                                      // still unacknowledged: keep the alert current
    await conn.query('UPDATE critical_alerts SET parameters = ?, report_version = ? WHERE id = ?', [JSON.stringify(crit), report_version || 1, open.id]);
    return open.id;
  }
  const [ins] = await conn.query(
    `INSERT INTO critical_alerts (result_id, sample_id, branch_id, patient_id, report_version, parameters, notify_within_minutes, block_approval)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [result_id, sample_id, branch_id || null, patient_id || null, report_version || 1, JSON.stringify(crit), workflow.critical_notify_minutes || 30, workflow.critical_block_approval ? 1 : 0]
  );
  await logResultAudit(conn, { result_id, sample_id, branch_id, action: 'Critical result raised', actor, version: report_version,
    details: { critical: crit }, note: `Notify the responsible clinician within ${workflow.critical_notify_minutes || 30} minutes` });
  return ins.insertId;
}
