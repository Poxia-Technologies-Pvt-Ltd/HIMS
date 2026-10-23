import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import db from '../config/db.js';
import { passwordProblem } from '../utils/passwordPolicy.js';
import { normalizeRole } from '../middleware/auth.js';
import { HR_ADMIN_ROLES, readScope, writeScope, inScope, isISODate, nowIST, addDays, fail } from '../utils/hr.js';

export const EMPLOYEE_DOC_DIR = path.resolve('uploads/employee-docs');

const CATEGORIES = ['Doctor', 'Nurse', 'Paramedical', 'Technician', 'Pharmacist', 'Administrative', 'Support', 'Other'];
const EMPLOYMENT_TYPES = ['Permanent', 'Contract', 'Probation', 'Consultant', 'Intern', 'Trainee'];
const STATUSES = ['Active', 'Suspended', 'Resigned', 'Terminated', 'Retired'];
const GENDERS = ['Male', 'Female', 'Other'];
// Logins an HR Manager may hand out. Admin-tier roles stay with Admin/Super Admin.
const HR_ASSIGNABLE_ROLES = ['Doctor', 'Nurse', 'Receptionist', 'Pharmacist', 'Lab Technician', 'Radiographer', 'Sample Collector', 'Staff'];

// Statutory and bank details are visible to HR and to the employee themself only.
const SENSITIVE = ['pan', 'aadhaar_last4', 'uan', 'esi_number', 'bank_name', 'bank_account_no', 'bank_ifsc'];

const isHrAdmin = (req) => HR_ADMIN_ROLES.includes(normalizeRole(req.user?.role));

const EMPLOYEE_SELECT = `
  SELECT e.*,
         DATE_FORMAT(e.dob, '%Y-%m-%d')                     AS dob,
         DATE_FORMAT(e.date_of_joining, '%Y-%m-%d')         AS date_of_joining,
         DATE_FORMAT(e.date_of_leaving, '%Y-%m-%d')         AS date_of_leaving,
         DATE_FORMAT(e.registration_valid_till, '%Y-%m-%d') AS registration_valid_till,
         d.name  AS department_name,
         b.branch_name,
         s.name  AS default_shift_name,
         u.role  AS login_role, u.email AS login_email, u.is_active AS login_active, u.role_level AS login_role_level,
         CONCAT(r.first_name, ' ', r.last_name) AS reporting_to_name
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN branches b    ON b.id = e.branch_id
    LEFT JOIN shifts s      ON s.id = e.default_shift_id
    LEFT JOIN users u       ON u.id = e.user_id
    LEFT JOIN employees r   ON r.id = e.reporting_to`;

const redact = (row, req) => {
  if (isHrAdmin(req) || (row.user_id && row.user_id === req.user?.id)) return row;
  const out = { ...row };
  SENSITIVE.forEach((k) => delete out[k]);
  return out;
};

// Validates and normalises the editable fields. Returns [fields, error].
const readEmployeeBody = (body) => {
  const f = {};
  const str = (k, max) => {
    if (body[k] === undefined) return;
    const v = body[k] === null ? null : String(body[k]).trim();
    f[k] = v === '' ? null : v && max ? v.slice(0, max) : v;
  };
  ['first_name', 'last_name'].forEach((k) => str(k, 50));
  ['phone', 'emergency_contact_phone'].forEach((k) => str(k, 20));
  str('email', 100); str('address'); str('designation', 100); str('qualification', 255);
  str('registration_council', 100); str('registration_no', 50); str('emergency_contact_name', 100);
  str('blood_group', 5); str('bank_name', 100); str('bank_account_no', 30); str('uan', 12); str('esi_number', 17);
  str('weekly_off', 20);

  if (body.pan !== undefined) {
    const pan = body.pan ? String(body.pan).trim().toUpperCase() : null;
    if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return [null, 'PAN must look like ABCDE1234F'];
    f.pan = pan;
  }
  if (body.bank_ifsc !== undefined) {
    const ifsc = body.bank_ifsc ? String(body.bank_ifsc).trim().toUpperCase() : null;
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return [null, 'IFSC must look like SBIN0001234'];
    f.bank_ifsc = ifsc;
  }
  // Only the last four digits of Aadhaar are ever accepted or stored.
  if (body.aadhaar_last4 !== undefined) {
    const a = body.aadhaar_last4 ? String(body.aadhaar_last4).replace(/\D/g, '').slice(-4) : null;
    if (a && a.length !== 4) return [null, 'Aadhaar: enter the last 4 digits'];
    f.aadhaar_last4 = a;
  }
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return [null, 'Invalid email address'];
  if (f.phone && !/^\+?[\d\s-]{10,15}$/.test(f.phone)) return [null, 'Invalid phone number'];

  const oneOf = (k, list) => {
    if (body[k] === undefined) return null;
    if (body[k] === null || body[k] === '') { f[k] = null; return null; }
    if (!list.includes(body[k])) return `Invalid ${k.replace(/_/g, ' ')}`;
    f[k] = body[k];
    return null;
  };
  const enumErr = oneOf('gender', GENDERS) || oneOf('staff_category', CATEGORIES) || oneOf('employment_type', EMPLOYMENT_TYPES);
  if (enumErr) return [null, enumErr];

  for (const k of ['dob', 'date_of_joining', 'registration_valid_till']) {
    if (body[k] === undefined) continue;
    if (body[k] && !isISODate(body[k])) return [null, `Invalid ${k.replace(/_/g, ' ')}`];
    f[k] = body[k] || null;
  }
  for (const k of ['department_id', 'reporting_to', 'default_shift_id', 'experience_years']) {
    if (body[k] === undefined) continue;
    f[k] = body[k] === '' || body[k] === null ? null : Number(body[k]);
    if (f[k] !== null && !Number.isInteger(f[k])) return [null, `Invalid ${k.replace(/_/g, ' ')}`];
  }
  if (f.weekly_off) {
    const days = f.weekly_off.split(',').map((d) => d.trim());
    if (!days.every((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].includes(d))) return [null, 'Weekly off must be days like Sun or Sat,Sun'];
    f.weekly_off = days.join(',');
  }
  return [f, null];
};

// <hospital_code>-0001, numbered per facility. Runs inside the caller's
// transaction with the facility row locked so two inserts can't take the same number.
const nextEmployeeCode = async (conn, branchId) => {
  const [[branch]] = await conn.query('SELECT hospital_code FROM branches WHERE id = ? FOR UPDATE', [branchId]);
  const prefix = (branch?.hospital_code || `B${branchId}`).toUpperCase();
  const [[{ n }]] = await conn.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(employee_code, '-', -1) AS UNSIGNED)), 0) AS n
       FROM employees WHERE employee_code LIKE ?`,
    [`${prefix}-%`]
  );
  return `${prefix}-${String(Number(n) + 1).padStart(4, '0')}`;
};

// Creates the login for an employee inside the caller's transaction. Returns [userId, error].
const createLogin = async (conn, req, employee, login) => {
  const role = String(login.role || '').trim();
  const email = String(login.email || employee.email || '').trim();
  if (!role || !email || !login.password) return [null, 'Login needs a role, email and initial password'];
  if (!isHrAdmin(req)) return [null, 'Not permitted to create logins'];
  if (normalizeRole(req.user.role) === 'HR Manager' && !HR_ASSIGNABLE_ROLES.includes(role)) {
    return [null, `HR Manager can create these logins only: ${HR_ASSIGNABLE_ROLES.join(', ')}`];
  }
  const problem = passwordProblem(login.password);
  if (problem) return [null, problem];
  const [dup] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
  if (dup.length) return [null, 'That email already has a login'];

  const roleLevel = req.user.role_level === 'Central' && role === 'Admin' ? (login.role_level || 'Branch') : 'Branch';
  const hashed = await bcrypt.hash(login.password, 10);
  const [r] = await conn.query(
    `INSERT INTO users (first_name, last_name, email, phone, role, department, staff_id, password, branch_id,
                        role_level, qualification, experience_years, registration_no, designation, password_change_required)
     SELECT ?, ?, ?, ?, ?, (SELECT name FROM departments WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, 1`,
    [employee.first_name, employee.last_name || '', email, employee.phone || null, role, employee.department_id || null,
      employee.employee_code, hashed, employee.branch_id, roleLevel, employee.qualification || null,
      employee.experience_years ?? null, employee.registration_no || null, employee.designation || null]
  );
  return [r.insertId, null];
};

// GET /api/employees
export const listEmployees = async (req, res) => {
  try {
    const scope = readScope(req);
    const { status, department_id, category, q } = req.query;
    const where = [];
    const params = [];
    if (scope) { where.push('e.branch_id = ?'); params.push(scope); }
    if (status && status !== 'all') { where.push('e.status = ?'); params.push(status); }
    if (department_id) { where.push('e.department_id = ?'); params.push(department_id); }
    if (category) { where.push('e.staff_category = ?'); params.push(category); }
    if (q) {
      where.push(`(CONCAT(e.first_name, ' ', e.last_name) LIKE ? OR e.employee_code LIKE ? OR e.phone LIKE ? OR e.email LIKE ? OR e.designation LIKE ?)`);
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    const [rows] = await db.query(
      `${EMPLOYEE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.status = 'Active' DESC, e.first_name, e.last_name`,
      params
    );
    res.json({ success: true, employees: rows.map((r) => redact(r, req)) });
  } catch (e) {
    console.error('listEmployees error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/employees/lookup?category=Doctor — light list for pickers (any signed-in staff).
export const lookupEmployees = async (req, res) => {
  try {
    const scope = readScope(req);
    const params = [];
    let where = `WHERE e.status = 'Active'`;
    if (scope) { where += ' AND e.branch_id = ?'; params.push(scope); }
    if (req.query.category) { where += ' AND e.staff_category = ?'; params.push(req.query.category); }
    if (req.query.department_id) { where += ' AND e.department_id = ?'; params.push(req.query.department_id); }
    if (req.query.with_login === '1') where += ' AND e.user_id IS NOT NULL';
    const [rows] = await db.query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.designation, e.staff_category,
              e.department_id, d.name AS department_name, e.user_id, e.branch_id, e.default_shift_id, e.gender
         FROM employees e LEFT JOIN departments d ON d.id = e.department_id
         ${where} ORDER BY e.first_name, e.last_name`,
      params
    );
    res.json({ success: true, employees: rows });
  } catch (e) {
    console.error('lookupEmployees error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/employees/stats
export const employeeStats = async (req, res) => {
  try {
    const scope = readScope(req);
    const w = scope ? 'AND e.branch_id = ?' : '';
    const p = scope ? [scope] : [];
    const today = nowIST().date;
    const soon = addDays(today, 60);
    const [byCategory] = await db.query(
      `SELECT staff_category, COUNT(*) AS n FROM employees e WHERE status = 'Active' ${w} GROUP BY staff_category`, p);
    const [byStatus] = await db.query(`SELECT status, COUNT(*) AS n FROM employees e WHERE 1=1 ${w} GROUP BY status`, p);
    const [expiring] = await db.query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.registration_council, e.registration_no,
              DATE_FORMAT(e.registration_valid_till, '%Y-%m-%d') AS registration_valid_till
         FROM employees e
        WHERE e.status = 'Active' AND e.registration_valid_till IS NOT NULL AND e.registration_valid_till <= ? ${w}
        ORDER BY e.registration_valid_till`,
      [soon, ...p]
    );
    const [docs] = await db.query(
      `SELECT ed.id, ed.doc_type, DATE_FORMAT(ed.expires_on, '%Y-%m-%d') AS expires_on, e.id AS employee_id, e.first_name, e.last_name
         FROM employee_documents ed JOIN employees e ON e.id = ed.employee_id
        WHERE e.status = 'Active' AND ed.expires_on IS NOT NULL AND ed.expires_on <= ? ${w}
        ORDER BY ed.expires_on`,
      [soon, ...p]
    );
    const [[{ joined }]] = await db.query(
      `SELECT COUNT(*) AS joined FROM employees e WHERE date_of_joining >= ? ${w}`, [`${today.slice(0, 7)}-01`, ...p]);
    res.json({
      success: true,
      stats: {
        active: byStatus.find((r) => r.status === 'Active')?.n || 0,
        by_category: Object.fromEntries(byCategory.map((r) => [r.staff_category, r.n])),
        by_status: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
        joined_this_month: joined,
        expiring_registrations: expiring,
        expiring_documents: docs,
      },
    });
  } catch (e) {
    console.error('employeeStats error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/employees/me
export const myEmployeeProfile = async (req, res) => {
  try {
    const [[row]] = await db.query(`${EMPLOYEE_SELECT} WHERE e.user_id = ?`, [req.user.id]);
    if (!row) return fail(res, 404, 'No employee record is linked to your login');
    res.json({ success: true, employee: row });
  } catch (e) {
    console.error('myEmployeeProfile error:', e);
    fail(res, 500, 'Server error');
  }
};

// GET /api/employees/:id
export const getEmployee = async (req, res) => {
  try {
    const [[row]] = await db.query(`${EMPLOYEE_SELECT} WHERE e.id = ?`, [req.params.id]);
    if (!row || !inScope(req, row.branch_id)) return fail(res, 404, 'Employee not found');
    if (!isHrAdmin(req) && row.user_id !== req.user.id) return fail(res, 403, 'Access denied');
    const [documents] = await db.query(
      `SELECT id, doc_type, original_name, mime_type, size_bytes, DATE_FORMAT(expires_on, '%Y-%m-%d') AS expires_on, uploaded_at
         FROM employee_documents WHERE employee_id = ? ORDER BY uploaded_at DESC`,
      [row.id]
    );
    res.json({ success: true, employee: redact(row, req), documents });
  } catch (e) {
    console.error('getEmployee error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/employees  { ...fields, employee_code?, login?: { role, email, password, role_level } }
export const createEmployee = async (req, res) => {
  const branchId = writeScope(req);
  if (!branchId) return fail(res, 400, 'Select the facility for this employee');
  const [fields, err] = readEmployeeBody(req.body);
  if (err) return fail(res, 400, err);
  if (!fields.first_name) return fail(res, 400, 'First name is required');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let code = req.body.employee_code ? String(req.body.employee_code).trim().toUpperCase().slice(0, 30) : null;
    if (code) {
      const [dup] = await conn.query('SELECT id FROM employees WHERE employee_code = ?', [code]);
      if (dup.length) { await conn.rollback(); return fail(res, 409, 'Employee code already in use'); }
    } else {
      code = await nextEmployeeCode(conn, branchId);
    }
    const record = { last_name: '', staff_category: 'Other', employment_type: 'Contract', ...fields, branch_id: branchId, employee_code: code, created_by: req.user.id };
    const cols = Object.keys(record);
    const [r] = await conn.query(
      `INSERT INTO employees (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => record[c])
    );
    let userId = null;
    if (req.body.login?.enabled) {
      const [uid, loginErr] = await createLogin(conn, req, record, req.body.login);
      if (loginErr) { await conn.rollback(); return fail(res, 400, loginErr); }
      userId = uid;
      await conn.query('UPDATE employees SET user_id = ? WHERE id = ?', [userId, r.insertId]);
    }
    await conn.commit();
    res.status(201).json({ success: true, id: r.insertId, employee_code: code, user_id: userId });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error('createEmployee error:', e);
    fail(res, 500, 'Server error');
  } finally {
    conn.release();
  }
};

// PUT /api/employees/:id
export const updateEmployee = async (req, res) => {
  try {
    const [[emp]] = await db.query('SELECT id, branch_id, user_id FROM employees WHERE id = ?', [req.params.id]);
    if (!emp || !inScope(req, emp.branch_id)) return fail(res, 404, 'Employee not found');
    const [fields, err] = readEmployeeBody(req.body);
    if (err) return fail(res, 400, err);
    if (fields.first_name === null) return fail(res, 400, 'First name is required');
    if (fields.reporting_to && Number(fields.reporting_to) === emp.id) return fail(res, 400, 'An employee cannot report to themself');
    // Moving between facilities is a Central decision.
    if (req.body.branch_id && req.user.role_level === 'Central') fields.branch_id = Number(req.body.branch_id);
    const cols = Object.keys(fields);
    if (!cols.length) return fail(res, 400, 'Nothing to update');
    await db.query(`UPDATE employees SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => fields[c]), emp.id]);

    // Keep the login's display details in step with the HR record.
    if (emp.user_id) {
      const sync = {};
      if (fields.first_name !== undefined) sync.first_name = fields.first_name;
      if (fields.last_name !== undefined) sync.last_name = fields.last_name || '';
      if (fields.phone !== undefined) sync.phone = fields.phone;
      if (fields.designation !== undefined) sync.designation = fields.designation;
      if (fields.qualification !== undefined) sync.qualification = fields.qualification;
      if (fields.registration_no !== undefined) sync.registration_no = fields.registration_no;
      if (fields.branch_id !== undefined) sync.branch_id = fields.branch_id;
      if (fields.department_id !== undefined) {
        const [[d]] = await db.query('SELECT name FROM departments WHERE id = ?', [fields.department_id]);
        sync.department = d?.name || null;
      }
      const sc = Object.keys(sync);
      if (sc.length) await db.query(`UPDATE users SET ${sc.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...sc.map((c) => sync[c]), emp.user_id]);
    }
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, 'That phone number already belongs to another login');
    console.error('updateEmployee error:', e);
    fail(res, 500, 'Server error');
  }
};

// PATCH /api/employees/:id/status  { status, date_of_leaving?, reason? }
// Anyone not Active also loses their login (and any open session — see authenticateToken).
export const setEmployeeStatus = async (req, res) => {
  try {
    const { status, date_of_leaving } = req.body;
    if (!STATUSES.includes(status)) return fail(res, 400, 'Invalid status');
    if (date_of_leaving && !isISODate(date_of_leaving)) return fail(res, 400, 'Invalid date of leaving');
    const [[emp]] = await db.query('SELECT id, branch_id, user_id FROM employees WHERE id = ?', [req.params.id]);
    if (!emp || !inScope(req, emp.branch_id)) return fail(res, 404, 'Employee not found');
    if (emp.user_id && emp.user_id === req.user.id && status !== 'Active') return fail(res, 400, 'You cannot deactivate your own account');

    const leaving = ['Resigned', 'Terminated', 'Retired'].includes(status) ? (date_of_leaving || nowIST().date) : null;
    await db.query('UPDATE employees SET status = ?, date_of_leaving = ? WHERE id = ?', [status, leaving, emp.id]);
    if (emp.user_id) await db.query('UPDATE users SET is_active = ? WHERE id = ?', [status === 'Active' ? 1 : 0, emp.user_id]);
    // Future duties of someone who has left are released so they don't block rooms or slots.
    if (status !== 'Active') {
      await db.query(
        `UPDATE roster_entries SET status = 'Cancelled', notes = CONCAT_WS(' · ', notes, ?)
          WHERE employee_id = ? AND duty_date > ? AND status = 'Scheduled'`,
        [`Released: employee ${status.toLowerCase()}`, emp.id, nowIST().date]
      );
    }
    res.json({ success: true });
  } catch (e) {
    console.error('setEmployeeStatus error:', e);
    fail(res, 500, 'Server error');
  }
};

// POST /api/employees/:id/login  { role, email, password, role_level }
export const createEmployeeLogin = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[emp]] = await conn.query('SELECT * FROM employees WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!emp || !inScope(req, emp.branch_id)) { await conn.rollback(); return fail(res, 404, 'Employee not found'); }
    if (emp.user_id) { await conn.rollback(); return fail(res, 409, 'This employee already has a login'); }
    if (emp.status !== 'Active') { await conn.rollback(); return fail(res, 400, 'Only active employees can be given a login'); }
    const [uid, err] = await createLogin(conn, req, emp, req.body);
    if (err) { await conn.rollback(); return fail(res, 400, err); }
    await conn.query('UPDATE employees SET user_id = ? WHERE id = ?', [uid, emp.id]);
    await conn.commit();
    res.status(201).json({ success: true, user_id: uid });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, 'That phone number already belongs to another login');
    console.error('createEmployeeLogin error:', e);
    fail(res, 500, 'Server error');
  } finally {
    conn.release();
  }
};

// DELETE /api/employees/:id — only for a record created by mistake, before
// anything (roster, attendance, leave, payroll) refers to it. Otherwise use status.
export const deleteEmployee = async (req, res) => {
  try {
    const [[emp]] = await db.query('SELECT id, branch_id, user_id FROM employees WHERE id = ?', [req.params.id]);
    if (!emp || !inScope(req, emp.branch_id)) return fail(res, 404, 'Employee not found');
    if (emp.user_id) return fail(res, 409, 'This employee has a login. Mark them Resigned/Terminated instead of deleting.');
    const [[used]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM roster_entries WHERE employee_id = ?) +
              (SELECT COUNT(*) FROM attendance_punches WHERE employee_id = ?) +
              (SELECT COUNT(*) FROM leave_requests WHERE employee_id = ?) +
              (SELECT COUNT(*) FROM payslips WHERE employee_id = ?) AS n`,
      [emp.id, emp.id, emp.id, emp.id]
    );
    if (used.n > 0) return fail(res, 409, 'This employee already has roster, attendance, leave or payroll history. Change their status instead.');
    const [docs] = await db.query('SELECT file_name FROM employee_documents WHERE employee_id = ?', [emp.id]);
    await db.query('DELETE FROM employees WHERE id = ?', [emp.id]);
    docs.forEach((d) => fs.unlink(path.join(EMPLOYEE_DOC_DIR, d.file_name), () => {}));
    res.json({ success: true });
  } catch (e) {
    console.error('deleteEmployee error:', e);
    fail(res, 500, 'Server error');
  }
};

// ── Documents ─────────────────────────────────────────────────────────────────

const loadDocEmployee = async (req, res, employeeId) => {
  const [[emp]] = await db.query('SELECT id, branch_id, user_id FROM employees WHERE id = ?', [employeeId]);
  if (!emp || !inScope(req, emp.branch_id)) { fail(res, 404, 'Employee not found'); return null; }
  if (!isHrAdmin(req) && emp.user_id !== req.user.id) { fail(res, 403, 'Access denied'); return null; }
  return emp;
};

// POST /api/employees/:id/documents  (multipart: file, doc_type, expires_on)
export const uploadEmployeeDocument = async (req, res) => {
  const cleanup = () => req.file && fs.unlink(req.file.path, () => {});
  try {
    if (!req.file) return fail(res, 400, 'Choose a file to upload');
    const emp = await loadDocEmployee(req, res, req.params.id);
    if (!emp) return cleanup();
    const docType = String(req.body.doc_type || '').trim().slice(0, 50);
    if (!docType) { cleanup(); return fail(res, 400, 'Document type is required'); }
    const expires = req.body.expires_on || null;
    if (expires && !isISODate(expires)) { cleanup(); return fail(res, 400, 'Invalid expiry date'); }
    const [r] = await db.query(
      `INSERT INTO employee_documents (employee_id, doc_type, file_name, original_name, mime_type, size_bytes, expires_on, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp.id, docType, req.file.filename, req.file.originalname.slice(0, 255), req.file.mimetype, req.file.size, expires, req.user.id]
    );
    res.status(201).json({ success: true, id: r.insertId });
  } catch (e) {
    cleanup();
    console.error('uploadEmployeeDocument error:', e);
    fail(res, 500, 'Server error');
  }
};

const loadDocument = async (req, res) => {
  const [[doc]] = await db.query('SELECT * FROM employee_documents WHERE id = ?', [req.params.docId]);
  if (!doc) { fail(res, 404, 'Document not found'); return null; }
  const emp = await loadDocEmployee(req, res, doc.employee_id);
  return emp ? doc : null;
};

// GET /api/employees/documents/:docId/download
export const downloadEmployeeDocument = async (req, res) => {
  try {
    const doc = await loadDocument(req, res);
    if (!doc) return;
    const file = path.join(EMPLOYEE_DOC_DIR, path.basename(doc.file_name));
    if (!fs.existsSync(file)) return fail(res, 404, 'File is missing on the server');
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.original_name)}"`);
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error('downloadEmployeeDocument error:', e);
    fail(res, 500, 'Server error');
  }
};

// DELETE /api/employees/documents/:docId
export const deleteEmployeeDocument = async (req, res) => {
  try {
    const doc = await loadDocument(req, res);
    if (!doc) return;
    await db.query('DELETE FROM employee_documents WHERE id = ?', [doc.id]);
    fs.unlink(path.join(EMPLOYEE_DOC_DIR, path.basename(doc.file_name)), () => {});
    res.json({ success: true });
  } catch (e) {
    console.error('deleteEmployeeDocument error:', e);
    fail(res, 500, 'Server error');
  }
};
