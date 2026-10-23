import db from '../config/db.js';
import { evaluateWestgard, sdiPerformance, ALL_RULES } from '../utils/westgard.js';

// Quality management (tender #63-70, #88-90): IQC with Westgard rules and
// Levey-Jennings data, EQAS records, and the quality / TAT dashboard that
// rolls up turnaround, rejection, critical-result, QC, EQAS and equipment
// indicators — per facility, and compared across facilities for district and
// state users.

const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null);
const scopeBranch = (req) => pinned(req) || (req.query.branch_id && req.query.branch_id !== 'all' ? Number(req.query.branch_id) : null);

async function actorName(id) {
  if (!id) return null;
  const [[u]] = await db.query("SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [id]);
  return u?.name || null;
}

const p2 = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const range = (q, defaultDays = 30) => {
  const to = q.to || localYmd(new Date());
  const from = q.from || localYmd(new Date(Date.now() - (defaultDays - 1) * 86400000));
  return { from, to, fromTs: `${from} 00:00:00`, toTs: `${to} 23:59:59` };
};

const fail = (res, error, what) => {
  console.error(`${what}:`, error);
  res.status(500).json({ success: false, message: `Server error ${what}` });
};

// ── Options for the forms ───────────────────────────────────────────────────

export const getOptions = async (req, res) => {
  try {
    const pin = pinned(req);
    const [machines] = await db.query(
      `SELECT m.id, m.name, m.model, m.manufacturer, m.serial_number, i.branch_id, i.name AS lab_name
         FROM lab_machines m LEFT JOIN infrastructure i ON i.id = m.lab_id
        ${pin ? 'WHERE i.branch_id = ?' : ''} ORDER BY m.name`, pin ? [pin] : []);
    const [tests] = await db.query("SELECT id, test_name, test_code FROM lab_tests WHERE status = 'Active' ORDER BY test_name");
    const [branches] = pin ? [[]] : await db.query("SELECT id, branch_name FROM branches WHERE status = 'Active' ORDER BY branch_name");
    res.json({ success: true, machines, tests, branches, rules: ALL_RULES });
  } catch (error) { fail(res, error, 'loading options'); }
};

// ── IQC materials ───────────────────────────────────────────────────────────

export const listMaterials = async (req, res) => {
  try {
    const branch = scopeBranch(req);
    const showInactive = req.query.active === 'all';
    const [rows] = await db.query(
      `SELECT qm.*, m.name AS machine_name, lt.test_name,
              lr.value AS latest_value, lr.z_score AS latest_z, lr.status AS latest_status, lr.violations AS latest_violations, lr.run_at AS latest_run_at,
              (SELECT COUNT(*) FROM qc_runs r WHERE r.material_id = qm.id AND r.run_at >= CURDATE() - INTERVAL 30 DAY) AS runs_30d,
              (SELECT COUNT(*) FROM qc_runs r WHERE r.material_id = qm.id AND r.status = 'Rejected' AND r.run_at >= CURDATE() - INTERVAL 30 DAY) AS rejected_30d
         FROM qc_materials qm
         LEFT JOIN lab_machines m ON m.id = qm.machine_id
         LEFT JOIN lab_tests lt ON lt.id = qm.test_id
         LEFT JOIN qc_runs lr ON lr.id = (SELECT r.id FROM qc_runs r WHERE r.material_id = qm.id ORDER BY r.run_at DESC, r.id DESC LIMIT 1)
        WHERE 1=1 ${branch ? 'AND qm.branch_id = ?' : ''} ${showInactive ? '' : 'AND qm.active = 1'}
        ORDER BY m.name, qm.parameter_name, qm.level`, branch ? [branch] : []);
    res.json({ success: true, materials: rows });
  } catch (error) { fail(res, error, 'loading QC materials'); }
};

const cleanRules = (rules) => {
  const list = (Array.isArray(rules) ? rules : String(rules || '').split(',')).map((r) => r.trim()).filter((r) => ALL_RULES.includes(r));
  return (list.length ? list : ALL_RULES).join(',');
};

export const createMaterial = async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.parameter_name?.trim() || !b.material_name?.trim() || !b.lot_no?.trim()) {
      return res.status(400).json({ success: false, message: 'Parameter, control material and lot number are required.' });
    }
    const mean = Number(b.target_mean); const sd = Number(b.target_sd);
    if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0) {
      return res.status(400).json({ success: false, message: 'Target mean and a positive target SD are required.' });
    }
    const branchId = pinned(req) || b.branch_id || req.user?.branch_id || null;
    const [r] = await db.query(
      `INSERT INTO qc_materials (branch_id, machine_id, test_id, parameter_name, unit, material_name, lot_no, level, target_mean, target_sd, expiry_date, rules, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [branchId, b.machine_id || null, b.test_id || null, b.parameter_name.trim(), b.unit?.trim() || null, b.material_name.trim(),
       b.lot_no.trim(), b.level || 'Level 1', mean, sd, b.expiry_date || null, cleanRules(b.rules), req.user?.id || null]
    );
    res.status(201).json({ success: true, id: r.insertId, message: 'Control material added.' });
  } catch (error) { fail(res, error, 'adding QC material'); }
};

export const updateMaterial = async (req, res) => {
  try {
    const b = req.body || {};
    const sets = []; const vals = [];
    const put = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
    if (b.expiry_date !== undefined) put('expiry_date', b.expiry_date || null);
    if (b.active !== undefined) put('active', b.active ? 1 : 0);
    if (b.rules !== undefined) put('rules', cleanRules(b.rules));
    if (b.target_mean !== undefined || b.target_sd !== undefined) {
      const mean = Number(b.target_mean); const sd = Number(b.target_sd);
      if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0) {
        return res.status(400).json({ success: false, message: 'Target mean and a positive target SD are required.' });
      }
      put('target_mean', mean); put('target_sd', sd);
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update.' });
    const pin = pinned(req);
    const [r] = await db.query(`UPDATE qc_materials SET ${sets.join(', ')} WHERE id = ? ${pin ? 'AND branch_id = ?' : ''}`,
      [...vals, req.params.id, ...(pin ? [pin] : [])]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Control material not found.' });
    res.json({ success: true, message: 'Control material updated.' });
  } catch (error) { fail(res, error, 'updating QC material'); }
};

async function materialInScope(req, id) {
  const pin = pinned(req);
  const [[m]] = await db.query(`SELECT * FROM qc_materials WHERE id = ? ${pin ? 'AND branch_id = ?' : ''}`, pin ? [id, pin] : [id]);
  return m || null;
}

// ── IQC runs ────────────────────────────────────────────────────────────────

// GET /materials/:id/runs?days=30 — the Levey-Jennings series.
export const listRuns = async (req, res) => {
  try {
    const m = await materialInScope(req, req.params.id);
    if (!m) return res.status(404).json({ success: false, message: 'Control material not found.' });
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const [runs] = await db.query(
      `SELECT * FROM qc_runs WHERE material_id = ? AND run_at >= NOW() - INTERVAL ? DAY ORDER BY run_at ASC, id ASC`, [m.id, days]);
    const values = runs.map((r) => Number(r.value));
    const n = values.length;
    const mean = n ? values.reduce((a, v) => a + v, 0) / n : null;
    const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : null;
    res.json({
      success: true, material: m, runs,
      observed: { n, mean, sd, cv: mean && sd ? (sd / mean) * 100 : null },
    });
  } catch (error) { fail(res, error, 'loading QC runs'); }
};

// POST /runs { material_id, value, run_at?, corrective_action? }
export const recordRun = async (req, res) => {
  try {
    const { material_id, value, run_at, corrective_action } = req.body || {};
    const m = await materialInScope(req, material_id);
    if (!m) return res.status(404).json({ success: false, message: 'Control material not found.' });
    if (!m.active) return res.status(400).json({ success: false, message: 'This control lot has been retired.' });
    const v = Number(value);
    if (!Number.isFinite(v)) return res.status(400).json({ success: false, message: 'A numeric control value is required.' });

    const when = run_at ? new Date(run_at) : new Date();
    if (Number.isNaN(when.getTime())) return res.status(400).json({ success: false, message: 'Invalid run time.' });
    // Whole seconds: DATETIME rounds fractions, which could otherwise store an
    // earlier run a second *after* this one and drop it from the history below.
    when.setMilliseconds(0);
    const [prev] = await db.query(
      'SELECT z_score FROM qc_runs WHERE material_id = ? AND run_at <= ? ORDER BY run_at DESC, id DESC LIMIT 9', [m.id, when]);
    const z = (v - Number(m.target_mean)) / Number(m.target_sd);
    const { status, violations } = evaluateWestgard(z, prev.map((p) => Number(p.z_score)), m.rules.split(','));

    const [r] = await db.query(
      `INSERT INTO qc_runs (material_id, branch_id, value, z_score, run_at, status, violations, corrective_action, performed_by, performed_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.id, m.branch_id, v, Math.round(z * 1000) / 1000, when, status, violations.join(',') || null,
       String(corrective_action || '').trim().slice(0, 500) || null, req.user?.id || null, await actorName(req.user?.id)]
    );
    const message = status === 'Rejected'
      ? `QC REJECTED (${violations.join(', ')}). Hold patient results for ${m.parameter_name} on this analyzer, take corrective action and re-run QC.`
      : status === 'Warning' ? `QC warning (1-2s). Results may be released; inspect the Levey-Jennings chart for a trend.` : 'QC accepted.';
    res.status(201).json({ success: true, id: r.insertId, status, violations, z_score: z, message });
  } catch (error) { fail(res, error, 'recording QC run'); }
};

// PUT /runs/:id/corrective-action { corrective_action }
export const addCorrectiveAction = async (req, res) => {
  try {
    const text = String(req.body?.corrective_action || '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'Describe the corrective action taken.' });
    const pin = pinned(req);
    const [r] = await db.query(
      `UPDATE qc_runs SET corrective_action = ? WHERE id = ? ${pin ? 'AND branch_id = ?' : ''}`,
      [text.slice(0, 500), req.params.id, ...(pin ? [pin] : [])]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'QC run not found.' });
    res.json({ success: true, message: 'Corrective action recorded.' });
  } catch (error) { fail(res, error, 'recording corrective action'); }
};

// ── EQAS ────────────────────────────────────────────────────────────────────

export const listEqas = async (req, res) => {
  try {
    const branch = scopeBranch(req);
    const [rows] = await db.query(
      `SELECT e.*, lt.test_name, b.branch_name FROM eqas_results e
         LEFT JOIN lab_tests lt ON lt.id = e.test_id LEFT JOIN branches b ON b.id = e.branch_id
        ${branch ? 'WHERE e.branch_id = ?' : ''} ORDER BY COALESCE(e.result_on, e.received_on, e.created_at) DESC, e.id DESC LIMIT 500`,
      branch ? [branch] : []);
    const scored = rows.filter((r) => r.performance !== 'Pending');
    const summary = {
      total: rows.length,
      pending: rows.length - scored.length,
      acceptable: scored.filter((r) => r.performance === 'Acceptable').length,
      warning: scored.filter((r) => r.performance === 'Warning').length,
      unacceptable: scored.filter((r) => r.performance === 'Unacceptable').length,
    };
    summary.acceptable_pct = scored.length ? Math.round((summary.acceptable / scored.length) * 1000) / 10 : null;
    res.json({ success: true, results: rows, summary });
  } catch (error) { fail(res, error, 'loading EQAS results'); }
};

const eqasFields = (b) => {
  const { sdi, performance } = sdiPerformance(b.our_result, b.assigned_value, b.assigned_sd);
  return {
    provider: String(b.provider || '').trim(), program_name: String(b.program_name || '').trim(), cycle: String(b.cycle || '').trim(),
    sample_code: b.sample_code?.trim() || null, test_id: b.test_id || null, parameter_name: String(b.parameter_name || '').trim(),
    our_result: b.our_result === '' || b.our_result == null ? null : Number(b.our_result),
    assigned_value: b.assigned_value === '' || b.assigned_value == null ? null : Number(b.assigned_value),
    assigned_sd: b.assigned_sd === '' || b.assigned_sd == null ? null : Number(b.assigned_sd),
    sdi, performance,
    received_on: b.received_on || null, submitted_on: b.submitted_on || null, result_on: b.result_on || null,
    corrective_action: b.corrective_action?.trim()?.slice(0, 500) || null,
  };
};

export const createEqas = async (req, res) => {
  try {
    const f = eqasFields(req.body || {});
    if (!f.provider || !f.program_name || !f.cycle || !f.parameter_name) {
      return res.status(400).json({ success: false, message: 'Provider, programme, cycle and parameter are required.' });
    }
    const branchId = pinned(req) || req.body.branch_id || req.user?.branch_id || null;
    const cols = Object.keys(f);
    const [r] = await db.query(
      `INSERT INTO eqas_results (branch_id, ${cols.join(', ')}, recorded_by, recorded_by_name) VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?)`,
      [branchId, ...Object.values(f), req.user?.id || null, await actorName(req.user?.id)]);
    res.status(201).json({ success: true, id: r.insertId, performance: f.performance, sdi: f.sdi, message: `EQAS result saved${f.sdi != null ? ` — SDI ${f.sdi} (${f.performance})` : ''}.` });
  } catch (error) { fail(res, error, 'saving EQAS result'); }
};

export const updateEqas = async (req, res) => {
  try {
    const f = eqasFields(req.body || {});
    if (!f.provider || !f.program_name || !f.cycle || !f.parameter_name) {
      return res.status(400).json({ success: false, message: 'Provider, programme, cycle and parameter are required.' });
    }
    const pin = pinned(req);
    const [r] = await db.query(
      `UPDATE eqas_results SET ${Object.keys(f).map((c) => `${c} = ?`).join(', ')} WHERE id = ? ${pin ? 'AND branch_id = ?' : ''}`,
      [...Object.values(f), req.params.id, ...(pin ? [pin] : [])]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'EQAS result not found.' });
    res.json({ success: true, performance: f.performance, sdi: f.sdi, message: 'EQAS result updated.' });
  } catch (error) { fail(res, error, 'updating EQAS result'); }
};

// ── Quality / TAT dashboard ─────────────────────────────────────────────────

const stats = (arr) => {
  const v = arr.filter((x) => x != null && Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return { n: 0, avg: null, median: null, p90: null };
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * (v.length - 1) + 0.5))];
  return { n: v.length, avg: Math.round(v.reduce((a, x) => a + x, 0) / v.length), median: at(0.5), p90: at(0.9) };
};
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

// GET /dashboard?from&to&branch_id
export const getDashboard = async (req, res) => {
  try {
    const { from, to, fromTs, toTs } = range(req.query);
    const branch = scopeBranch(req);
    const bClause = (col) => (branch ? `AND ${col} = ?` : '');
    const bParam = branch ? [branch] : [];

    // Turnaround: every report authorised in the period, with its stage times.
    const [tat] = await db.query(
      `SELECT tr.id, tr.branch_id, COALESCE(tr.test_name, lt.test_name, bi.service_name) AS test_name, DATE(COALESCE(tr.approved_at, tr.verified_at)) AS day, lt.tat_minutes,
              TIMESTAMPDIFF(MINUTE, b.created_at, COALESCE(tr.approved_at, tr.verified_at)) AS order_to_report,
              TIMESTAMPDIFF(MINUTE, b.created_at, ls.collected_at) AS order_to_collect,
              TIMESTAMPDIFF(MINUTE, ls.collected_at, ls.received_at) AS collect_to_receive,
              TIMESTAMPDIFF(MINUTE, COALESCE(ls.received_at, ls.collected_at), tr.tested_at) AS receive_to_result,
              TIMESTAMPDIFF(MINUTE, tr.tested_at, COALESCE(tr.approved_at, tr.verified_at)) AS result_to_authorise
         FROM lab_test_result tr
         LEFT JOIN bill_items bi ON bi.id = tr.bill_item_id
         LEFT JOIN bills b ON b.id = bi.bill_id
         LEFT JOIN lab_tests lt ON lt.id = tr.test_id
         LEFT JOIN lab_samples ls ON ls.sample_id = tr.sample_id
        WHERE tr.status = 'Approved' AND COALESCE(tr.approved_at, tr.verified_at) BETWEEN ? AND ? ${bClause('tr.branch_id')}`,
      [fromTs, toTs, ...bParam]);

    const withTarget = tat.filter((t) => t.tat_minutes && t.order_to_report != null);
    const breached = withTarget.filter((t) => t.order_to_report > t.tat_minutes);
    const byTest = {};
    for (const t of tat) {
      const k = t.test_name || 'Unknown';
      byTest[k] ||= { test_name: k, reports: 0, target: t.tat_minutes || null, times: [], breached: 0 };
      byTest[k].reports += 1;
      if (t.order_to_report != null) byTest[k].times.push(t.order_to_report);
      if (t.tat_minutes && t.order_to_report > t.tat_minutes) byTest[k].breached += 1;
    }
    const tatByTest = Object.values(byTest).map(({ times, ...r }) => ({ ...r, ...stats(times), breach_pct: r.target ? pct(r.breached, r.reports) : null }))
      .sort((a, b) => (b.breach_pct ?? -1) - (a.breach_pct ?? -1) || b.reports - a.reports);

    // Rejection / recollection.
    const [[samples]] = await db.query(
      `SELECT COUNT(*) AS n FROM lab_samples WHERE collected_at BETWEEN ? AND ? ${bClause('branch_id')}`, [fromTs, toTs, ...bParam]);
    const [rejections] = await db.query(
      `SELECT reason_label, status, DATE(rejected_at) AS day, branch_id FROM sample_rejections WHERE rejected_at BETWEEN ? AND ? ${bClause('branch_id')}`,
      [fromTs, toTs, ...bParam]);
    const byReason = {};
    for (const r of rejections) byReason[r.reason_label || 'Other'] = (byReason[r.reason_label || 'Other'] || 0) + 1;

    // Critical results.
    const [criticals] = await db.query(
      `SELECT status, notify_within_minutes, TIMESTAMPDIFF(MINUTE, raised_at, acknowledged_at) AS minutes_to_ack, branch_id
         FROM critical_alerts WHERE raised_at BETWEEN ? AND ? ${bClause('branch_id')}`, [fromTs, toTs, ...bParam]);
    const acked = criticals.filter((c) => c.minutes_to_ack != null);
    const ackedInTime = acked.filter((c) => !c.notify_within_minutes || c.minutes_to_ack <= c.notify_within_minutes);

    // IQC and EQAS.
    const [qc] = await db.query(
      `SELECT status, DATE(run_at) AS day, branch_id FROM qc_runs WHERE run_at BETWEEN ? AND ? ${bClause('branch_id')}`, [fromTs, toTs, ...bParam]);
    const [eqas] = await db.query(
      `SELECT performance FROM eqas_results WHERE COALESCE(result_on, received_on, DATE(created_at)) BETWEEN ? AND ? AND performance <> 'Pending' ${bClause('branch_id')}`,
      [from, to, ...bParam]);

    // Equipment.
    const [[equip]] = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM equipment_pm_schedules s JOIN lab_machines m ON m.id = s.machine_id LEFT JOIN infrastructure i ON i.id = m.lab_id
           WHERE s.active = 1 AND s.next_due_at < CURDATE() ${bClause('i.branch_id')}) AS pm_overdue,
         (SELECT COUNT(*) FROM equipment_tickets t WHERE t.status IN ('Open','In Progress') ${bClause('t.branch_id')}) AS open_tickets,
         (SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, GREATEST(t.reported_at, ?), LEAST(COALESCE(t.resolved_at, NOW()), ?))), 0)
            FROM equipment_tickets t WHERE t.reported_at <= ? AND COALESCE(t.resolved_at, NOW()) >= ? ${bClause('t.branch_id')}) AS downtime_minutes`,
      [...bParam, ...bParam, fromTs, toTs, toTs, fromTs, ...bParam]);

    // Daily trend.
    const days = {};
    for (let d = new Date(`${from}T00:00:00`); localYmd(d) <= to; d.setDate(d.getDate() + 1)) {
      days[localYmd(d)] = { day: localYmd(d), reports: 0, tat: [], rejections: 0, qc_rejected: 0 };
    }
    const dayKey = (d) => (d instanceof Date ? localYmd(d) : String(d).slice(0, 10));
    for (const t of tat) { const d = days[dayKey(t.day)]; if (d) { d.reports += 1; if (t.order_to_report != null) d.tat.push(t.order_to_report); } }
    for (const r of rejections) { const d = days[dayKey(r.day)]; if (d) d.rejections += 1; }
    for (const q of qc) { const d = days[dayKey(q.day)]; if (d && q.status === 'Rejected') d.qc_rejected += 1; }
    const trend = Object.values(days).map(({ tat: t, ...d }) => ({ ...d, median_tat: stats(t).median }));

    // Facility comparison (district / state view): one row per facility.
    let facilities = [];
    if (!branch) {
      const [branches] = await db.query(
        `SELECT b.id, b.branch_name, d.name AS district FROM branches b LEFT JOIN districts d ON d.id = b.district_id WHERE b.status = 'Active'`);
      const group = (rows, key = 'branch_id') => rows.reduce((acc, r) => ((acc[r[key]] ||= []).push(r), acc), {});
      const [samplesBy] = await db.query(
        'SELECT branch_id, COUNT(*) AS n FROM lab_samples WHERE collected_at BETWEEN ? AND ? GROUP BY branch_id', [fromTs, toTs]);
      const sampleCount = Object.fromEntries(samplesBy.map((s) => [s.branch_id, Number(s.n)]));
      const tatG = group(tat); const rejG = group(rejections); const critG = group(criticals); const qcG = group(qc);
      facilities = branches.map((b) => {
        const t = tatG[b.id] || []; const tt = t.filter((x) => x.tat_minutes && x.order_to_report != null);
        const c = critG[b.id] || []; const ca = c.filter((x) => x.minutes_to_ack != null);
        const q = qcG[b.id] || [];
        return {
          branch_id: b.id, branch_name: b.branch_name, district: b.district || '—',
          reports: t.length,
          median_tat: stats(t.map((x) => x.order_to_report)).median,
          tat_breach_pct: pct(tt.filter((x) => x.order_to_report > x.tat_minutes).length, tt.length),
          rejection_pct: pct((rejG[b.id] || []).length, sampleCount[b.id] || 0),
          critical_ack_pct: pct(ca.filter((x) => !x.notify_within_minutes || x.minutes_to_ack <= x.notify_within_minutes).length, c.length),
          qc_reject_pct: pct(q.filter((x) => x.status === 'Rejected').length, q.length),
        };
      }).sort((a, b) => b.reports - a.reports);
    }

    res.json({
      success: true,
      period: { from, to },
      tat: {
        reports: tat.length,
        order_to_report: stats(tat.map((t) => t.order_to_report)),
        order_to_collect: stats(tat.map((t) => t.order_to_collect)),
        collect_to_receive: stats(tat.map((t) => t.collect_to_receive)),
        receive_to_result: stats(tat.map((t) => t.receive_to_result)),
        result_to_authorise: stats(tat.map((t) => t.result_to_authorise)),
        with_target: withTarget.length,
        breached: breached.length,
        breach_pct: pct(breached.length, withTarget.length),
        by_test: tatByTest.slice(0, 25),
      },
      rejection: {
        samples: Number(samples.n),
        rejected: rejections.length,
        rate_pct: pct(rejections.length, Number(samples.n)),
        recollected: rejections.filter((r) => r.status === 'Recollected').length,
        recollection_pending: rejections.filter((r) => r.status === 'Recollection Pending').length,
        by_reason: Object.entries(byReason).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      },
      critical: {
        raised: criticals.length,
        open: criticals.filter((c) => c.status === 'Open').length,
        acknowledged: acked.length,
        acknowledged_in_time_pct: pct(ackedInTime.length, criticals.length),
        median_minutes_to_ack: stats(acked.map((c) => c.minutes_to_ack)).median,
      },
      qc: {
        runs: qc.length,
        accepted: qc.filter((q) => q.status === 'Accepted').length,
        warning: qc.filter((q) => q.status === 'Warning').length,
        rejected: qc.filter((q) => q.status === 'Rejected').length,
        reject_pct: pct(qc.filter((q) => q.status === 'Rejected').length, qc.length),
      },
      eqas: {
        scored: eqas.length,
        acceptable_pct: pct(eqas.filter((e) => e.performance === 'Acceptable').length, eqas.length),
        unacceptable: eqas.filter((e) => e.performance === 'Unacceptable').length,
      },
      equipment: {
        pm_overdue: Number(equip.pm_overdue),
        open_tickets: Number(equip.open_tickets),
        downtime_hours: Math.round(Number(equip.downtime_minutes) / 6) / 10,
      },
      trend,
      facilities,
    });
  } catch (error) { fail(res, error, 'building quality dashboard'); }
};
