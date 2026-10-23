import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import { passwordProblem } from '../utils/passwordPolicy.js';

// Branch scope helper — Branch-level users only see their own branch
const branchScope = (req) => {
  const { role_level, branch_id } = req.user;
  if (role_level === 'Central') return null; // no restriction
  return branch_id;
};

export const getStaffStats = async (req, res) => {
  try {
    const scope = branchScope(req);
    const where = scope ? 'WHERE branch_id = ?' : '';
    const params = scope ? [scope] : [];
    const [rows] = await db.query(
      `SELECT role, COUNT(*) AS count FROM users ${where} GROUP BY role`,
      params
    );
    const stats = rows.reduce((acc, row) => { acc[row.role] = row.count; return acc; }, {});
    res.json({ success: true, stats });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getDoctors = async (req, res) => {
  try {
    const scope = branchScope(req);
    const [rows] = await db.query(
      `SELECT id, first_name, last_name, department FROM users
        WHERE role = 'Doctor' AND is_active = 1 ${scope ? 'AND branch_id = ?' : ''} ORDER BY department, first_name`,
      scope ? [scope] : []
    );
    res.json({ success: true, doctors: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getAllStaff = async (req, res) => {
  try {
    const scope = branchScope(req);
    // Central admins can optionally filter by branch_id via query param
    const filterBranch = scope || req.query.branch_id || null;
    const params = [];
    let where = '';
    if (filterBranch) { where = 'WHERE u.branch_id = ?'; params.push(filterBranch); }

    const [rows] = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
              u.role, u.role_level, u.department, u.staff_id,
              u.branch_id, b.branch_name, u.created_at
         FROM users u
         LEFT JOIN branches b ON u.branch_id = b.id
         ${where}
         ORDER BY u.created_at DESC`,
      params
    );
    res.json({ success: true, staff: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const addStaff = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, role, department, staffId, password, role_level } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ success: false, message: 'email, password and role are required' });
    }
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ success: false, message: problem });

    // Determine branch: Branch-level admin can only create staff in their own branch
    const callerScope = branchScope(req);
    const branch_id = callerScope || req.body.branch_id || req.user.branch_id || null;

    // Only Central admins can set role_level; others default to Branch
    const assignedLevel = req.user.role_level === 'Central' ? (role_level || 'Branch') : 'Branch';

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // VAPT #16 (No Compulsory Change Password Functionality): the admin
    // adding this staff member picked the password, so force a change on
    // first login.
    const [result] = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, role, department, staff_id, password, branch_id, role_level, password_change_required)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [firstName, lastName, email, phone || null, role, department || null, staffId || null, hashedPassword, branch_id, assignedLevel]
    );
    res.status(201).json({ success: true, message: 'Staff member added successfully', id: result.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone, role, department, role_level, branch_id } = req.body;

    // Branch-level callers can only update staff in their own branch
    const scope = branchScope(req);
    if (scope) {
      const [[member]] = await db.query('SELECT branch_id FROM users WHERE id = ?', [id]);
      if (!member || member.branch_id != scope) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    const assignedLevel = req.user.role_level === 'Central' ? (role_level || 'Branch') : 'Branch';
    const assignedBranch = scope || branch_id || null;

    await db.query(
      `UPDATE users SET first_name=?, last_name=?, phone=?, role=?, department=?, role_level=?, branch_id=? WHERE id=?`,
      [firstName, lastName, phone || null, role, department || null, assignedLevel, assignedBranch, id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Shared guard for the admin actions below: Branch-level admins may only act
// on staff in their own branch; Central may act on anyone. Returns the target
// row, or null once it has already sent the error response.
const loadTargetStaff = async (req, res) => {
  const { id } = req.params;
  const [[member]] = await db.query(
    'SELECT id, email, branch_id, locked_until, failed_login_attempts FROM users WHERE id = ?',
    [id]
  );
  if (!member) {
    res.status(404).json({ success: false, message: 'User not found' });
    return null;
  }
  const scope = branchScope(req);
  if (scope && member.branch_id != scope) {
    res.status(403).json({ success: false, message: 'Access denied' });
    return null;
  }
  return member;
};

// PATCH /api/staff/:id/unlock
//
// Clears the account lockout (VAPT #6) so an admin can put a member of staff
// back to work immediately. Previously nothing anywhere reset these columns:
// once locked, the only remedy was to wait out the window, which on a shared
// government terminal meant a technician sitting idle mid-shift.
//
// This does NOT clear the login rate limiter — that lives in the API process's
// memory, is keyed on email+IP, and expires on its own within 15 minutes.
export const unlockStaff = async (req, res) => {
  try {
    const member = await loadTargetStaff(req, res);
    if (!member) return;

    await db.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      [member.id]
    );
    console.log(`Account unlocked: ${member.email} (by user ${req.user.id})`);
    res.json({ success: true, message: 'Account unlocked. The user can log in again immediately.' });
  } catch (e) {
    console.error('unlockStaff error:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/staff/:id/reset-password  { password }
//
// Same capability the developer panel already had (developerController
// .resetPassword), but available to Lab/Super Admins for their own staff —
// they are the ones actually on site when someone forgets a password.
export const resetStaffPassword = async (req, res) => {
  try {
    const { password } = req.body;
    // Matches the 8-character minimum authController enforces on self-service
    // password changes; the developer route's older 6 is weaker than the
    // policy the user will be held to on their next change.
    const problem = passwordProblem(password);
    if (problem) {
      return res.status(400).json({ success: false, message: problem });
    }

    const member = await loadTargetStaff(req, res);
    if (!member) return;

    const hashed = await bcrypt.hash(password, 10);
    // VAPT #16: an admin-chosen password must be replaced by one only the user
    // knows, so force a change at next login. Also clears any lockout — an
    // admin resetting a password is invariably fixing a login problem, and
    // leaving the account locked would defeat the point.
    await db.query(
      `UPDATE users
          SET password = ?, password_change_required = 1,
              failed_login_attempts = 0, locked_until = NULL
        WHERE id = ?`,
      [hashed, member.id]
    );
    console.log(`Password reset: ${member.email} (by user ${req.user.id})`);
    res.json({
      success: true,
      message: 'Password reset. The user must set a new password at next login.',
    });
  } catch (e) {
    console.error('resetStaffPassword error:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const deleteStaff = async (req, res) => {
  try {
    const { id } = req.params;
    // Prevent self-deletion
    if (id == req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }
    const scope = branchScope(req);
    if (scope) {
      const [[member]] = await db.query('SELECT branch_id FROM users WHERE id = ?', [id]);
      if (!member || member.branch_id != scope) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }
    await db.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
