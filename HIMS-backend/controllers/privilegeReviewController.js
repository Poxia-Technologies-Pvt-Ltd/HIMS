import db from '../config/db.js';
import { PASSWORD_MAX_AGE_DAYS } from '../utils/passwordPolicy.js';

// Periodic privilege review (tender #107). Lists every user with the access they
// hold and the things a reviewer should question — dormant accounts, old
// passwords, people who have left but still hold signing certificates, locked
// accounts and all-powerful roles — and records who reviewed it, when and why.
// A hospital admin reviews their own hospital; Central admins and auditors can
// review the whole system.

const DORMANT_DAYS = Number(process.env.PRIVILEGE_DORMANT_DAYS) || 90;
const REVIEW_EVERY_DAYS = Number(process.env.PRIVILEGE_REVIEW_DAYS) || 90;
const isPowerful = (role) => ['admin', 'super admin'].includes(String(role || '').toLowerCase());

const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null);
const scopeBranch = (req) => pinned(req) || req.query?.branch_id || req.body?.branch_id || null;
const days = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);

async function buildReport(branchId) {
  const [users] = await db.query(
    `SELECT u.id, CONCAT_WS(' ', u.first_name, u.last_name) AS name, u.email, u.role, u.role_level, u.branch_id, br.branch_name,
            u.is_active, u.created_at, u.last_login_at, u.password_changed_at, u.failed_login_attempts, u.locked_until,
            (SELECT COUNT(*) FROM user_dsc_certificates c WHERE c.user_id = u.id AND c.status = 'Active') AS active_dsc
       FROM users u LEFT JOIN branches br ON br.id = u.branch_id
      WHERE ${branchId ? 'u.branch_id = ?' : '1 = 1'} ORDER BY br.branch_name, u.role, name`, branchId ? [branchId] : []);

  const rows = users.map((u) => {
    const active = !!u.is_active;
    const flags = [];
    const sinceLogin = days(u.last_login_at);
    const pwdAge = days(u.password_changed_at || u.created_at);
    if (active && isPowerful(u.role)) flags.push({ code: 'POWERFUL', level: 'info', text: `${u.role}: full control of the system` });
    if (active && sinceLogin !== null && sinceLogin > DORMANT_DAYS) flags.push({ code: 'DORMANT', level: 'warn', text: `No sign-in for ${sinceLogin} days (limit ${DORMANT_DAYS})` });
    if (active && u.last_login_at === null) flags.push({ code: 'NO_LOGIN', level: 'info', text: 'No sign-in recorded since tracking began' });
    if (active && pwdAge !== null && pwdAge > PASSWORD_MAX_AGE_DAYS) flags.push({ code: 'OLD_PASSWORD', level: 'warn', text: `Password unchanged for ${pwdAge} days (limit ${PASSWORD_MAX_AGE_DAYS})` });
    if (active && u.locked_until && new Date(u.locked_until) > new Date()) flags.push({ code: 'LOCKED', level: 'info', text: 'Account is locked after failed sign-ins' });
    if (!active && Number(u.active_dsc) > 0) flags.push({ code: 'LEFT_WITH_DSC', level: 'bad', text: 'Deactivated, but still holds an active Digital Signature Certificate' });
    if (active && u.role_level === 'Central' && u.branch_id) flags.push({ code: 'LEVEL_MISMATCH', level: 'warn', text: 'Central-level access but tied to a single hospital' });
    return {
      id: u.id, name: u.name, email: u.email, role: u.role, role_level: u.role_level, branch_id: u.branch_id, hospital: u.branch_name || '—',
      active, created_at: u.created_at, last_login_at: u.last_login_at, days_since_login: sinceLogin,
      password_changed_at: u.password_changed_at, password_age_days: pwdAge, active_dsc: Number(u.active_dsc), flags,
    };
  });

  const byRole = {};
  rows.filter((r) => r.active).forEach((r) => { byRole[r.role] = (byRole[r.role] || 0) + 1; });
  const actionable = (r) => r.flags.some((f) => f.level === 'warn' || f.level === 'bad');
  const [[last]] = await db.query(
    `SELECT id, reviewed_at, reviewer_name, note FROM privilege_reviews WHERE ${branchId ? 'branch_id = ?' : 'branch_id IS NULL'} ORDER BY id DESC LIMIT 1`, branchId ? [branchId] : []);
  const nextDue = last ? new Date(new Date(last.reviewed_at).getTime() + REVIEW_EVERY_DAYS * 86400000) : null;
  return {
    rows,
    summary: {
      total: rows.length, active: rows.filter((r) => r.active).length, inactive: rows.filter((r) => !r.active).length,
      flagged: rows.filter(actionable).length, powerful: rows.filter((r) => r.active && isPowerful(r.role)).length, by_role: byRole,
    },
    policy: { dormant_days: DORMANT_DAYS, password_max_age_days: PASSWORD_MAX_AGE_DAYS, review_every_days: REVIEW_EVERY_DAYS },
    last_review: last || null,
    next_due: nextDue ? nextDue.toISOString() : null,
    overdue: !last || nextDue < new Date(),
  };
}

// GET /api/privilege-review?branch_id=
export const getReview = async (req, res) => {
  try {
    const branch = scopeBranch(req);
    const [branches] = pinned(req)
      ? await db.query('SELECT id, branch_name FROM branches WHERE id = ?', [pinned(req)])
      : await db.query("SELECT id, branch_name FROM branches WHERE status = 'Active' ORDER BY branch_name");
    res.json({ success: true, branches, branch_id: branch ? Number(branch) : null, ...(await buildReport(branch)) });
  } catch (error) {
    console.error('Error building privilege review:', error);
    res.status(500).json({ success: false, message: 'Server error building the privilege review' });
  }
};

// POST /api/privilege-review/complete { note, branch_id? } — the reviewer signs the review off.
export const completeReview = async (req, res) => {
  try {
    const branch = scopeBranch(req);
    const report = await buildReport(branch);
    const [[who]] = await db.query("SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [req.user.id]);
    const note = String(req.body?.note || '').trim().slice(0, 1000);
    // A review that leaves warnings in place must say why they are acceptable.
    if (report.summary.flagged > 0 && note.length < 5) {
      return res.status(400).json({ success: false, message: `${report.summary.flagged} account(s) are flagged. Add a note saying what was decided (deactivate, accept, follow up).` });
    }
    const snapshot = report.rows.map((r) => ({ id: r.id, name: r.name, role: r.role, hospital: r.hospital, active: r.active, last_login_at: r.last_login_at, flags: r.flags.map((f) => f.code) }));
    const [ins] = await db.query(
      'INSERT INTO privilege_reviews (branch_id, reviewed_by, reviewer_name, note, users_total, flagged_total, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [branch || null, req.user.id, who?.name || null, note || null, report.summary.total, report.summary.flagged, JSON.stringify(snapshot)]);
    res.status(201).json({ success: true, id: ins.insertId, message: 'Privilege review recorded.' });
  } catch (error) {
    console.error('Error completing privilege review:', error);
    res.status(500).json({ success: false, message: 'Server error recording the review' });
  }
};

// GET /api/privilege-review/history
export const reviewHistory = async (req, res) => {
  try {
    const branch = scopeBranch(req);
    const [rows] = await db.query(
      `SELECT id, branch_id, reviewer_name, reviewed_at, note, users_total, flagged_total FROM privilege_reviews
        WHERE ${branch ? 'branch_id = ?' : 'branch_id IS NULL'} ORDER BY id DESC LIMIT 50`, branch ? [branch] : []);
    res.json({ success: true, reviews: rows });
  } catch (error) {
    console.error('Error reading privilege review history:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// GET /api/privilege-review/export
export const exportReview = async (req, res) => {
  try {
    const report = await buildReport(scopeBranch(req));
    const cols = ['name', 'email', 'role', 'role_level', 'hospital', 'active', 'created_at', 'last_login_at', 'days_since_login', 'password_age_days', 'active_dsc'];
    const lines = [[...cols, 'flags'].join(','), ...report.rows.map((r) => [...cols.map((c) => csvCell(r[c])), csvCell(r.flags.map((f) => f.text).join('; '))].join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="privilege-review-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${lines.join('\r\n')}`);
  } catch (error) {
    console.error('Error exporting privilege review:', error);
    res.status(500).json({ success: false, message: 'Server error exporting the review' });
  }
};
