// Westgard multirule evaluation for one IQC value.
//
// z        — this run's z-score: (value - target mean) / target SD
// history  — z-scores of the earlier runs of the SAME control material (same
//            lot and level), newest first
// rules    — the rules enabled for the material, e.g. ['1-2s','1-3s','2-2s','R-4s','4-1s','10x']
//
// Rejection rules (run is out of control, patient results must be held):
//   1-3s  one value beyond ±3 SD
//   2-2s  this and the previous value beyond 2 SD on the same side
//   R-4s  this and the previous value beyond 2 SD on opposite sides (range > 4 SD)
//   4-1s  this and the previous three beyond 1 SD on the same side
//   10x   this and the previous nine on the same side of the mean
// Warning rule:
//   1-2s  one value beyond ±2 SD with no rejection rule broken
//
// R-4s is classically a within-run rule across two levels; with one value per
// material per run it is applied across consecutive runs of the material.

export const ALL_RULES = ['1-2s', '1-3s', '2-2s', 'R-4s', '4-1s', '10x'];

const sameSide = (values, limit) =>
  values.every((v) => v > limit) || values.every((v) => v < -limit);

export function evaluateWestgard(z, history = [], rules = ALL_RULES) {
  const on = new Set(rules);
  const prev = history[0];
  const violations = [];

  if (on.has('1-3s') && Math.abs(z) > 3) violations.push('1-3s');
  if (on.has('2-2s') && prev !== undefined && sameSide([z, prev], 2)) violations.push('2-2s');
  if (on.has('R-4s') && prev !== undefined && ((z > 2 && prev < -2) || (z < -2 && prev > 2))) violations.push('R-4s');
  if (on.has('4-1s') && history.length >= 3 && sameSide([z, ...history.slice(0, 3)], 1)) violations.push('4-1s');
  if (on.has('10x') && history.length >= 9 && sameSide([z, ...history.slice(0, 9)], 0)) violations.push('10x');

  if (violations.length) return { status: 'Rejected', violations };
  if (on.has('1-2s') && Math.abs(z) > 2) return { status: 'Warning', violations: ['1-2s'] };
  return { status: 'Accepted', violations: [] };
}

// EQAS standard deviation index -> performance band (|SDI| ≤2 acceptable,
// ≤3 warning, >3 unacceptable — the usual EQAS scoring).
export function sdiPerformance(ourResult, assignedValue, assignedSd) {
  const ours = Number(ourResult); const target = Number(assignedValue); const sd = Number(assignedSd);
  if (![ours, target, sd].every(Number.isFinite) || sd <= 0) return { sdi: null, performance: 'Pending' };
  const sdi = (ours - target) / sd;
  const a = Math.abs(sdi);
  return { sdi: Math.round(sdi * 1000) / 1000, performance: a <= 2 ? 'Acceptable' : a <= 3 ? 'Warning' : 'Unacceptable' };
}
