import db from '../config/db.js';

// State / district / facility programme analytics (tender #89-91): district
// comparison and ranking, investigation volumes, test-wise and referral
// trends, utilisation, equipment performance, reagent trends, quality
// indicators and free-scheme (programme) monitoring — for any date range,
// with drill-down state → district → facility and CSV export.
//
// Who sees what is decided here, not by the browser: a state user sees every
// district, a district user only their own district, a facility user only
// their facility. district_id / branch_id in the query only narrow that view.

const p2 = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const DAY = 86400000;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const num = (v) => (v == null ? 0 : Number(v));
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && localYmd(new Date(`${s}T00:00:00`)) === s;

// Targets the KPI tiles are coloured against. Programme-level targets should
// be confirmed by the Department; these are the commonly used laboratory ones.
export const TARGETS = { tat_compliance_pct: 95, rejection_pct_max: 2, qc_reject_pct_max: 5, critical_ack_pct: 95, uptime_pct: 95 };

function parseRange(q) {
  const to = isYmd(q.to) ? q.to : localYmd(new Date());
  let from = isYmd(q.from) ? q.from : localYmd(new Date(Date.now() - 29 * DAY));
  if (from > to) from = to;
  const days = Math.min(731, Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / DAY) + 1);
  const prevTo = localYmd(new Date(new Date(`${from}T00:00:00`).getTime() - DAY));
  const prevFrom = localYmd(new Date(new Date(`${from}T00:00:00`).getTime() - days * DAY));
  return { from, to, days, fromTs: `${from} 00:00:00`, toTs: `${to} 23:59:59`, prevFrom, prevTo, prevFromTs: `${prevFrom} 00:00:00`, prevToTs: `${prevTo} 23:59:59` };
}

// The facilities this user may look at, narrowed by the optional filters.
async function resolveScope(req) {
  const level = req.user?.role_level;
  const [all] = await db.query(
    `SELECT b.id, b.branch_name, b.hospital_code, b.district_id, COALESCE(d.name, 'Unassigned') AS district
       FROM branches b LEFT JOIN districts d ON d.id = b.district_id WHERE b.status = 'Active'`);
  let allowed = all;
  let kind = 'state';
  if (level !== 'Central') {
    const own = all.find((b) => b.id === Number(req.user?.branch_id));
    if (level === 'Sub-Central' && own?.district_id) { allowed = all.filter((b) => b.district_id === own.district_id); kind = 'district'; }
    else { allowed = own ? [own] : []; kind = 'facility'; }
  }
  let scoped = allowed;
  const wantBranch = Number(req.query.branch_id) || null;
  const wantDistrict = Number(req.query.district_id) || null;
  if (wantBranch) scoped = scoped.filter((b) => b.id === wantBranch);
  else if (wantDistrict) scoped = scoped.filter((b) => b.district_id === wantDistrict);
  return { kind, allowed, scoped, focus: wantBranch ? 'facility' : wantDistrict ? 'district' : kind };
}

const sparse = (from, to, rows, keys) => {
  const map = new Map(rows.map((r) => [String(r.day instanceof Date ? localYmd(r.day) : r.day).slice(0, 10), r]));
  const out = [];
  for (let d = new Date(`${from}T00:00:00`); localYmd(d) <= to; d.setDate(d.getDate() + 1)) {
    const key = localYmd(d); const r = map.get(key) || {};
    out.push({ day: key, ...Object.fromEntries(keys.map((k) => [k, num(r[k])])) });
  }
  return out;
};

export async function buildProgramme(req) {
  const r = parseRange(req.query);
  const scope = await resolveScope(req);
  const ids = scope.scoped.map((b) => b.id);
  const empty = !ids.length;
  const IN = ids.length ? ids : [0];
  const bById = Object.fromEntries(scope.allowed.map((b) => [b.id, b]));

  // Investigations: volume, authorisation, turnaround, per facility.
  const [perBranch] = await db.query(
    `SELECT tr.branch_id, COUNT(*) AS tests,
            SUM(tr.status = 'Approved') AS approved,
            SUM(tr.has_critical = 1) AS criticals,
            SUM(tr.entry_mode = 'Manual') AS manual_entries,
            SUM(tr.status = 'Approved' AND lt.tat_minutes IS NOT NULL) AS with_target,
            SUM(tr.status = 'Approved' AND lt.tat_minutes IS NOT NULL
                AND TIMESTAMPDIFF(MINUTE, b.created_at, COALESCE(tr.approved_at, tr.verified_at)) > lt.tat_minutes) AS breached,
            AVG(CASE WHEN tr.status = 'Approved' THEN TIMESTAMPDIFF(MINUTE, b.created_at, COALESCE(tr.approved_at, tr.verified_at)) END) AS avg_tat
       FROM lab_test_result tr
       LEFT JOIN lab_tests lt ON lt.id = tr.test_id
       LEFT JOIN bill_items bi ON bi.id = tr.bill_item_id
       LEFT JOIN bills b ON b.id = bi.bill_id
      WHERE tr.tested_at BETWEEN ? AND ? AND tr.branch_id IN (?)
      GROUP BY tr.branch_id`, [r.fromTs, r.toTs, IN]);

  const [prevByBranch] = await db.query(
    'SELECT branch_id, COUNT(*) AS tests FROM lab_test_result WHERE tested_at BETWEEN ? AND ? AND branch_id IN (?) GROUP BY branch_id',
    [r.prevFromTs, r.prevToTs, IN]);

  const [samplesBy] = await db.query(
    'SELECT branch_id, COUNT(*) AS n FROM lab_samples WHERE collected_at BETWEEN ? AND ? AND branch_id IN (?) GROUP BY branch_id', [r.fromTs, r.toTs, IN]);
  const [rejectBy] = await db.query(
    'SELECT branch_id, COUNT(*) AS n FROM sample_rejections WHERE rejected_at BETWEEN ? AND ? AND branch_id IN (?) GROUP BY branch_id', [r.fromTs, r.toTs, IN]);
  const [criticalBy] = await db.query(
    `SELECT branch_id, COUNT(*) AS raised,
            SUM(acknowledged_at IS NOT NULL AND TIMESTAMPDIFF(MINUTE, raised_at, acknowledged_at) <= notify_within_minutes) AS in_time
       FROM critical_alerts WHERE raised_at BETWEEN ? AND ? AND branch_id IN (?) GROUP BY branch_id`, [r.fromTs, r.toTs, IN]);
  const [qcBy] = await db.query(
    `SELECT branch_id, COUNT(*) AS runs, SUM(status = 'Rejected') AS rejected
       FROM qc_runs WHERE run_at BETWEEN ? AND ? AND branch_id IN (?) GROUP BY branch_id`, [r.fromTs, r.toTs, IN]);

  // Equipment: analyzers per facility, downtime inside the period.
  const [machinesBy] = await db.query(
    `SELECT i.branch_id, COUNT(*) AS machines FROM lab_machines m JOIN infrastructure i ON i.id = m.lab_id
      WHERE i.branch_id IN (?) AND (m.status IS NULL OR m.status <> 'Retired') GROUP BY i.branch_id`, [IN]);
  const [downBy] = await db.query(
    `SELECT t.branch_id, COUNT(*) AS tickets,
            SUM(t.status IN ('Open','In Progress')) AS open_tickets,
            COALESCE(SUM(GREATEST(0, TIMESTAMPDIFF(MINUTE, GREATEST(t.reported_at, ?), LEAST(COALESCE(t.resolved_at, NOW()), ?)))), 0) AS downtime_min
       FROM equipment_tickets t
      WHERE t.reported_at <= ? AND COALESCE(t.resolved_at, NOW()) >= ? AND t.branch_id IN (?) GROUP BY t.branch_id`,
    [r.fromTs, r.toTs, r.toTs, r.fromTs, IN]);

  // Referrals leaving and arriving at each facility.
  const [refOut] = await db.query(
    'SELECT from_branch_id AS branch_id, COUNT(*) AS n FROM sample_referrals WHERE dispatched_at BETWEEN ? AND ? AND from_branch_id IN (?) AND status <> ? GROUP BY from_branch_id',
    [r.fromTs, r.toTs, IN, 'Cancelled']);
  const [refIn] = await db.query(
    'SELECT to_branch_id AS branch_id, COUNT(*) AS n FROM sample_referrals WHERE dispatched_at BETWEEN ? AND ? AND to_branch_id IN (?) AND status <> ? GROUP BY to_branch_id',
    [r.fromTs, r.toTs, IN, 'Cancelled']);

  // Programme (free-scheme) bills.
  const [billsBy] = await db.query(
    `SELECT branch_id, COUNT(*) AS bills, SUM(billing_type <> 'Standard') AS scheme_bills
       FROM bills WHERE created_at BETWEEN ? AND ? AND branch_id IN (?) GROUP BY branch_id`, [r.fromTs, r.toTs, IN]);

  const idx = (rows, f = 'branch_id') => Object.fromEntries(rows.map((x) => [x[f], x]));
  const P = idx(perBranch); const Pp = idx(prevByBranch); const S = idx(samplesBy); const Rj = idx(rejectBy); const Cr = idx(criticalBy);
  const Q = idx(qcBy); const M = idx(machinesBy); const D = idx(downBy); const RO = idx(refOut); const RI = idx(refIn); const B = idx(billsBy);
  const periodMin = r.days * 1440;

  const facilities = scope.scoped.map((b) => {
    const p = P[b.id] || {}; const machines = num(M[b.id]?.machines);
    const down = num(D[b.id]?.downtime_min);
    const uptime = machines ? Math.max(0, Math.round((1 - down / (machines * periodMin)) * 1000) / 10) : null;
    const tests = num(p.tests);
    return {
      branch_id: b.id, branch_name: b.branch_name, hospital_code: b.hospital_code, district_id: b.district_id, district: b.district,
      tests, approved: num(p.approved), prev_tests: num(Pp[b.id]?.tests),
      avg_tat: p.avg_tat == null ? null : Math.round(p.avg_tat),
      tat_compliance_pct: p.with_target ? Math.round((100 - pct(num(p.breached), num(p.with_target))) * 10) / 10 : null,
      samples: num(S[b.id]?.n), rejected: num(Rj[b.id]?.n), rejection_pct: pct(num(Rj[b.id]?.n), num(S[b.id]?.n)),
      criticals: num(Cr[b.id]?.raised), critical_ack_pct: Cr[b.id]?.raised ? pct(num(Cr[b.id].in_time), num(Cr[b.id].raised)) : null,
      qc_runs: num(Q[b.id]?.runs), qc_reject_pct: Q[b.id]?.runs ? pct(num(Q[b.id].rejected), num(Q[b.id].runs)) : null,
      machines, open_tickets: num(D[b.id]?.open_tickets), downtime_hours: Math.round((down / 60) * 10) / 10, uptime_pct: uptime,
      tests_per_machine_day: machines ? Math.round((tests / machines / r.days) * 100) / 100 : null,
      referred_out: num(RO[b.id]?.n), referred_in: num(RI[b.id]?.n),
      bills: num(B[b.id]?.bills), scheme_bills: num(B[b.id]?.scheme_bills),
    };
  });

  // Roll facilities up to districts and rank them.
  const dMap = new Map();
  for (const f of facilities) {
    const key = f.district_id ?? 0;
    if (!dMap.has(key)) dMap.set(key, { district_id: f.district_id, district: f.district, facilities: 0, tests: 0, prev_tests: 0, approved: 0, samples: 0, rejected: 0, machines: 0, down_h: 0,
      open_tickets: 0, referred_out: 0, referred_in: 0, bills: 0, scheme_bills: 0, qc_runs: 0, qc_rej: 0, crit: 0, crit_ok: 0, tat_w: 0, tat_n: 0, comp_w: 0, comp_n: 0, machine_min: 0 });
    const d = dMap.get(key);
    d.facilities += 1; d.tests += f.tests; d.prev_tests += f.prev_tests; d.approved += f.approved; d.samples += f.samples; d.rejected += f.rejected;
    d.machines += f.machines; d.down_h += f.downtime_hours; d.open_tickets += f.open_tickets; d.referred_out += f.referred_out; d.referred_in += f.referred_in;
    d.bills += f.bills; d.scheme_bills += f.scheme_bills; d.qc_runs += f.qc_runs;
    d.qc_rej += Math.round((f.qc_reject_pct || 0) * f.qc_runs / 100);
    d.crit += f.criticals; d.crit_ok += Math.round((f.critical_ack_pct || 0) * f.criticals / 100);
    if (f.avg_tat != null) { d.tat_w += f.avg_tat * f.approved; d.tat_n += f.approved; }
    if (f.tat_compliance_pct != null) { d.comp_w += f.tat_compliance_pct * f.approved; d.comp_n += f.approved; }
  }
  const districts = [...dMap.values()].map((d) => {
    const tat_compliance_pct = d.comp_n ? Math.round((d.comp_w / d.comp_n) * 10) / 10 : null;
    const rejection_pct = pct(d.rejected, d.samples);
    const qc_reject_pct = d.qc_runs ? pct(d.qc_rej, d.qc_runs) : null;
    const uptime_pct = d.machines ? Math.max(0, Math.round((1 - (d.down_h * 60) / (d.machines * periodMin)) * 1000) / 10) : null;
    // Performance score: the mean of whichever of these four are measurable.
    const parts = [tat_compliance_pct, rejection_pct == null ? null : Math.max(0, 100 - rejection_pct * 10), qc_reject_pct == null ? null : 100 - qc_reject_pct, uptime_pct].filter((x) => x != null);
    return {
      district_id: d.district_id, district: d.district, facilities: d.facilities, tests: d.tests, prev_tests: d.prev_tests,
      growth_pct: d.prev_tests ? Math.round(((d.tests - d.prev_tests) / d.prev_tests) * 1000) / 10 : null,
      avg_tat: d.tat_n ? Math.round(d.tat_w / d.tat_n) : null, tat_compliance_pct, rejection_pct, qc_reject_pct,
      critical_ack_pct: d.crit ? pct(d.crit_ok, d.crit) : null, machines: d.machines, uptime_pct, open_tickets: d.open_tickets,
      tests_per_machine_day: d.machines ? Math.round((d.tests / d.machines / r.days) * 100) / 100 : null,
      referred_out: d.referred_out, referred_in: d.referred_in, bills: d.bills, scheme_bills: d.scheme_bills,
      score: parts.length ? Math.round((parts.reduce((a, x) => a + x, 0) / parts.length) * 10) / 10 : null,
    };
  });
  districts.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.tests - a.tests);
  districts.forEach((d, i) => { d.rank = d.score == null ? null : i + 1; });
  const byVolume = [...districts].sort((a, b) => b.tests - a.tests);
  byVolume.forEach((d, i) => { d.volume_rank = i + 1; });

  // Test-wise volumes and trend.
  const [testRows] = await db.query(
    `SELECT COALESCE(lt.test_name, tr.test_name, 'Unknown') AS test_name, COUNT(*) AS tests, COUNT(DISTINCT tr.branch_id) AS facilities,
            SUM(tr.status = 'Approved') AS approved,
            AVG(CASE WHEN tr.status = 'Approved' THEN TIMESTAMPDIFF(MINUTE, b.created_at, COALESCE(tr.approved_at, tr.verified_at)) END) AS avg_tat,
            MAX(lt.tat_minutes) AS target
       FROM lab_test_result tr LEFT JOIN lab_tests lt ON lt.id = tr.test_id
       LEFT JOIN bill_items bi ON bi.id = tr.bill_item_id LEFT JOIN bills b ON b.id = bi.bill_id
      WHERE tr.tested_at BETWEEN ? AND ? AND tr.branch_id IN (?) GROUP BY 1 ORDER BY tests DESC LIMIT 25`, [r.fromTs, r.toTs, IN]);
  const [prevTestRows] = await db.query(
    `SELECT COALESCE(lt.test_name, tr.test_name, 'Unknown') AS test_name, COUNT(*) AS tests FROM lab_test_result tr LEFT JOIN lab_tests lt ON lt.id = tr.test_id
      WHERE tr.tested_at BETWEEN ? AND ? AND tr.branch_id IN (?) GROUP BY 1`, [r.prevFromTs, r.prevToTs, IN]);
  const prevT = Object.fromEntries(prevTestRows.map((x) => [x.test_name, num(x.tests)]));
  const tests = testRows.map((t) => ({
    test_name: t.test_name, tests: num(t.tests), facilities: num(t.facilities), approved: num(t.approved),
    avg_tat: t.avg_tat == null ? null : Math.round(t.avg_tat), target: t.target || null,
    prev_tests: prevT[t.test_name] || 0, growth_pct: prevT[t.test_name] ? Math.round(((num(t.tests) - prevT[t.test_name]) / prevT[t.test_name]) * 1000) / 10 : null,
  }));
  const top5 = tests.slice(0, 5).map((t) => t.test_name);
  const [testDaily] = top5.length ? await db.query(
    `SELECT COALESCE(lt.test_name, tr.test_name, 'Unknown') AS test_name, DATE(tr.tested_at) AS day, COUNT(*) AS n
       FROM lab_test_result tr LEFT JOIN lab_tests lt ON lt.id = tr.test_id
      WHERE tr.tested_at BETWEEN ? AND ? AND tr.branch_id IN (?) GROUP BY 1, 2 HAVING test_name IN (?)`, [r.fromTs, r.toTs, IN, top5]) : [[]];
  const [dailyAll] = await db.query(
    `SELECT DATE(tested_at) AS day, COUNT(*) AS tests, SUM(status = 'Approved') AS approved FROM lab_test_result WHERE tested_at BETWEEN ? AND ? AND branch_id IN (?) GROUP BY 1`,
    [r.fromTs, r.toTs, IN]);
  const volumeTrend = sparse(r.from, r.to, dailyAll, ['tests', 'approved']);
  const topTrend = sparse(r.from, r.to, [], []).map((row) => {
    const o = { day: row.day };
    for (const t of top5) o[t] = 0;
    return o;
  });
  const dayIdx = Object.fromEntries(topTrend.map((o, i) => [o.day, i]));
  for (const x of testDaily) { const i = dayIdx[String(x.day instanceof Date ? localYmd(x.day) : x.day).slice(0, 10)]; if (i != null) topTrend[i][x.test_name] = num(x.n); }

  // Referral analysis.
  const [refRows] = await db.query(
    `SELECT DATE(dispatched_at) AS day, status, transfer_type, reason, from_branch_id, to_branch_id, ticket_id,
            TIMESTAMPDIFF(HOUR, dispatched_at, received_at) AS hours
       FROM sample_referrals WHERE dispatched_at BETWEEN ? AND ? AND status <> 'Cancelled' AND (from_branch_id IN (?) OR to_branch_id IN (?))`,
    [r.fromTs, r.toTs, IN, IN]);
  const byReason = {}; const byStatus = {}; const flow = {};
  let hoursSum = 0; let hoursN = 0; let breakdownLinked = 0;
  for (const x of refRows) {
    const reason = String(x.reason || 'Not stated').slice(0, 80);
    byReason[reason] = (byReason[reason] || 0) + 1;
    byStatus[x.status] = (byStatus[x.status] || 0) + 1;
    if (x.hours != null && x.hours >= 0) { hoursSum += x.hours; hoursN += 1; }
    if (x.ticket_id) breakdownLinked += 1;
    const fk = `${bById[x.from_branch_id]?.branch_name || x.from_branch_id}→${bById[x.to_branch_id]?.branch_name || x.to_branch_id}`;
    flow[fk] = flow[fk] || { from: bById[x.from_branch_id]?.branch_name || String(x.from_branch_id), to: bById[x.to_branch_id]?.branch_name || String(x.to_branch_id), n: 0 };
    flow[fk].n += 1;
  }
  const referralTrend = sparse(r.from, r.to, Object.values(refRows.reduce((acc, x) => {
    const k = String(x.day instanceof Date ? localYmd(x.day) : x.day).slice(0, 10);
    (acc[k] ||= { day: k, referrals: 0 }).referrals += 1; return acc;
  }, {})), ['referrals']);
  const referrals = {
    total: refRows.length, due_to_breakdown: breakdownLinked,
    avg_transit_hours: hoursN ? Math.round((hoursSum / hoursN) * 10) / 10 : null,
    by_status: Object.entries(byStatus).map(([status, n]) => ({ status, n })),
    by_reason: Object.entries(byReason).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n).slice(0, 8),
    flows: Object.values(flow).sort((a, b) => b.n - a.n).slice(0, 10),
    trend: referralTrend,
  };

  // Reagents: lot changes and expired-lot loads, by reagent and day.
  const [rgRows] = await db.query(
    `SELECT e.reagent_name, DATE(e.changed_at) AS day, COUNT(*) AS changes, SUM(e.loaded_expired = 1) AS expired, COALESCE(SUM(e.quantity_issued), 0) AS qty
       FROM equipment_reagent_changes e JOIN lab_machines m ON m.id = e.machine_id JOIN infrastructure i ON i.id = m.lab_id
      WHERE e.changed_at BETWEEN ? AND ? AND i.branch_id IN (?) GROUP BY 1, 2`, [r.fromTs, r.toTs, IN]);
  const rgBy = {};
  for (const x of rgRows) { const o = (rgBy[x.reagent_name] ||= { reagent: x.reagent_name, changes: 0, expired_loads: 0, quantity: 0 }); o.changes += num(x.changes); o.expired_loads += num(x.expired); o.quantity += num(x.qty); }
  const reagents = {
    changes: rgRows.reduce((a, x) => a + num(x.changes), 0), expired_loads: rgRows.reduce((a, x) => a + num(x.expired), 0),
    by_reagent: Object.values(rgBy).sort((a, b) => b.changes - a.changes).slice(0, 12),
    trend: sparse(r.from, r.to, Object.values(rgRows.reduce((acc, x) => {
      const k = String(x.day instanceof Date ? localYmd(x.day) : x.day).slice(0, 10); (acc[k] ||= { day: k, changes: 0 }).changes += num(x.changes); return acc;
    }, {})), ['changes']),
  };

  // Programme (free scheme) monitoring.
  const [schemeRows] = await db.query(
    `SELECT COALESCE(scheme_name, 'Not named') AS scheme, COUNT(*) AS bills, COALESCE(SUM(total_amount), 0) AS value
       FROM bills WHERE created_at BETWEEN ? AND ? AND branch_id IN (?) AND billing_type <> 'Standard' GROUP BY 1 ORDER BY bills DESC`, [r.fromTs, r.toTs, IN]);
  const sum = (k) => facilities.reduce((a, f) => a + f[k], 0);
  const withTarget = perBranch.reduce((a, x) => a + num(x.with_target), 0);
  const breached = perBranch.reduce((a, x) => a + num(x.breached), 0);
  const samplesAll = sum('samples'); const rejectedAll = sum('rejected');
  const machinesAll = sum('machines'); const downAll = facilities.reduce((a, f) => a + f.downtime_hours, 0);
  const qcRuns = sum('qc_runs'); const crit = sum('criticals');
  const critOk = facilities.reduce((a, f) => a + Math.round((f.critical_ack_pct || 0) * f.criticals / 100), 0);
  const qcRej = facilities.reduce((a, f) => a + Math.round((f.qc_reject_pct || 0) * f.qc_runs / 100), 0);
  const totalTests = sum('tests'); const prevTotal = sum('prev_tests');
  const kpis = {
    facilities: facilities.length, tests: totalTests, prev_tests: prevTotal,
    growth_pct: prevTotal ? Math.round(((totalTests - prevTotal) / prevTotal) * 1000) / 10 : null,
    approved: sum('approved'),
    tat_compliance_pct: withTarget ? Math.round((100 - pct(breached, withTarget)) * 10) / 10 : null,
    rejection_pct: pct(rejectedAll, samplesAll), samples: samplesAll, rejected: rejectedAll,
    qc_reject_pct: qcRuns ? pct(qcRej, qcRuns) : null, critical_ack_pct: crit ? pct(critOk, crit) : null, criticals: crit,
    machines: machinesAll, uptime_pct: machinesAll ? Math.max(0, Math.round((1 - (downAll * 60) / (machinesAll * periodMin)) * 1000) / 10) : null,
    open_tickets: sum('open_tickets'),
    utilization_per_machine_day: machinesAll ? Math.round((totalTests / machinesAll / r.days) * 100) / 100 : null,
    referred_out: sum('referred_out'), referred_in: sum('referred_in'),
    bills: sum('bills'), scheme_bills: sum('scheme_bills'), scheme_share_pct: pct(sum('scheme_bills'), sum('bills')),
    facilities_reporting: facilities.filter((f) => f.tests > 0).length,
    manual_entry_pct: pct(perBranch.reduce((a, x) => a + num(x.manual_entries), 0), perBranch.reduce((a, x) => a + num(x.tests), 0)),
  };

  return {
    success: true, period: { from: r.from, to: r.to, days: r.days, compared_with: { from: r.prevFrom, to: r.prevTo } },
    scope: { kind: scope.kind, focus: scope.focus, empty, districts: [...new Map(scope.allowed.map((b) => [b.district_id, b.district])).entries()].map(([id, name]) => ({ id, name })),
      facilities: scope.allowed.map((b) => ({ id: b.id, name: b.branch_name, district_id: b.district_id })) },
    targets: TARGETS, kpis, districts, facilities: facilities.sort((a, b) => b.tests - a.tests),
    tests, test_trend: { tests: top5, series: topTrend }, volume_trend: volumeTrend,
    referrals, reagents, programme: { schemes: schemeRows.map((s) => ({ scheme: s.scheme, bills: num(s.bills), value: num(s.value) })) },
    score_formula: 'Score = mean of: TAT compliance %, 100 − (10 × sample rejection %), 100 − IQC reject %, equipment uptime % (those that can be measured).',
  };
}

// GET /api/programme/dashboard?from&to&district_id&branch_id
export const getProgramme = async (req, res) => {
  try { res.json(await buildProgramme(req)); } catch (error) {
    console.error('Programme dashboard error:', error);
    res.status(500).json({ success: false, message: 'Server error loading the programme dashboard' });
  }
};

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// GET /api/programme/export?view=districts|facilities|tests|referrals&from&to&…
export const exportProgramme = async (req, res) => {
  try {
    const d = await buildProgramme(req);
    const views = {
      districts: [['Rank', 'District', 'Facilities', 'Investigations', 'Previous period', 'Change %', 'TAT compliance %', 'Avg TAT (min)', 'Rejection %', 'IQC reject %', 'Critical ack %', 'Analyzers', 'Uptime %', 'Referred out', 'Referred in', 'Scheme bills', 'Score'],
        d.districts.map((x) => [x.rank, x.district, x.facilities, x.tests, x.prev_tests, x.growth_pct, x.tat_compliance_pct, x.avg_tat, x.rejection_pct, x.qc_reject_pct, x.critical_ack_pct, x.machines, x.uptime_pct, x.referred_out, x.referred_in, x.scheme_bills, x.score])],
      facilities: [['Facility', 'District', 'Investigations', 'Previous period', 'TAT compliance %', 'Avg TAT (min)', 'Samples', 'Rejected', 'Rejection %', 'IQC reject %', 'Analyzers', 'Uptime %', 'Tests per analyzer per day', 'Referred out', 'Referred in', 'Scheme bills'],
        d.facilities.map((x) => [x.branch_name, x.district, x.tests, x.prev_tests, x.tat_compliance_pct, x.avg_tat, x.samples, x.rejected, x.rejection_pct, x.qc_reject_pct, x.machines, x.uptime_pct, x.tests_per_machine_day, x.referred_out, x.referred_in, x.scheme_bills])],
      tests: [['Test', 'Investigations', 'Previous period', 'Change %', 'Facilities', 'Approved', 'Avg TAT (min)', 'TAT target (min)'],
        d.tests.map((x) => [x.test_name, x.tests, x.prev_tests, x.growth_pct, x.facilities, x.approved, x.avg_tat, x.target])],
      referrals: [['Day', 'Referrals'], d.referrals.trend.map((x) => [x.day, x.referrals])],
    };
    const v = views[req.query.view];
    if (!v) return res.status(400).json({ success: false, message: 'Unknown view.' });
    const body = [v[0], ...v[1]].map((row) => row.map(csvCell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="programme-${req.query.view}-${d.period.from}-to-${d.period.to}.csv"`);
    res.send(`﻿${body}`);
  } catch (error) {
    console.error('Programme export error:', error);
    res.status(500).json({ success: false, message: 'Server error exporting the programme data' });
  }
};
