// Turnaround-time targets for the smart worklist.
export const DEFAULT_TAT_MINUTES = 240;
const PRIORITY_FACTOR = { STAT: 0.25, Urgent: 0.5, Routine: 1 };
const AT_RISK_FRACTION = 0.75;

// Effective target (minutes) for one test: its own, else its department's,
// else the system default — tightened for STAT / Urgent.
export function effectiveTat({ testTat, categoryTat, priority }) {
  const base = Number(testTat) || Number(categoryTat) || DEFAULT_TAT_MINUTES;
  return Math.max(15, Math.round(base * (PRIORITY_FACTOR[priority] ?? 1)));
}

// Open work is judged against how long it has been waiting; finished work
// against how long it actually took.
export function tatStatus({ elapsedMinutes, tat, done }) {
  if (done) return elapsedMinutes > tat ? 'Breached' : 'Met';
  if (elapsedMinutes > tat) return 'Breached';
  if (elapsedMinutes >= tat * AT_RISK_FRACTION) return 'At risk';
  return 'On time';
}
