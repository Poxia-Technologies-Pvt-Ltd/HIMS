import db from '../config/db.js';

// Server-side flagging of analyzer / manual results by configurable rules:
//   Invalid   the reading is technically unusable (instrument error token,
//             non-numeric value for a numeric parameter, outside the
//             analyzer's measurable range, analyzer invalid flag)
//   Critical  at or beyond the parameter's critical low / high limit
//   High/Low  outside the reference range (demographic where configured)
//   Delta     moved more than the configured % / absolute since the same
//             patient's previous result (an extra marker, independent of the above)
// Rules: per parameter on lab_test_parameters, defaults in result_flag_settings.

export const FLAG = {
  NORMAL: 'Normal', HIGH: 'High', LOW: 'Low',
  CRITICAL_HIGH: 'Critical High', CRITICAL_LOW: 'Critical Low', INVALID: 'Invalid',
};
const LETTER = { Normal: 'N', High: 'H', Low: 'L', 'Critical High': 'HH', 'Critical Low': 'LL', Invalid: 'I' };

const DEFAULTS = {
  invalid_tokens: '---,--,ERR,ERROR,OVER,INVALID,N/A,NA,NULL',
  invalid_analyzer_flags: 'OVER,ERR,ERROR,INVALID,E',
  delta_enabled: '1', delta_default_days: '30', delta_default_percent: '50',
  kids_max_age_years: '12', trust_analyzer_alerts: '1',
};

let cache = { at: 0, value: null };
export async function getFlagSettings(conn = db, { fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < 60_000) return cache.value;
  const [rows] = await conn.query('SELECT setting_key, setting_value FROM result_flag_settings');
  const value = { ...DEFAULTS };
  for (const r of rows) value[r.setting_key] = r.setting_value ?? '';
  cache = { at: Date.now(), value };
  return value;
}
export const clearFlagSettingsCache = () => { cache = { at: 0, value: null }; };

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const csv = (s) => String(s || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// "18.9", "<0.5", ">1000" -> { n, censor }. Anything else -> null.
export function parseValue(raw) {
  const m = String(raw ?? '').trim().match(/^([<>]=?)?\s*(-?\d+(?:\.\d+)?)$/);
  return m ? { n: Number(m[2]), censor: m[1] ? m[1][0] : null } : null;
}

// "4.0-10.0", "4.0 - 10.0", "<5", ">=2"
export function parseRangeText(text) {
  const t = String(text || '').trim();
  let m = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)$/i);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = t.match(/^<\s*=?\s*(-?\d+(?:\.\d+)?)$/); if (m) return { min: null, max: Number(m[1]) };
  m = t.match(/^>\s*=?\s*(-?\d+(?:\.\d+)?)$/); if (m) return { min: Number(m[1]), max: null };
  return null;
}

const ageYears = (dob) => {
  if (!dob) return null;
  const d = new Date(dob);
  return Number.isNaN(d.getTime()) ? null : (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
};

function pickRange(p, patient, settings) {
  if (!p) return null;
  const rng = (a, b) => (num(a) !== null || num(b) !== null ? { min: num(a), max: num(b) } : null);
  if (p.use_demographic_ranges) {
    const age = ageYears(patient?.dob);
    const g = String(patient?.gender || '').toLowerCase();
    let r = null;
    if (age !== null && age < Number(settings.kids_max_age_years || 12)) r = rng(p.kids_min_value, p.kids_max_value);
    if (!r && g.startsWith('m')) r = rng(p.men_min_value, p.men_max_value);
    if (!r && g.startsWith('f')) r = rng(p.women_min_value, p.women_max_value);
    if (r) return r;
  }
  return rng(p.min_value, p.max_value);
}

const rangeText = (r) => (r.min !== null && r.max !== null ? `${r.min}-${r.max}` : r.max !== null ? `<${r.max}` : `>${r.min}`);

// Annotates every result row with result_flag / flag / flag_reasons / delta and
// returns a roll-up. `results` is the FULL list for the result record, so the
// evaluation is idempotent across the incremental saves an analyzer makes.
export async function evaluateResults(conn, { results, test_id, patient_id, exclude_result_id = null, before = new Date() }) {
  const settings = await getFlagSettings(conn);
  const summary = { abnormal: 0, critical: 0, invalid: 0, delta: 0 };
  if (!Array.isArray(results) || results.length === 0) return { results: results || [], summary };

  let params = [];
  if (test_id) [params] = await conn.query("SELECT * FROM lab_test_parameters WHERE test_id = ? AND status = 'Active'", [test_id]);
  const byName = new Map();
  for (const p of params) {
    [p.parameter_name, p.parameter_code, p.machine_parameter_code].filter(Boolean).forEach((k) => { if (!byName.has(norm(k))) byName.set(norm(k), p); });
  }

  let patient = null;
  let previous = new Map();
  if (patient_id) {
    [[patient]] = await conn.query('SELECT gender, dob FROM patients WHERE id = ?', [patient_id]);
    if (settings.delta_enabled === '1' && test_id) {
      const [prev] = await conn.query(
        `SELECT r.results_json, r.tested_at FROM lab_test_result r
         LEFT JOIN bill_items bi ON bi.id = r.bill_item_id
         WHERE r.patient_id = ? AND (r.test_id = ? OR bi.service_id = ?) AND r.tested_at < ? ${exclude_result_id ? 'AND r.id <> ?' : ''}
         ORDER BY r.tested_at DESC LIMIT 1`,
        exclude_result_id ? [patient_id, test_id, test_id, before, exclude_result_id] : [patient_id, test_id, test_id, before]
      );
      if (prev[0]) {
        try {
          const prevRows = typeof prev[0].results_json === 'string' ? JSON.parse(prev[0].results_json || '[]') : (prev[0].results_json || []);
          for (const r of prevRows) previous.set(norm(r.parameter_name), { value: r.result_value, at: prev[0].tested_at });
        } catch { /* unreadable history: skip delta */ }
      }
    }
  }

  const invalidTokens = csv(settings.invalid_tokens);
  const invalidAnalyzerFlags = csv(settings.invalid_analyzer_flags);

  const out = results.map((row) => {
    if (!row || row.is_subheader) return row;
    const p = byName.get(norm(row.parameter_name)) || null;
    const raw = String(row.result_value ?? '').trim();
    const analyzerFlag = String(row.analyzer_flag ?? row.flag ?? '').trim().toUpperCase();
    const reasons = [];
    let status = FLAG.NORMAL;

    // Fill what the analyzer left blank from the test master.
    let range = pickRange(p, patient, settings);
    if (!range && row.reference_range) range = parseRangeText(row.reference_range);
    const filled = { ...row };
    if (!filled.unit && p?.parameter_unit) filled.unit = p.parameter_unit;
    if (!filled.reference_range && range) filled.reference_range = rangeText(range);

    const isNumericParam = !p || (p.result_type || 'numeric') === 'numeric';
    const v = parseValue(raw);

    // ── Technically invalid ─────────────────────────────────────────────
    if (raw === '' ) { reasons.push({ code: 'EMPTY', message: 'No value received' }); status = FLAG.INVALID; }
    else if (/^[*#?\-.\s]+$/.test(raw) || invalidTokens.includes(raw.toUpperCase())) { reasons.push({ code: 'INSTRUMENT_ERROR', message: `Analyzer could not measure ("${raw}")` }); status = FLAG.INVALID; }
    else if (invalidAnalyzerFlags.includes(analyzerFlag)) { reasons.push({ code: 'ANALYZER_INVALID', message: `Analyzer flagged the reading invalid (${analyzerFlag})` }); status = FLAG.INVALID; }
    else if (p && isNumericParam && !v) { reasons.push({ code: 'NON_NUMERIC', message: `"${raw}" is not a number` }); status = FLAG.INVALID; }
    else if (v && p) {
      const mmin = num(p.measurable_min); const mmax = num(p.measurable_max);
      if (mmin !== null && v.n < mmin) { reasons.push({ code: 'BELOW_MEASURABLE', message: `Below the measurable range (${mmin})` }); status = FLAG.INVALID; }
      else if (mmax !== null && v.n > mmax) { reasons.push({ code: 'ABOVE_MEASURABLE', message: `Above the measurable range (${mmax})` }); status = FLAG.INVALID; }
    }

    // ── Critical / abnormal ─────────────────────────────────────────────
    if (status !== FLAG.INVALID && v && isNumericParam) {
      const clo = num(p?.critical_low); const chi = num(p?.critical_high);
      if (clo !== null && v.n <= clo) { status = FLAG.CRITICAL_LOW; reasons.push({ code: 'CRITICAL', message: `Critical low (≤ ${clo})` }); }
      else if (chi !== null && v.n >= chi) { status = FLAG.CRITICAL_HIGH; reasons.push({ code: 'CRITICAL', message: `Critical high (≥ ${chi})` }); }
      else if (range) {
        if (range.min !== null && v.n < range.min) { status = FLAG.LOW; reasons.push({ code: 'BELOW_RANGE', message: `Below reference range (${filled.reference_range})` }); }
        else if (range.max !== null && v.n > range.max) { status = FLAG.HIGH; reasons.push({ code: 'ABOVE_RANGE', message: `Above reference range (${filled.reference_range})` }); }
      } else if (settings.trust_analyzer_alerts === '1') {
        if (analyzerFlag === 'H' || analyzerFlag === 'HH') { status = FLAG.HIGH; reasons.push({ code: 'ANALYZER_ALERT', message: 'High per analyzer (no reference range configured)' }); }
        else if (analyzerFlag === 'L' || analyzerFlag === 'LL') { status = FLAG.LOW; reasons.push({ code: 'ANALYZER_ALERT', message: 'Low per analyzer (no reference range configured)' }); }
      }
    }

    // ── Delta check ─────────────────────────────────────────────────────
    let delta = null;
    const prev = previous.get(norm(row.parameter_name));
    if (prev && status !== FLAG.INVALID && v && isNumericParam) {
      const pv = parseValue(prev.value);
      const days = num(p?.delta_days) ?? num(settings.delta_default_days) ?? 30;
      const ageDays = (new Date(before).getTime() - new Date(prev.at).getTime()) / 86400000;
      const pctLimit = num(p?.delta_percent) ?? num(settings.delta_default_percent);
      const absLimit = num(p?.delta_absolute);
      if (pv && ageDays <= days && (pctLimit !== null || absLimit !== null)) {
        const change = v.n - pv.n;
        const pct = pv.n !== 0 ? (Math.abs(change) / Math.abs(pv.n)) * 100 : null;
        const tripped = (pctLimit !== null && pct !== null && pct > pctLimit) || (absLimit !== null && Math.abs(change) > absLimit);
        if (tripped) {
          delta = { previous_value: prev.value, previous_at: prev.at, change: Math.round(change * 1000) / 1000, change_percent: pct === null ? null : Math.round(pct * 10) / 10 };
          reasons.push({ code: 'DELTA', message: `Changed ${change > 0 ? '+' : ''}${delta.change}${pct === null ? '' : ` (${delta.change_percent}%)`} from previous ${prev.value}` });
        }
      }
    }

    if (status === FLAG.INVALID) summary.invalid += 1;
    if (status === FLAG.CRITICAL_HIGH || status === FLAG.CRITICAL_LOW) summary.critical += 1;
    if (status !== FLAG.NORMAL && status !== FLAG.INVALID) summary.abnormal += 1;
    if (delta) summary.delta += 1;

    return {
      ...filled,
      analyzer_flag: row.analyzer_flag ?? (row.flag || undefined),
      result_flag: status,
      flag: LETTER[status],
      flag_reasons: reasons,
      is_critical: status === FLAG.CRITICAL_HIGH || status === FLAG.CRITICAL_LOW,
      delta,
    };
  });

  return { results: out, summary };
}

// For payloads sent to CDAC / CARE, which only understand normal / high / low.
export const externalFlag = (f) => {
  const s = String(f || 'normal').toLowerCase();
  if (s.includes('high')) return 'high';
  if (s.includes('low')) return 'low';
  if (s === 'invalid') return '';
  return 'normal';
};
