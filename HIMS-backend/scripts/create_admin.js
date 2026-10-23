// Creates the hospital's first administrator (login + employee record).
//
//   node scripts/create_admin.js --email admin@hospital.in --name "Hospital Admin" [--password 'Temp@1234']
//
// Without --password a random temporary password is generated and printed.
// The administrator must change it at first sign-in. Refuses to run when an
// active Admin already exists — further logins are created from Employee
// Management.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import db from '../config/db.js';
import { passwordProblem } from '../utils/passwordPolicy.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const tempPassword = () => {
  const pick = (set, n) => Array.from({ length: n }, () => set[crypto.randomInt(set.length)]).join('');
  return `${pick('ABCDEFGHJKLMNPQRSTUVWXYZ', 3)}${pick('abcdefghijkmnpqrstuvwxyz', 4)}${pick('23456789', 3)}${pick('@#$%&*', 1)}`;
};

async function main() {
  const email = arg('email');
  const [firstName, ...rest] = String(arg('name') || 'Hospital Administrator').trim().split(/\s+/);
  const password = arg('password') || tempPassword();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Give --email for the administrator');
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);

  const [[hospital]] = await db.query("SELECT id, hospital_code FROM branches WHERE status = 'Active' ORDER BY id LIMIT 1");
  if (!hospital) throw new Error('No hospital record found in branches');
  const [[existing]] = await db.query("SELECT id, email FROM users WHERE role IN ('Admin','Super Admin') AND is_active = 1 LIMIT 1");
  if (existing) throw new Error(`An administrator already exists (${existing.email}). Create other logins from Employee Management.`);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const hash = await bcrypt.hash(password, 10);
    const [u] = await conn.query(
      `INSERT INTO users (first_name, last_name, email, role, department, password, branch_id, role_level, password_change_required, is_active, designation)
       VALUES (?, ?, ?, 'Admin', 'Administration', ?, ?, 'Branch', 1, 1, 'Administrator')`,
      [firstName, rest.join(' '), email, hash, hospital.id]
    );
    const [[dept]] = await conn.query("SELECT id FROM departments WHERE name = 'Administration' LIMIT 1");
    const code = `${(hospital.hospital_code || 'H').toUpperCase()}-0001`;
    const [[taken]] = await conn.query('SELECT id FROM employees WHERE employee_code = ?', [code]);
    await conn.query(
      `INSERT INTO employees (branch_id, employee_code, user_id, first_name, last_name, email, designation, department_id,
                              staff_category, employment_type, date_of_joining)
       VALUES (?, ?, ?, ?, ?, ?, 'Administrator', ?, 'Administrative', 'Permanent', CURDATE())`,
      [hospital.id, taken ? `ADMIN-${u.insertId}` : code, u.insertId, firstName, rest.join(' '), email, dept?.id || null]
    );
    await conn.commit();
    console.log(`Administrator created: ${email}`);
    console.log(`Temporary password:    ${password}`);
    console.log('Sign in from the start page with the Administration role; you will be asked to set a new password.');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
