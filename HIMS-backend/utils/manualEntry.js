import { normalizeRole } from '../middleware/auth.js';

// Manual result entry (tender #33): results normally arrive from the analyzer.
// A result typed in by hand — a test with no analyzer interface, an analyzer
// that is down, a repeat by the manual method — or a captured value changed by
// hand is allowed only to the roles below, and ALWAYS needs a reason. The reason
// is kept on the result and in its audit trail with who, when and the values.

export const MANUAL_REASONS = [
  { code: 'NOT_INTERFACED', label: 'Test is not interfaced to an analyzer (manual method)', note_required: false },
  { code: 'ANALYZER_DOWN', label: 'Analyzer is down or under maintenance', note_required: false },
  { code: 'LINK_FAILURE', label: 'Analyzer link / network failure', note_required: false },
  { code: 'REPEAT_MANUAL', label: 'Repeat or confirmation by the manual method', note_required: false },
  { code: 'CORRECTION', label: 'Correction of a captured value', note_required: true },
  { code: 'OTHER', label: 'Other (explain)', note_required: true },
];

// Who may enter results by hand. A registered LIS-Agent machine works as a Lab Technician.
export const MANUAL_ENTRY_ROLES = ['Admin', 'Super Admin', 'Lab Head', 'Lab Doctor', 'Lab Technician'];
export const canEnterManually = (user) => !!user && (user.isDeviceKey || MANUAL_ENTRY_ROLES.includes(normalizeRole(user.role)));

/**
 * Decides whether a save-test-results request is a manual entry and, if so,
 * whether it is acceptable. Returns { manual:false } for analyzer results, or
 * { manual:true, mode, code, label, note, text } — or { error:{status,code,message} }.
 *
 * Manual means: the caller says so (entry_mode 'manual' = typed, 'edited' = a
 * captured value changed), or a person (not a machine key) saved a result with
 * no analyzer behind it.
 */
export function manualEntryCheck(req) {
  const body = req.body || {};
  const mode = ['manual', 'edited'].includes(body.entry_mode) ? body.entry_mode : null;
  const typedByPerson = !body.machine_no && !req.user?.isDeviceKey;
  if (!mode && !typedByPerson) return { manual: false };

  if (!canEnterManually(req.user)) {
    return { error: { status: 403, code: 'MANUAL_ENTRY_NOT_ALLOWED', message: 'Your role cannot enter results by hand. Ask a Lab Technician, Lab Head or Admin.' } };
  }

  const note = String(body.manual_reason || '').trim();
  const code = String(body.manual_reason_code || '').trim();
  const known = MANUAL_REASONS.find((r) => r.code === code);
  const legacy = String(body.edit_reason || body.amend_reason || '').trim();

  let reason;
  if (known) {
    if (known.note_required && note.length < 5) {
      return { error: { status: 400, code: 'MANUAL_REASON_REQUIRED', message: `Explain the reason in a few words (at least 5 characters) — "${known.label}" needs a note.` } };
    }
    reason = { code: known.code, label: known.label, note };
  } else if (legacy.length >= 5) {
    // Older screens send a free-text reason only.
    reason = { code: 'OTHER', label: 'Other (explain)', note: legacy };
  } else {
    return { error: { status: 400, code: 'MANUAL_REASON_REQUIRED', message: 'A reason is required for every result entered or changed by hand.' } };
  }
  return { manual: true, mode: mode || 'manual', ...reason, text: reason.note ? `${reason.label}: ${reason.note}` : reason.label };
}
