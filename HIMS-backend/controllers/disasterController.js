import pool from '../config/db.js';

// Disease surveillance heatmap (tender #95-102), computed from approved lab
// results: a result counts as a case of a disease when its test matches the
// disease's test_pattern (surveillance_diseases) and a parameter reads
// positive / reactive / detected (or a Widal titre of 1:160 or more). Cases
// are attributed to the district of the reporting facility. Risk is the
// Government-set threshold band for the window's case count, trend compares
// the window with the one before it, and alerts fire on HIGH risk, on a rise
// beyond rise_alert_percent, or on cluster_min_cases at one facility in a day.
// The older disease_surveillance table is still read as an external feed
// (e.g. IDSP), for Karnataka districts only.

const WINDOWS = { '1D': 1, '3D': 3, '7D': 7, '14D': 14, '30D': 30 };
const DAY = 86400000;

const NEGATIVE = /\b(non[-\s]?reactive|not\s+detected|negative|not\s+seen|absent|nil)\b/i;
const POSITIVE = /\b(positive|reactive|detected|seen|present)\b/i;

export function isPositiveValue(value) {
  const s = String(value ?? '').trim();
  if (!s || NEGATIVE.test(s)) return false;
  if (POSITIVE.test(s)) return true;
  const titre = s.match(/1\s*:\s*(\d+)/);
  return !!titre && Number(titre[1]) >= 160;
}

const parse = (j) => { try { return Array.isArray(j) ? j : JSON.parse(j || '[]'); } catch { return []; } };
const isPositiveResult = (resultsJson) => parse(resultsJson).some((r) => r && !r.is_subheader && isPositiveValue(r.result_value));

async function loadRules(includeInactive = false) {
  const [rows] = await pool.query(`SELECT * FROM surveillance_diseases ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY disease`);
  return rows.map((r) => {
    let re = null;
    try { re = new RegExp(r.test_pattern, 'i'); } catch { /* invalid pattern: rule is skipped */ }
    return { ...r, re };
  });
}

const riskFor = (cases, rule) => (cases >= rule.high_threshold ? 'HIGH' : cases >= rule.medium_threshold ? 'MEDIUM' : 'LOW');
const trendOf = (cur, prev) => {
  if (!prev) return { trend: cur ? 'New' : '0%', trend_pct: cur ? null : 0, direction: cur ? 'rising' : 'stable' };
  const p = Math.round(((cur - prev) / prev) * 100);
  return { trend: `${p > 0 ? '+' : ''}${p}%`, trend_pct: p, direction: p >= 10 ? 'rising' : p <= -10 ? 'declining' : 'stable' };
};
const p2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

// Everything the dashboard needs for one window, in one pass.
async function compute(windowKey) {
  const days = WINDOWS[windowKey] || 7;
  const now = new Date();
  const curFrom = new Date(now.getTime() - days * DAY);
  const prevFrom = new Date(now.getTime() - 2 * days * DAY);
  const seriesDays = Math.max(7, days);
  const seriesFrom = new Date(`${ymd(new Date(now.getTime() - (seriesDays - 1) * DAY))}T00:00:00`);
  const scanFrom = prevFrom < seriesFrom ? prevFrom : seriesFrom;

  const rules = await loadRules();
  const [results] = await pool.query(
    `SELECT tr.sample_id, tr.test_name, tr.results_json, COALESCE(tr.approved_at, tr.verified_at) AS at,
            b.id AS branch_id, b.branch_name, d.name AS district
       FROM lab_test_result tr
       JOIN branches b ON b.id = tr.branch_id
       JOIN districts d ON d.id = b.district_id
      WHERE tr.status = 'Approved' AND COALESCE(tr.approved_at, tr.verified_at) >= ?`, [scanFrom]);

  const rows = {};     // `${district}|${disease}` -> aggregate
  const clusters = {}; // `${branch}|${disease}|${day}` -> count
  const seen = new Set();
  const agg = (district, disease) => (rows[`${district}|${disease}`] ||= {
    district, disease, cases: 0, prev_cases: 0, tests: 0, facilities: {}, series: {}, lab: false, feed: false,
  });

  for (const r of results) {
    const rule = rules.find((x) => x.re && x.re.test(r.test_name || ''));
    if (!rule) continue;
    const dedupe = `${r.sample_id}|${rule.disease}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const at = new Date(r.at);
    const positive = isPositiveResult(r.results_json);
    const a = agg(r.district, rule.disease);
    a.lab = true;
    if (at >= curFrom) a.tests += 1;
    if (!positive) continue;
    if (at >= curFrom) {
      a.cases += 1;
      a.facilities[r.branch_name] = (a.facilities[r.branch_name] || 0) + 1;
      const ck = `${r.branch_name}|${rule.disease}|${ymd(at)}`;
      clusters[ck] = (clusters[ck] || 0) + 1;
    } else if (at >= prevFrom) {
      a.prev_cases += 1;
    }
    if (at >= seriesFrom) a.series[ymd(at)] = (a.series[ymd(at)] || 0) + 1;
  }

  // External feed rows, Karnataka districts only.
  const [feed] = await pool.query(
    `SELECT s.district, s.disease, s.cases, s.recorded_date FROM disease_surveillance s
       JOIN districts d ON d.name = s.district WHERE s.recorded_date >= ?`, [ymd(scanFrom)]);
  for (const f of feed) {
    const day = f.recorded_date instanceof Date ? ymd(f.recorded_date) : String(f.recorded_date).slice(0, 10);
    const at = new Date(`${day}T12:00:00`);
    const a = agg(f.district, f.disease);
    a.feed = true;
    if (at >= curFrom) a.cases += Number(f.cases) || 0;
    else if (at >= prevFrom) a.prev_cases += Number(f.cases) || 0;
    if (at >= seriesFrom) a.series[day] = (a.series[day] || 0) + (Number(f.cases) || 0);
  }

  const ruleFor = (disease) => rules.find((r) => r.disease === disease)
    || { medium_threshold: 5, high_threshold: 15, rise_alert_percent: 50, cluster_min_cases: 3 };
  const data = Object.values(rows)
    .filter((a) => a.cases > 0 || a.prev_cases > 0)
    .map((a) => {
      const rule = ruleFor(a.disease);
      const series = [];
      for (let i = seriesDays - 1; i >= 0; i -= 1) {
        const d = ymd(new Date(now.getTime() - i * DAY));
        series.push({ day: d.slice(5), cases: a.series[d] || 0 });
      }
      return {
        district: a.district, disease: a.disease, cases: a.cases, prev_cases: a.prev_cases, tests: a.tests,
        positivity_pct: a.tests ? Math.round((a.cases / a.tests) * 1000) / 10 : null,
        ...trendOf(a.cases, a.prev_cases),
        risk_level: riskFor(a.cases, rule),
        thresholds: { medium: rule.medium_threshold, high: rule.high_threshold },
        facilities: Object.entries(a.facilities).sort((x, y) => y[1] - x[1]).map(([name, cases]) => ({ name, cases })),
        series, source: a.lab && a.feed ? 'lab+feed' : a.feed ? 'feed' : 'lab',
      };
    })
    .sort((x, y) => y.cases - x.cases);

  const plural = `${days} day${days > 1 ? 's' : ''}`;
  const alerts = [];
  for (const d of data) {
    const rule = ruleFor(d.disease);
    if (d.risk_level === 'HIGH') {
      alerts.push({ type: 'CRITICAL', district: d.district, disease: d.disease,
        msg: `${d.disease}: ${d.cases} positive cases in ${d.district} in the last ${plural} — above the HIGH threshold of ${rule.high_threshold}.` });
    } else if (d.direction === 'rising' && d.cases >= rule.cluster_min_cases && (d.trend_pct == null || d.trend_pct >= rule.rise_alert_percent)) {
      alerts.push({ type: 'WARNING', district: d.district, disease: d.disease,
        msg: `${d.disease} rising in ${d.district}: ${d.cases} cases vs ${d.prev_cases} in the previous ${plural} (${d.trend}).` });
    }
  }
  for (const [k, n] of Object.entries(clusters)) {
    const [branch, disease, day] = k.split('|');
    if (n >= ruleFor(disease).cluster_min_cases) {
      alerts.push({ type: 'WARNING', disease, msg: `Emerging cluster: ${n} ${disease} positives at ${branch} on ${day}.` });
    }
  }
  return { days, data, alerts: alerts.map((a, i) => ({ id: i + 1, time: `last ${plural}`, ...a })) };
}

// GET /api/disaster/surveillance?timeFilter=1D|3D|7D|14D|30D
export const getSurveillanceData = async (req, res) => {
  try {
    const { data, days } = await compute(req.query.timeFilter);
    res.json({ success: true, window_days: days, data });
  } catch (error) {
    console.error('Error fetching surveillance data:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/disaster/alerts?timeFilter=
export const getAlerts = async (req, res) => {
  try {
    const { alerts } = await compute(req.query.timeFilter);
    res.json({ success: true, data: alerts });
  } catch (error) {
    console.error('Error computing surveillance alerts:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/disaster/resources?district= — beds, oxygen beds and testing stock
// in the district's facilities, to read next to its disease burden (#102).
export const getDistrictResources = async (req, res) => {
  try {
    const district = String(req.query.district || '');
    const [[beds]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(bd.status = 'Available') AS available,
              SUM(bd.has_oxygen = 1) AS oxygen_total, SUM(bd.has_oxygen = 1 AND bd.status = 'Available') AS oxygen_available,
              SUM(bd.bed_type IN ('ICU','HDU')) AS icu_total, SUM(bd.bed_type IN ('ICU','HDU') AND bd.status = 'Available') AS icu_available
         FROM beds bd JOIN branches b ON b.id = bd.branch_id JOIN districts d ON d.id = b.district_id WHERE d.name = ?`, [district]);
    const rules = await loadRules();
    const [tests] = await pool.query("SELECT id, test_name FROM lab_tests WHERE status = 'Active'");
    const kits = [];
    for (const rule of rules) {
      const ids = tests.filter((t) => rule.re && rule.re.test(t.test_name)).map((t) => t.id);
      if (!ids.length) continue;
      // Tests the district can still run: the scarcest mapped reagent decides.
      const [[stock]] = await pool.query(
        `SELECT MIN(x.possible) AS tests_possible, COUNT(*) AS items FROM (
           SELECT m.item_id, FLOOR(COALESCE(SUM(ib.quantity_available), 0) / NULLIF(MAX(m.quantity_required), 0)) AS possible
             FROM inventory_test_mapping m
             LEFT JOIN inventory_batches ib ON ib.item_id = m.item_id AND ib.status = 'Active'
                  AND (ib.expiry_date IS NULL OR ib.expiry_date >= CURDATE())
                  AND ib.branch_id IN (SELECT b.id FROM branches b JOIN districts d ON d.id = b.district_id WHERE d.name = ?)
            WHERE m.test_id IN (?) GROUP BY m.item_id) x`, [district, ids]);
      if (Number(stock.items)) {
        const n = Number(stock.tests_possible) || 0;
        kits.push({ disease: rule.disease, tests_possible: n, level: n < 50 ? 'LOW' : n < 200 ? 'MEDIUM' : 'NORMAL' });
      }
    }
    const [facilities] = await pool.query(
      "SELECT b.branch_name FROM branches b JOIN districts d ON d.id = b.district_id WHERE d.name = ? AND b.status = 'Active' ORDER BY b.branch_name",
      [district]);
    const n = (v) => Number(v) || 0;
    res.json({
      success: true,
      beds: { total: n(beds.total), available: n(beds.available), oxygen_total: n(beds.oxygen_total), oxygen_available: n(beds.oxygen_available),
        icu_total: n(beds.icu_total), icu_available: n(beds.icu_available) },
      kits,
      facilities: facilities.map((f) => f.branch_name),
    });
  } catch (error) {
    console.error('Error fetching district resources:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Surveillance thresholds — Government-approved values, set by an admin.
export const listRules = async (req, res) => {
  try {
    const rules = await loadRules(true);
    res.json({ success: true, rules: rules.map(({ re, ...r }) => ({ ...r, pattern_valid: !!re })) });
  } catch (error) {
    console.error('Error listing surveillance rules:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateRule = async (req, res) => {
  try {
    const b = req.body || {};
    const ints = ['medium_threshold', 'high_threshold', 'rise_alert_percent', 'cluster_min_cases'].map((k) => [k, parseInt(b[k], 10)]);
    if (ints.some(([, v]) => !Number.isFinite(v) || v < 1)) {
      return res.status(400).json({ success: false, message: 'Thresholds must be whole numbers of at least 1.' });
    }
    const v = Object.fromEntries(ints);
    if (v.high_threshold <= v.medium_threshold) {
      return res.status(400).json({ success: false, message: 'The HIGH threshold must be above the MEDIUM threshold.' });
    }
    if (b.test_pattern !== undefined) {
      try { new RegExp(b.test_pattern, 'i'); } catch { return res.status(400).json({ success: false, message: 'The test pattern is not a valid expression.' }); }
    }
    const [r] = await pool.query(
      `UPDATE surveillance_diseases SET medium_threshold = ?, high_threshold = ?, rise_alert_percent = ?, cluster_min_cases = ?,
              test_pattern = COALESCE(?, test_pattern), active = COALESCE(?, active), updated_by = ? WHERE id = ?`,
      [v.medium_threshold, v.high_threshold, v.rise_alert_percent, v.cluster_min_cases, b.test_pattern?.trim() || null,
       b.active === undefined ? null : (b.active ? 1 : 0), req.user?.id || null, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Rule not found.' });
    res.json({ success: true, message: 'Surveillance thresholds updated.' });
  } catch (error) {
    console.error('Error updating surveillance rule:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
