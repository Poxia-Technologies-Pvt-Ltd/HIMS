// Point-of-care testing rules (tender #123).

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Flag a result against the reference and critical limits. Non-numeric results are qualitative. */
export function flagResult(value, { ref_low, ref_high, crit_low, crit_high } = {}) {
  const v = num(value);
  if (v === null) return 'Qualitative';
  const cl = num(crit_low); const ch = num(crit_high); const lo = num(ref_low); const hi = num(ref_high);
  if (cl !== null && v <= cl) return 'Critical low';
  if (ch !== null && v >= ch) return 'Critical high';
  if (lo !== null && v < lo) return 'Low';
  if (hi !== null && v > hi) return 'High';
  return 'Normal';
}

/** Has this device passed quality control recently enough to be used? latest = { passed, performed_at } or null. */
export function qcCurrent(latest, intervalHours = 24, now = new Date()) {
  if (!latest) return { ok: false, reason: 'No quality-control result has been recorded for this device.' };
  if (!latest.passed) return { ok: false, reason: 'The latest quality-control run failed. Repeat it and pass before testing patients.' };
  const hours = (now - new Date(latest.performed_at)) / 3600000;
  if (hours > intervalHours) return { ok: false, reason: `Quality control was last passed ${Math.floor(hours)} hours ago (it is due every ${intervalHours} hours).` };
  return { ok: true };
}
