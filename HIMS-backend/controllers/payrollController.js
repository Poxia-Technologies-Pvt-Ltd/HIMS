import PDFDocument from 'pdfkit';
import db from '../config/db.js';
import { normalizeRole } from '../middleware/auth.js';
import {
  HR_ADMIN_ROLES, readScope, writeScope, inScope, isISODate, isPeriod, nowIST, daysInMonth, getHrSettings,
  employeeForUser, roundMoney, fail,
} from '../utils/hr.js';
import { computeAttendance } from '../utils/attendanceCalc.js';
import { computePayslip, structureGross, EARNING_KEYS, rupeesInWords } from '../utils/payrollCalc.js';

const isHrAdmin = (req) => HR_ADMIN_ROLES.includes(normalizeRole(req.user?.role));
const periodEnd = (period) => `${period}-${String(daysInMonth(period)).padStart(2, '0')}`;

// ── Salary structures ─────────────────────────────────────────────────────────

// GET /api/payroll/salary?branch_id — every active employee with their current structure.
export const salaryOverview = async (req, res) => {
  try {
    const scope = readScope(req);
    const today = nowIST().date;
    const [rows] = await db.query(
      `SELECT e.id AS employee_id, e.employee_code, e.first_name, e.last_name, e.designation, e.employment_type,
              d.name AS department_name, ss.id AS structure_id, DATE_FORMAT(ss.effective_from, '%Y-%m-%d') AS effective_from,
              ss.basic, ss.hra, ss.conveyance, ss.medical, ss.special_allowance, ss.other_allowance,
              ss.pf_applicable, ss.esi_applicable, ss.pt_applicable, ss.monthly_tds, ss.attendance_based,
              e.bank_account_no IS NOT NULL AND e.bank_ifsc IS NOT NULL AS has_bank
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN salary_structures ss ON ss.id = (
           SELECT id FROM salary_structures WHERE employee_id = e.id AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1)
        WHERE e.status = 'Active' ${scope ? 'AND e.branch_id = ?' : ''}
        ORDER BY e.first_name`,
      scope ? [today, scope] : [today]
    );
    res.json({ success: true, employees: rows.map((r) => ({ ...r, gross: r.structure_id ? structureGross(r) : null })) });
  } catch (e) {
    console.error('salaryOverview error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/payroll/salary/:employeeId — structure history.
export const salaryHistory = async (req, res) => {
  try {
    const [[emp]] = await db.query('SELECT id, branch_id FROM employees WHERE id = ?', [req.params.employeeId]);
    if (!emp || !inScope(req, emp.branch_id)) return fail(res, 404, 'Employee not found');
    const [rows] = await db.query(
      `SELECT *, DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from FROM salary_structures
        WHERE employee_id = ? ORDER BY effective_from DESC`,
      [emp.id]
    );
    res.json({ success: true, structures: rows.map((r) => ({ ...r, gross: structureGross(r) })) });
  } catch (e) {
    console.error('salaryHistory error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/payroll/salary — a new structure from a date (same date replaces it).
export const saveSalaryStructure = async (req, res) => {
  try {
    const b = req.body;
    if (!isISODate(b.effective_from)) return fail(res, 400, 'Effective-from date is required');
    const [[emp]] = await db.query('SELECT id, branch_id FROM employees WHERE id = ?', [b.employee_id]);
    if (!emp || !inScope(req, emp.branch_id)) return fail(res, 404, 'Employee not found');
    // A finalised month cannot be re-priced retrospectively; pay the difference as arrears.
    const [[locked]] = await db.query(
      `SELECT period FROM payroll_runs WHERE branch_id = ? AND status <> 'Draft' AND period >= ? ORDER BY period DESC LIMIT 1`,
      [emp.branch_id, b.effective_from.slice(0, 7)]
    );
    if (locked) return fail(res, 409, `Payroll for ${locked.period} is finalised. Start the new structure after it and pay any difference as arrears.`);

    const vals = {};
    for (const k of EARNING_KEYS) {
      const n = Number(b[k] || 0);
      if (Number.isNaN(n) || n < 0 || n > 1e7) return fail(res, 400, `Invalid ${k.replace(/_/g, ' ')}`);
      vals[k] = roundMoney(n);
    }
    if (vals.basic <= 0) return fail(res, 400, 'Basic pay is required');
    const tds = Number(b.monthly_tds || 0);
    if (Number.isNaN(tds) || tds < 0) return fail(res, 400, 'Invalid TDS');
    const ot = b.ot_rate_per_hour === '' || b.ot_rate_per_hour === null || b.ot_rate_per_hour === undefined ? null : Number(b.ot_rate_per_hour);
    if (ot !== null && (Number.isNaN(ot) || ot < 0)) return fail(res, 400, 'Invalid overtime rate');
    const flag = (k, d) => (b[k] === undefined ? d : b[k] ? 1 : 0);

    await db.query(
      `INSERT INTO salary_structures (employee_id, effective_from, basic, hra, conveyance, medical, special_allowance, other_allowance,
                                      pf_applicable, pf_on_full_basic, esi_applicable, pt_applicable, monthly_tds, ot_rate_per_hour,
                                      attendance_based, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE basic = VALUES(basic), hra = VALUES(hra), conveyance = VALUES(conveyance), medical = VALUES(medical),
         special_allowance = VALUES(special_allowance), other_allowance = VALUES(other_allowance), pf_applicable = VALUES(pf_applicable),
         pf_on_full_basic = VALUES(pf_on_full_basic), esi_applicable = VALUES(esi_applicable), pt_applicable = VALUES(pt_applicable),
         monthly_tds = VALUES(monthly_tds), ot_rate_per_hour = VALUES(ot_rate_per_hour), attendance_based = VALUES(attendance_based),
         notes = VALUES(notes)`,
      [emp.id, b.effective_from, vals.basic, vals.hra, vals.conveyance, vals.medical, vals.special_allowance, vals.other_allowance,
        flag('pf_applicable', 1), flag('pf_on_full_basic', 0), flag('esi_applicable', 1), flag('pt_applicable', 1), roundMoney(tds), ot,
        flag('attendance_based', 1), b.notes ? String(b.notes).slice(0, 255) : null, req.user.id]
    );
    res.status(201).json({ success: true, gross: structureGross(vals) });
  } catch (e) {
    console.error('saveSalaryStructure error:', e);
    fail(res, 500, 'Server error');
  }
};

// ── Payroll runs ──────────────────────────────────────────────────────────────

// Builds (or rebuilds) every payslip in a draft run. Manual arrears, other
// deductions, TDS/OT overrides and remarks on existing payslips are kept.
const buildRun = async (conn, run) => {
  const from = `${run.period}-01`;
  const to = periodEnd(run.period);
  const settings = await getHrSettings(run.branch_id, conn);
  const [emps] = await conn.query(
    `SELECT e.id FROM employees e
      WHERE e.branch_id = ? AND (e.date_of_joining IS NULL OR e.date_of_joining <= ?)
        AND (e.status = 'Active' OR (e.date_of_leaving IS NOT NULL AND e.date_of_leaving >= ?))`,
    [run.branch_id, to, from]
  );
  const [structures] = emps.length ? await conn.query(
    `SELECT ss.* FROM salary_structures ss
      WHERE ss.employee_id IN (?) AND ss.id = (
        SELECT id FROM salary_structures x WHERE x.employee_id = ss.employee_id AND x.effective_from <= ? ORDER BY effective_from DESC LIMIT 1)`,
    [emps.map((e) => e.id), to]
  ) : [[]];
  const byEmp = new Map(structures.map((s) => [s.employee_id, s]));
  const payable = emps.filter((e) => byEmp.has(e.id)).map((e) => e.id);
  const attendance = await computeAttendance(payable, from, to, conn);

  const [existing] = await conn.query('SELECT * FROM payslips WHERE payroll_run_id = ?', [run.id]);
  const kept = new Map(existing.map((p) => [p.employee_id, p]));
  // Payslips keep their ids across rebuilds; only those no longer payable go.
  if (payable.length) await conn.query('DELETE FROM payslips WHERE payroll_run_id = ? AND employee_id NOT IN (?)', [run.id, payable]);
  else await conn.query('DELETE FROM payslips WHERE payroll_run_id = ?', [run.id]);

  let totals = { gross: 0, ded: 0, net: 0, employer: 0 };
  for (const empId of payable) {
    const s = byEmp.get(empId);
    const prev = kept.get(empId);
    const overrides = prev ? {
      arrears: prev.arrears, other_deductions: prev.other_deductions,
      ...(prev.tds_manual ? { tds: prev.tds } : {}),
      ...(prev.ot_manual ? { ot_hours: prev.ot_hours } : {}),
    } : {};
    const p = computePayslip({ structure: s, attendance: attendance.get(empId).summary, settings, period: run.period, overrides });
    const row = {
      payroll_run_id: run.id, employee_id: empId, salary_structure_id: s.id, ...p,
      remarks: prev?.remarks || null, tds_manual: prev?.tds_manual || 0, ot_manual: prev?.ot_manual || 0,
    };
    const cols = Object.keys(row);
    await conn.query(
      `INSERT INTO payslips (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${cols.filter((c) => !['payroll_run_id', 'employee_id'].includes(c)).map((c) => `${c} = VALUES(${c})`).join(', ')}`,
      cols.map((c) => row[c])
    );
    totals = { gross: totals.gross + p.gross, ded: totals.ded + p.total_deductions, net: totals.net + p.net_pay, employer: totals.employer + p.gross + p.pf_employer + p.esi_employer };
  }
  await conn.query(
    `UPDATE payroll_runs SET employee_count = ?, total_gross = ?, total_deductions = ?, total_net = ?, total_employer_cost = ? WHERE id = ?`,
    [payable.length, roundMoney(totals.gross), roundMoney(totals.ded), roundMoney(totals.net), roundMoney(totals.employer), run.id]
  );
  return { payslips: payable.length, without_structure: emps.length - payable.length };
};

const refreshTotals = async (conn, runId) => {
  await conn.query(
    `UPDATE payroll_runs r JOIN (
        SELECT payroll_run_id, COUNT(*) n, SUM(gross) g, SUM(total_deductions) d, SUM(net_pay) net, SUM(gross + pf_employer + esi_employer) emp
          FROM payslips WHERE payroll_run_id = ? GROUP BY payroll_run_id) t ON t.payroll_run_id = r.id
        SET r.employee_count = t.n, r.total_gross = t.g, r.total_deductions = t.d, r.total_net = t.net, r.total_employer_cost = t.emp`,
    [runId]
  );
};

// GET /api/payroll/runs
export const listRuns = async (req, res) => {
  try {
    const scope = readScope(req);
    const [rows] = await db.query(
      `SELECT r.*, b.branch_name FROM payroll_runs r JOIN branches b ON b.id = r.branch_id
        ${scope ? 'WHERE r.branch_id = ?' : ''} ORDER BY r.period DESC, b.branch_name LIMIT 120`,
      scope ? [scope] : []
    );
    res.json({ success: true, runs: rows });
  } catch (e) {
    console.error('listRuns error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/payroll/runs { period } — creates the draft, or rebuilds an existing draft.
export const createOrRebuildRun = async (req, res) => {
  const branchId = writeScope(req);
  if (!branchId) return fail(res, 400, 'Select the facility');
  const { period } = req.body;
  if (!isPeriod(period)) return fail(res, 400, 'Period must be YYYY-MM');
  if (`${period}-01` > nowIST().date) return fail(res, 400, 'That month has not started yet');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[existing]] = await conn.query('SELECT * FROM payroll_runs WHERE branch_id = ? AND period = ? FOR UPDATE', [branchId, period]);
    if (existing && existing.status !== 'Draft') { await conn.rollback(); return fail(res, 409, `Payroll for ${period} is already ${existing.status.toLowerCase()}`); }
    let run = existing;
    if (!run) {
      const [r] = await conn.query('INSERT INTO payroll_runs (branch_id, period, created_by) VALUES (?, ?, ?)', [branchId, period, req.user.id]);
      run = { id: r.insertId, branch_id: branchId, period };
    }
    const result = await buildRun(conn, run);
    await conn.commit();
    res.status(existing ? 200 : 201).json({ success: true, id: run.id, ...result });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error('createOrRebuildRun error:', e);
    fail(res, 500, 'Server error');
  } finally {
    conn.release();
  }
};

const loadRun = async (req, res) => {
  const [[run]] = await db.query('SELECT r.*, b.branch_name FROM payroll_runs r JOIN branches b ON b.id = r.branch_id WHERE r.id = ?', [req.params.id]);
  if (!run || !inScope(req, run.branch_id)) { fail(res, 404, 'Payroll run not found'); return null; }
  return run;
};

// GET /api/payroll/runs/:id
export const getRun = async (req, res) => {
  try {
    const run = await loadRun(req, res);
    if (!run) return;
    const [payslips] = await db.query(
      `SELECT p.*, e.employee_code, e.first_name, e.last_name, e.designation, d.name AS department_name,
              e.bank_account_no IS NOT NULL AND e.bank_ifsc IS NOT NULL AS has_bank
         FROM payslips p JOIN employees e ON e.id = p.employee_id LEFT JOIN departments d ON d.id = e.department_id
        WHERE p.payroll_run_id = ? ORDER BY e.first_name`,
      [run.id]
    );
    res.json({ success: true, run, payslips });
  } catch (e) {
    console.error('getRun error:', e);
    fail(res, 500, 'Server error');
  }
};

// PUT /api/payroll/payslips/:id { arrears, other_deductions, tds, ot_hours, remarks }
export const editPayslip = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query(
      `SELECT p.*, r.status, r.branch_id, r.period FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id WHERE p.id = ? FOR UPDATE`,
      [req.params.id]
    );
    if (!p || !inScope(req, p.branch_id)) { await conn.rollback(); return fail(res, 404, 'Payslip not found'); }
    if (p.status !== 'Draft') { await conn.rollback(); return fail(res, 409, 'Payroll is finalised; reopen it to edit'); }
    const b = req.body;
    const money = (k) => {
      if (b[k] === undefined) return undefined;
      const n = Number(b[k]);
      if (Number.isNaN(n) || n < 0 || n > 1e7) throw Object.assign(new Error(`Invalid ${k.replace(/_/g, ' ')}`), { status: 400 });
      return n;
    };
    const overrides = { arrears: money('arrears') ?? p.arrears, other_deductions: money('other_deductions') ?? p.other_deductions };
    const remarks = b.remarks !== undefined ? String(b.remarks || '').trim().slice(0, 255) : p.remarks;
    const tds = money('tds');
    const ot = b.ot_hours !== undefined ? Number(b.ot_hours) : undefined;
    if (ot !== undefined && (Number.isNaN(ot) || ot < 0 || ot > 400)) throw Object.assign(new Error('Invalid overtime hours'), { status: 400 });
    // Figures HR sets by hand stay put when the run is rebuilt from attendance.
    const tdsManual = tds !== undefined || !!p.tds_manual;
    const otManual = ot !== undefined || !!p.ot_manual;
    if (tdsManual) overrides.tds = tds ?? p.tds;
    if (otManual) overrides.ot_hours = ot ?? p.ot_hours;

    const [[s]] = await conn.query('SELECT * FROM salary_structures WHERE id = ?', [p.salary_structure_id]);
    const settings = await getHrSettings(p.branch_id, conn);
    const attendance = (await computeAttendance([p.employee_id], `${p.period}-01`, periodEnd(p.period), conn)).get(p.employee_id).summary;
    const calc = computePayslip({ structure: s, attendance, settings, period: p.period, overrides });
    const cols = Object.keys(calc);
    await conn.query(
      `UPDATE payslips SET ${cols.map((c) => `${c} = ?`).join(', ')}, remarks = ?, tds_manual = ?, ot_manual = ? WHERE id = ?`,
      [...cols.map((c) => calc[c]), remarks || null, tdsManual ? 1 : 0, otManual ? 1 : 0, p.id]
    );
    await refreshTotals(conn, p.payroll_run_id);
    await conn.commit();
    res.json({ success: true, payslip: calc });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e.status === 400) return fail(res, 400, e.message);
    console.error('editPayslip error:', e);
    fail(res, 500, 'Server error');
  } finally {
    conn.release();
  }
};

// POST /api/payroll/runs/:id/finalize — locks the month (attendance included).
export const finalizeRun = async (req, res) => {
  try {
    const run = await loadRun(req, res);
    if (!run) return;
    if (run.status !== 'Draft') return fail(res, 400, `Already ${run.status.toLowerCase()}`);
    if (periodEnd(run.period) >= nowIST().date) return fail(res, 400, 'A month can be finalised only after it has ended');
    if (!run.employee_count) return fail(res, 400, 'This run has no payslips');
    const [[neg]] = await db.query('SELECT COUNT(*) AS n FROM payslips WHERE payroll_run_id = ? AND net_pay < 0', [run.id]);
    if (neg.n) return fail(res, 400, `${neg.n} payslips have a negative net pay. Correct them first.`);
    await db.query(`UPDATE payroll_runs SET status = 'Finalized', finalized_by = ?, finalized_at = ? WHERE id = ?`, [req.user.id, nowIST().datetime, run.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('finalizeRun error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/payroll/runs/:id/reopen — back to draft, only before it is paid.
export const reopenRun = async (req, res) => {
  try {
    const run = await loadRun(req, res);
    if (!run) return;
    if (run.status !== 'Finalized') return fail(res, 400, run.status === 'Paid' ? 'A paid payroll cannot be reopened' : 'Already a draft');
    await db.query(`UPDATE payroll_runs SET status = 'Draft', finalized_by = NULL, finalized_at = NULL WHERE id = ?`, [run.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('reopenRun error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/payroll/runs/:id/paid { payment_reference }
export const markRunPaid = async (req, res) => {
  try {
    const run = await loadRun(req, res);
    if (!run) return;
    if (run.status !== 'Finalized') return fail(res, 400, 'Finalise the payroll before marking it paid');
    const ref = String(req.body.payment_reference || '').trim().slice(0, 100);
    if (!ref) return fail(res, 400, 'Give the bank payment reference');
    await db.query(`UPDATE payroll_runs SET status = 'Paid', paid_at = ?, payment_reference = ? WHERE id = ?`, [nowIST().datetime, ref, run.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('markRunPaid error:', e);
    fail(res, 500, 'Server error');
  }
};

// DELETE /api/payroll/runs/:id — drafts only.
export const deleteRun = async (req, res) => {
  try {
    const run = await loadRun(req, res);
    if (!run) return;
    if (run.status !== 'Draft') return fail(res, 400, 'Only a draft can be deleted');
    await db.query('DELETE FROM payroll_runs WHERE id = ?', [run.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('deleteRun error:', e);
    fail(res, 500, 'Server error');
  }
};

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas in names typed by users.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// GET /api/payroll/runs/:id/bank-file — CSV for the bank's bulk transfer upload.
export const bankFile = async (req, res) => {
  try {
    const run = await loadRun(req, res);
    if (!run) return;
    if (run.status === 'Draft') return fail(res, 400, 'Finalise the payroll first');
    const [rows] = await db.query(
      `SELECT e.employee_code, CONCAT(e.first_name, ' ', e.last_name) AS name, e.bank_name, e.bank_account_no, e.bank_ifsc, p.net_pay
         FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.payroll_run_id = ? AND p.net_pay > 0 ORDER BY e.first_name`,
      [run.id]
    );
    const lines = [['Employee Code', 'Name', 'Bank', 'Account Number', 'IFSC', 'Amount', 'Narration'].join(',')];
    rows.forEach((r) => lines.push([r.employee_code, r.name, r.bank_name, r.bank_account_no, r.bank_ifsc, Number(r.net_pay).toFixed(2), `Salary ${run.period}`].map(csvCell).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="salary-${run.period}-${run.branch_id}.csv"`);
    res.send(lines.join('\n'));
  } catch (e) {
    console.error('bankFile error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/payroll/my/payslips — the signed-in employee's finalised payslips.
export const myPayslips = async (req, res) => {
  try {
    const emp = await employeeForUser(req.user.id);
    if (!emp) return res.json({ success: true, payslips: [] });
    const [rows] = await db.query(
      `SELECT p.id, r.period, r.status, p.gross, p.total_deductions, p.net_pay, p.paid_days, p.lop_days
         FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id
        WHERE p.employee_id = ? AND r.status <> 'Draft' ORDER BY r.period DESC`,
      [emp.id]
    );
    res.json({ success: true, payslips: rows });
  } catch (e) {
    console.error('myPayslips error:', e);
    fail(res, 500, 'Server error');
  }
};

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = (period) => new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// GET /api/payroll/payslips/:id/pdf — HR, or the employee once the run is finalised.
export const payslipPdf = async (req, res) => {
  try {
    const [[p]] = await db.query(
      `SELECT p.*, r.period, r.status, r.branch_id, b.branch_name, b.address AS branch_address,
              e.employee_code, e.first_name, e.last_name, e.designation, e.user_id, e.pan, e.uan, e.esi_number,
              e.bank_name, e.bank_account_no, DATE_FORMAT(e.date_of_joining, '%d-%m-%Y') AS doj, d.name AS department_name
         FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id JOIN employees e ON e.id = p.employee_id
         JOIN branches b ON b.id = r.branch_id LEFT JOIN departments d ON d.id = e.department_id
        WHERE p.id = ?`,
      [req.params.id]
    );
    const own = p && p.user_id === req.user.id;
    if (!p || (!own && !(isHrAdmin(req) && inScope(req, p.branch_id)))) return fail(res, 404, 'Payslip not found');
    if (own && !isHrAdmin(req) && p.status === 'Draft') return fail(res, 404, 'Payslip not found');

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="payslip-${p.employee_code}-${p.period}.pdf"`);
    doc.pipe(res);

    const blue = '#1a6fd4';
    const gray = '#475569';
    const line = '#dce8f5';
    const W = doc.page.width - 80;

    doc.font('Helvetica-Bold').fontSize(16).fillColor(blue).text(p.branch_name, 40, 40, { width: W });
    if (p.branch_address) doc.font('Helvetica').fontSize(9).fillColor(gray).text(p.branch_address, { width: W });
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f1f33').text(`Payslip for ${monthName(p.period)}`, { width: W });
    if (p.status === 'Draft') doc.font('Helvetica-Bold').fontSize(9).fillColor('#dc2626').text('DRAFT - not final', { width: W });
    doc.moveDown(0.6);

    const info = [
      ['Employee', `${p.first_name} ${p.last_name}`], ['Employee Code', p.employee_code],
      ['Designation', p.designation || '-'], ['Department', p.department_name || '-'],
      ['Date of Joining', p.doj || '-'], ['PAN', p.pan || '-'],
      ['UAN', p.uan || '-'], ['ESI No.', p.esi_number || '-'],
      ['Bank', p.bank_name || '-'], ['Account No.', p.bank_account_no ? `XXXX${String(p.bank_account_no).slice(-4)}` : '-'],
      ['Days in Month', p.days_in_month], ['Paid Days', p.paid_days],
      ['LOP Days', p.lop_days], ['Overtime Hours', p.ot_hours],
    ];
    let y = doc.y;
    const colW = W / 2;
    info.forEach(([k, v], i) => {
      const x = 40 + (i % 2) * colW;
      if (i % 2 === 0 && i) y += 16;
      doc.font('Helvetica').fontSize(9).fillColor(gray).text(k, x, y, { width: 95 });
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f1f33').text(String(v), x + 95, y, { width: colW - 100 });
    });
    y += 26;

    const earnings = [['Basic', p.basic], ['House Rent Allowance', p.hra], ['Conveyance', p.conveyance], ['Medical Allowance', p.medical],
      ['Special Allowance', p.special_allowance], ['Other Allowance', p.other_allowance], ['Overtime', p.ot_amount], ['Arrears', p.arrears]]
      .filter(([, v]) => Number(v) > 0);
    const deductions = [['Provident Fund', p.pf_employee], ['ESI', p.esi_employee], ['Professional Tax', p.professional_tax],
      ['Income Tax (TDS)', p.tds], ['Other Deductions', p.other_deductions]].filter(([, v]) => Number(v) > 0);

    doc.rect(40, y, W, 20).fill(blue);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
      .text('Earnings', 48, y + 6).text('Amount', 40 + colW - 110, y + 6, { width: 100, align: 'right' })
      .text('Deductions', 40 + colW + 8, y + 6).text('Amount', 40 + W - 110, y + 6, { width: 100, align: 'right' });
    y += 24;
    const rows = Math.max(earnings.length, deductions.length);
    for (let i = 0; i < rows; i++) {
      doc.font('Helvetica').fontSize(9.5).fillColor('#0f1f33');
      if (earnings[i]) doc.text(earnings[i][0], 48, y).text(fmt(earnings[i][1]), 40 + colW - 110, y, { width: 100, align: 'right' });
      if (deductions[i]) doc.text(deductions[i][0], 40 + colW + 8, y).text(fmt(deductions[i][1]), 40 + W - 110, y, { width: 100, align: 'right' });
      y += 17;
    }
    doc.moveTo(40, y).lineTo(40 + W, y).strokeColor(line).stroke();
    y += 6;
    doc.font('Helvetica-Bold').fontSize(10)
      .text('Gross Earnings', 48, y).text(fmt(p.gross), 40 + colW - 110, y, { width: 100, align: 'right' })
      .text('Total Deductions', 40 + colW + 8, y).text(fmt(p.total_deductions), 40 + W - 110, y, { width: 100, align: 'right' });
    y += 28;
    doc.roundedRect(40, y, W, 44, 6).fill('#f0f6ff');
    doc.font('Helvetica-Bold').fontSize(12).fillColor(blue).text(`Net Pay: ${fmt(p.net_pay)}`, 52, y + 8);
    doc.font('Helvetica').fontSize(9).fillColor(gray).text(rupeesInWords(p.net_pay), 52, y + 26, { width: W - 24 });
    y += 60;
    doc.font('Helvetica').fontSize(8.5).fillColor(gray)
      .text(`Employer contributions (not deducted from pay): PF ${fmt(p.pf_employer)}, ESI ${fmt(p.esi_employer)}.`, 40, y, { width: W });
    doc.text('This is a system-generated payslip and does not require a signature.', 40, doc.y + 4, { width: W });
    doc.end();
  } catch (e) {
    console.error('payslipPdf error:', e);
    if (!res.headersSent) fail(res, 500, 'Server error');
  }
};
