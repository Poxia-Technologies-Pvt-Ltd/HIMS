import { normalizeRole } from '../middleware/auth.js';

// Per-discipline validation / authorization workflow (lab_verification_workflows).
export const TECHNICAL_ROLE_CHOICES = ['Lab Technician', 'Lab Head', 'Admin', 'Super Admin'];
export const CLINICAL_ROLE_CHOICES = ['Lab Head', 'Admin', 'Super Admin'];

const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export async function loadWorkflows(conn) {
  const [rows] = await conn.query('SELECT * FROM lab_verification_workflows');
  const shape = (r) => ({
    category_id: r.category_id, levels: r.levels,
    technical_roles: csv(r.technical_roles), clinical_roles: csv(r.clinical_roles),
    enforce_segregation: !!r.enforce_segregation, auto_verify_normal: !!r.auto_verify_normal,
    critical_notify: r.critical_notify === undefined ? true : !!r.critical_notify,
    critical_notify_minutes: Number(r.critical_notify_minutes) || 30,
    critical_block_approval: r.critical_block_approval === undefined ? true : !!r.critical_block_approval,
  });
  const map = new Map(rows.map((r) => [Number(r.category_id), shape(r)]));
  const fallback = map.get(0) || shape({ category_id: 0, levels: 'Two-level', technical_roles: 'Lab Technician,Lab Head,Admin,Super Admin', clinical_roles: 'Lab Head,Admin,Super Admin', enforce_segregation: 1, auto_verify_normal: 0 });
  return { forCategory: (id) => map.get(Number(id)) || fallback, defaultWorkflow: fallback, map };
}

// What may `user` do next with a result in `status`? Returns
//   { step: 'technical' | 'clinical' | null, allowed: bool, reason?: string }
// `row` carries tested_by / verified_by of the result.
export function nextAction(workflow, status, user, row) {
  const role = normalizeRole(user?.role || '');
  let step = null;
  if (status === 'Test Done') step = workflow.levels === 'Single' ? 'clinical' : 'technical';
  else if (status === 'Verified') step = 'clinical';
  if (!step) return { step: null, allowed: false, reason: `Nothing to do — result is ${status}.` };

  const roles = step === 'technical' ? workflow.technical_roles : workflow.clinical_roles;
  if (!roles.includes(role)) {
    return { step, allowed: false, reason: `${step === 'technical' ? 'Technical validation' : 'Authorization'} for this discipline is limited to: ${roles.join(', ')}.` };
  }
  if (step === 'clinical' && workflow.enforce_segregation) {
    if (row.tested_by && Number(row.tested_by) === Number(user.id)) return { step, allowed: false, reason: 'You ran this test, so someone else must authorize it.' };
    if (row.verified_by && Number(row.verified_by) === Number(user.id)) return { step, allowed: false, reason: 'You validated this result, so someone else must authorize it.' };
  }
  return { step, allowed: true };
}
