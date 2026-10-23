// Blood bank rules (tender #123), kept apart from the database code so they can be read and tested
// on their own. The figures follow the usual Indian blood-bank practice (donor selection criteria
// and component shelf lives); a facility whose licence says otherwise changes them here.

export const COMPONENTS = ['Whole Blood', 'PRBC', 'FFP', 'Platelets', 'Cryoprecipitate', 'Plasma'];
const RED_CELL = new Set(['Whole Blood', 'PRBC']);
const PLASMA = new Set(['FFP', 'Cryoprecipitate', 'Plasma']);

// Days a component may be kept, counted from the collection of the donation.
export const SHELF_DAYS = { 'Whole Blood': 35, PRBC: 35, FFP: 365, Platelets: 5, Cryoprecipitate: 365, Plasma: 365 };
export const expiryFor = (component, collectedAt) => new Date(new Date(collectedAt).getTime() + SHELF_DAYS[component] * 86400000);

// Which components a donation can be separated into.
export const PROCESSABLE = ['PRBC', 'FFP', 'Platelets', 'Cryoprecipitate'];

const ABO = ['A', 'B', 'AB', 'O'];
/** ABO of donor red cells → recipients that can receive them. */
const RBC_TO = { O: ['O', 'A', 'B', 'AB'], A: ['A', 'AB'], B: ['B', 'AB'], AB: ['AB'] };
/** ABO of donor plasma → recipients that can receive it (the reverse of red cells). */
const PLASMA_TO = { AB: ['AB', 'A', 'B', 'O'], A: ['A', 'O'], B: ['B', 'O'], O: ['O'] };

/**
 * Is this unit suitable for this recipient?
 * Returns { ok, level: 'identical' | 'compatible' | 'incompatible', warnings[], reason? }.
 * An unknown group on either side is never accepted here; an emergency release of uncrossmatched
 * blood is a separate, recorded decision (see the issue endpoint), not a loophole in this rule.
 */
export function compatibility(unit, recipient) {
  const ua = unit.abo; const ur = unit.rh; const ra = recipient.abo; const rr = recipient.rh;
  if (!ABO.includes(ua) || !['Pos', 'Neg'].includes(ur)) return { ok: false, level: 'incompatible', warnings: [], reason: 'The blood group of this unit is not confirmed.' };
  if (!ABO.includes(ra) || !['Pos', 'Neg'].includes(rr)) return { ok: false, level: 'incompatible', warnings: [], reason: 'The recipient\'s blood group is not known. Group the patient first.' };
  const warnings = [];
  const identical = ua === ra && ur === rr;

  if (RED_CELL.has(unit.component)) {
    if (!RBC_TO[ua].includes(ra)) return { ok: false, level: 'incompatible', warnings, reason: `${ua} red cells cannot be given to a ${ra} patient.` };
    if (ur === 'Pos' && rr === 'Neg') return { ok: false, level: 'incompatible', warnings, reason: 'Rh-positive red cells cannot be given to an Rh-negative patient.' };
    return { ok: true, level: identical ? 'identical' : 'compatible', warnings };
  }
  if (PLASMA.has(unit.component)) {
    if (!PLASMA_TO[ua].includes(ra)) return { ok: false, level: 'incompatible', warnings, reason: `${ua} plasma cannot be given to a ${ra} patient.` };
    return { ok: true, level: ua === ra ? 'identical' : 'compatible', warnings };
  }
  // Platelets: ABO-identical is preferred; plasma-compatible is acceptable with a warning.
  if (unit.component === 'Platelets') {
    if (ua !== ra) {
      if (!PLASMA_TO[ua].includes(ra)) return { ok: false, level: 'incompatible', warnings, reason: `${ua} platelets (plasma) cannot be given to a ${ra} patient.` };
      warnings.push(RBC_TO[ua].includes(ra)
        ? 'ABO non-identical platelets: watch for haemolysis from donor plasma antibodies.'
        : 'ABO major mismatch: the patient has antibodies to the donor platelets, so the count may rise less than expected.');
    }
    if (ur === 'Pos' && rr === 'Neg') warnings.push('Rh-positive platelets to an Rh-negative patient: give anti-D immunoglobulin, especially to women who may bear children.');
    return { ok: true, level: identical ? 'identical' : 'compatible', warnings };
  }
  return { ok: false, level: 'incompatible', warnings, reason: 'Unknown component.' };
}

const ageYears = (dob, now) => { const d = new Date(dob); let a = now.getFullYear() - d.getFullYear(); if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--; return a; };

/** Donor selection. Returns an array of reasons the donor cannot give today; empty means eligible. */
export function donorProblems(donor, vitals = {}, now = new Date()) {
  const p = [];
  const age = ageYears(donor.dob, now);
  if (age < 18 || age > 65) p.push(`Age ${age}: donors must be 18 to 65 years old.`);
  if (donor.deferred_until && new Date(donor.deferred_until) > now) p.push(`Deferred until ${new Date(donor.deferred_until).toLocaleDateString('en-IN')}${donor.deferral_reason ? ` (${donor.deferral_reason})` : ''}.`);
  if (donor.last_donation_date) {
    const need = /^f/i.test(donor.gender || '') ? 120 : 90;
    const days = Math.floor((now - new Date(donor.last_donation_date)) / 86400000);
    if (days < need) p.push(`Last donation ${days} day(s) ago; the minimum gap is ${need} days.`);
  }
  const { hb, weight, systolic, diastolic, pulse } = vitals;
  if (hb == null || Number(hb) < 12.5) p.push(`Haemoglobin ${hb ?? 'not recorded'} g/dL: at least 12.5 g/dL is required.`);
  if (weight == null || Number(weight) < 45) p.push(`Weight ${weight ?? 'not recorded'} kg: at least 45 kg is required.`);
  if (systolic == null || diastolic == null || systolic < 100 || systolic > 180 || diastolic < 50 || diastolic > 100) p.push('Blood pressure is outside 100–180 / 50–100 mmHg or not recorded.');
  if (pulse == null || pulse < 50 || pulse > 100) p.push('Pulse is outside 50–100 per minute or not recorded.');
  return p;
}

export const TTI_TESTS = ['hiv', 'hbv', 'hcv', 'syphilis', 'malaria'];
/** Combines the five mandatory screening tests into Pending / Cleared / Reactive. */
export function ttiOutcome(results = {}) {
  const vals = TTI_TESTS.map((t) => String(results[t] || '').toLowerCase());
  if (vals.some((v) => v.startsWith('reactive') || v === 'positive')) return 'Reactive';
  if (vals.every((v) => v.startsWith('non') || v === 'negative')) return 'Cleared';
  return 'Pending';
}

/** Statuses a unit may be issued from. */
export const ISSUABLE = new Set(['Available', 'Reserved']);
