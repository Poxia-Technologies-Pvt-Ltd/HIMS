import { roundMoney, daysInMonth } from './hr.js';

// Monthly salary for contract/private staff (CTC-style structure).
//
//  Pay ratio   Calendar: paid days / calendar days. Fixed30: (30 - LOP - days
//              not employed) / 30, the "30-day month" many hospitals use.
//              A structure that is not attendance-based (fixed pay) loses
//              only unpaid leave days.
//  Earnings    every structure component scaled by the pay ratio.
//  Overtime    hours x rate; rate defaults to basic / (26 x 8) x multiplier.
//  PF          % of earned basic, capped at the PF wage ceiling unless the
//              employee contributes on full basic. Employer pays the same %.
//  ESI         only while the fixed monthly gross is within the ESI ceiling;
//              employee and employer shares are rounded up to the rupee.
//  PT          Professional Tax: a flat amount once gross reaches the
//              threshold (a different one in February), set per state in
//              Attendance > Rules. Off (0) by default.
//  TDS         the structure's monthly figure, editable on the payslip.

export const EARNING_KEYS = ['basic', 'hra', 'conveyance', 'medical', 'special_allowance', 'other_allowance'];

export const structureGross = (s) => EARNING_KEYS.reduce((n, k) => n + Number(s[k] || 0), 0);

export function computePayslip({ structure: s, attendance, settings, period, overrides = {} }) {
  const calendarDays = daysInMonth(period);
  // Days still to come in a running month (draft only) are assumed worked.
  const upcoming = attendance.upcoming_days || 0;
  attendance = { ...attendance, employed_days: attendance.employed_days + upcoming, paid_days: attendance.paid_days + upcoming };
  // Fixed monthly pay: every day employed is paid except unpaid (LOP) leave.
  if (s.attendance_based !== undefined && !Number(s.attendance_based)) {
    const paid = attendance.employed_days - (attendance.unpaid_leave_days || 0);
    attendance = { ...attendance, paid_days: paid, lop_days: attendance.employed_days - paid };
  }
  const notEmployed = calendarDays - attendance.employed_days;
  let ratio;
  let daysInMonthBasis;
  let paidDays;
  if (settings.lop_basis === 'Fixed30') {
    daysInMonthBasis = 30;
    paidDays = Math.max(0, 30 - attendance.lop_days - notEmployed);
    ratio = paidDays / 30;
  } else {
    daysInMonthBasis = calendarDays;
    paidDays = attendance.paid_days;
    ratio = paidDays / calendarDays;
  }
  ratio = Math.min(1, Math.max(0, ratio));

  const earn = {};
  EARNING_KEYS.forEach((k) => { earn[k] = roundMoney(Math.round(Number(s[k] || 0) * ratio)); });

  const otHours = overrides.ot_hours !== undefined ? Number(overrides.ot_hours) : Number(attendance.ot_hours || 0);
  const otRate = s.ot_rate_per_hour !== null && s.ot_rate_per_hour !== undefined
    ? Number(s.ot_rate_per_hour)
    : (Number(s.basic || 0) / (26 * 8)) * settings.ot_multiplier;
  const otAmount = roundMoney(Math.round(otHours * otRate));
  const arrears = roundMoney(overrides.arrears || 0);

  const gross = roundMoney(EARNING_KEYS.reduce((n, k) => n + earn[k], 0) + otAmount + arrears);

  let pfEmployee = 0;
  let pfEmployer = 0;
  if (Number(s.pf_applicable)) {
    const pfWage = Number(s.pf_on_full_basic) ? earn.basic : Math.min(earn.basic, settings.pf_wage_ceiling);
    pfEmployee = Math.round(pfWage * settings.pf_employee_pct / 100);
    pfEmployer = Math.round(pfWage * settings.pf_employer_pct / 100);
  }

  let esiEmployee = 0;
  let esiEmployer = 0;
  if (Number(s.esi_applicable) && structureGross(s) <= settings.esi_gross_ceiling) {
    esiEmployee = Math.ceil(gross * settings.esi_employee_pct / 100);
    esiEmployer = Math.ceil(gross * settings.esi_employer_pct / 100);
  }

  let pt = 0;
  if (Number(s.pt_applicable) && gross >= settings.pt_threshold) {
    pt = period.endsWith('-02') ? settings.pt_february_amount : settings.pt_amount;
  }

  const tds = roundMoney(overrides.tds !== undefined ? overrides.tds : s.monthly_tds || 0);
  const other = roundMoney(overrides.other_deductions || 0);
  const totalDeductions = roundMoney(pfEmployee + esiEmployee + pt + tds + other);

  return {
    days_in_month: daysInMonthBasis,
    paid_days: Math.round(paidDays * 10) / 10,
    lop_days: Math.round((daysInMonthBasis - paidDays) * 10) / 10,
    present_days: attendance.present_days,
    leave_days: attendance.leave_days,
    ot_hours: Math.round(otHours * 100) / 100,
    ...earn,
    ot_amount: otAmount,
    arrears,
    gross,
    pf_employee: pfEmployee,
    esi_employee: esiEmployee,
    professional_tax: pt,
    tds,
    other_deductions: other,
    total_deductions: totalDeductions,
    net_pay: roundMoney(gross - totalDeductions),
    pf_employer: pfEmployer,
    esi_employer: esiEmployer,
  };
}

// Indian-English amount in words, for the payslip.
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${below100(n % 100)}` : ''}` : below100(n));

export function rupeesInWords(amount) {
  let n = Math.floor(Math.abs(Number(amount) || 0));
  if (n === 0) return 'Zero Rupees Only';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  return `${parts.join(' ')} Rupees Only`;
}
