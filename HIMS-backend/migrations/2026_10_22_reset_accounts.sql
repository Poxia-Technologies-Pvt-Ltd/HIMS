-- Removes every login and the employee records created from them, so the
-- hospital starts with a clean set of accounts. Destructive: run only on a
-- fresh install, before scripts/seed_hospital.js or scripts/create_admin.js.

-- Fresh start for accounts: remove every login and the HR records made from them.
DELETE FROM payslips;
DELETE FROM payroll_runs;
DELETE FROM salary_structures;
DELETE FROM attendance_punches;
DELETE FROM leave_requests;
DELETE FROM leave_balances;
DELETE FROM roster_entries;
DELETE FROM employee_documents;
DELETE FROM employees;
DELETE FROM users;

