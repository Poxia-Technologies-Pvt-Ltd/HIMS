import db from '../config/db.js';
import { passwordProblem } from '../utils/passwordPolicy.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';
import path from 'path';
import { createCaptcha, verifyCaptcha } from '../utils/captchaStore.js';
import { issueCsrfToken, verifyAndRotateCsrfToken } from '../utils/csrfStore.js';
import { seedBranchHmisConfig } from '../services/cdacService.js';

// ── In-memory OTP store ──────────────────────────────────────────────────────
// { email: { otp, expiry, attempts } }
const otpStore = new Map();

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const DEV_EMAIL  = process.env.DEVELOPER_EMAIL;
const DEV_SECRET = process.env.DEVELOPER_JWT_SECRET;

// VAPT #9 (Cookie Header Not Implemented) — this developer-portal login is a
// separate code path from authController.login and wasn't covered by that
// earlier fix: verifyOTP was still handing the raw JWT back in the JSON body
// for the frontend to stash in localStorage (DeveloperLogin.jsx), readable by
// any XSS. Mirrors the staff session cookie exactly (httpOnly/secure/
// sameSite, prod-only Secure+None) so it closes the same finding here.
const isProd = process.env.NODE_ENV === 'production';
const DEV_COOKIE_NAME = 'hims_dev_token';
const devCookieOptions = () => ({
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  path: '/',
  maxAge: 8 * 60 * 60 * 1000, // matches the dev JWT's 8h expiry
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
});

// ── Mailer ───────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// ── Helpers ──────────────────────────────────────────────────────────────────
const randomOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ── AUTH: Send OTP ───────────────────────────────────────────────────────────
export const sendOTP = async (req, res) => {
  try {
    const { email, captchaId, captchaText } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    if (!verifyCaptcha(captchaId, captchaText)) {
      return res.status(400).json({ success: false, message: 'Invalid or expired captcha', captcha: createCaptcha() });
    }
    if (email.toLowerCase() !== DEV_EMAIL.toLowerCase()) {
      return res.status(403).json({ success: false, message: 'Unauthorized', captcha: createCaptcha() });
    }

    const otp    = randomOTP();
    const expiry = Date.now() + 5 * 60 * 1000; // 5 minutes
    otpStore.set(email.toLowerCase(), { otp, expiry, attempts: 0 });

    await transporter.sendMail({
      from: `"LIMS Developer Access" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `🔐 Developer OTP: ${otp}`,
      html: `
        <div style="font-family:monospace;max-width:420px;margin:40px auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:12px;border:1px solid #334155">
          <div style="font-size:13px;color:#94a3b8;margin-bottom:8px">LIMS DEVELOPER PORTAL</div>
          <div style="font-size:36px;font-weight:700;letter-spacing:10px;color:#38bdf8;margin:24px 0">${otp}</div>
          <div style="font-size:13px;color:#64748b">Valid for <strong style="color:#f59e0b">5 minutes</strong>. Do not share this code.</div>
        </div>
      `,
    });

    res.json({ success: true, message: 'OTP sent to developer email' });
  } catch (err) {
    console.error('sendOTP error:', err);
    res.status(500).json({ success: false, message: 'Failed to send OTP', captcha: createCaptcha() });
  }
};

// ── AUTH: Verify OTP ─────────────────────────────────────────────────────────
export const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP required' });

    const key    = email.toLowerCase();
    const record = otpStore.get(key);

    if (!record) return res.status(400).json({ success: false, message: 'No OTP requested or it expired' });
    if (Date.now() > record.expiry) {
      otpStore.delete(key);
      return res.status(400).json({ success: false, message: 'OTP expired. Request a new one.' });
    }

    record.attempts++;
    if (record.attempts > 3) {
      otpStore.delete(key);
      return res.status(429).json({ success: false, message: 'Too many attempts. Request a new OTP.' });
    }

    if (record.otp !== otp.toString()) {
      return res.status(400).json({ success: false, message: `Invalid OTP. ${3 - record.attempts} attempt(s) left.` });
    }

    otpStore.delete(key);

    const sid = crypto.randomUUID();
    const token = jwt.sign({ dev: true, email: key, sid }, DEV_SECRET, { expiresIn: '8h' });
    res.cookie(DEV_COOKIE_NAME, token, devCookieOptions());
    res.json({ success: true, csrfToken: issueCsrfToken(sid) });
  } catch (err) {
    console.error('verifyOTP error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// See authController.logout for why maxAge is stripped before clearCookie.
export const devLogout = (req, res) => {
  const { maxAge, ...clearOptions } = devCookieOptions();
  res.clearCookie(DEV_COOKIE_NAME, clearOptions);
  res.json({ success: true, message: 'Logged out' });
};

// ── MIDDLEWARE: Verify developer JWT ─────────────────────────────────────────
export const devAuth = (req, res, next) => {
  // Cookie takes priority; Authorization header stays as a fallback for
  // non-browser API clients (see authenticateToken in middleware/auth.js).
  const headerToken = req.headers['authorization']?.split(' ')[1];
  const token = req.cookies?.[DEV_COOKIE_NAME] || headerToken;
  if (!token) return res.status(401).json({ success: false, message: 'No token' });

  let decoded;
  try {
    decoded = jwt.verify(token, DEV_SECRET, { algorithms: ['HS256'] });
    if (!decoded.dev) throw new Error('Not a dev token');
  } catch {
    return res.status(403).json({ success: false, message: 'Invalid or expired developer session' });
  }

  req.dev = decoded;

  if (MUTATING_METHODS.has(req.method)) {
    const rotated = verifyAndRotateCsrfToken(decoded.sid, req.headers['x-csrf-token']);
    if (!rotated) {
      return res.status(403).json({ success: false, message: 'Invalid or missing CSRF token' });
    }
    res.setHeader('X-CSRF-Token', rotated);
  }

  next();
};

// ── STATS ────────────────────────────────────────────────────────────────────
export const getStats = async (req, res) => {
  try {
    const [[{ hospitals }]] = await db.query(`SELECT COUNT(*) as hospitals FROM branches`);
    const [[{ labs }]]      = await db.query(`SELECT COUNT(*) as labs FROM infrastructure WHERE type = 'Lab'`);
    const [[{ users }]]     = await db.query(`SELECT COUNT(*) as users FROM users`);
    const [[{ active }]]    = await db.query(`SELECT COUNT(*) as active FROM users WHERE is_active = 1 OR is_active IS NULL`);
    const [[{ districts }]] = await db.query(`SELECT COUNT(*) as districts FROM districts`);
    const [[{ bills_today }]] = await db.query(`SELECT COUNT(*) as bills_today FROM bills WHERE DATE(created_at) = CURDATE()`);
    const [[{ tests_today }]] = await db.query(`SELECT COUNT(*) as tests_today FROM bill_items WHERE DATE(created_at) = CURDATE() AND service_type = 'Laboratory'`);

    res.json({ success: true, stats: { hospitals, labs, users, active_users: active, districts, bills_today, tests_today } });
  } catch (err) {
    console.error('getStats error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── HOSPITALS (BRANCHES) ─────────────────────────────────────────────────────
export const getHospitals = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, d.name as district_name, p.branch_name as parent_name
       FROM branches b
       LEFT JOIN districts d ON b.district_id = d.id
       LEFT JOIN branches p  ON b.parent_branch_id = p.id
       ORDER BY d.name, b.branch_level, b.branch_name`
    );
    const [districts] = await db.query(`SELECT * FROM districts ORDER BY name`);
    res.json({ success: true, hospitals: rows, districts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createHospital = async (req, res) => {
  try {
    const { district_id, branch_name, hospital_code, category = 'General Lab', address, contact_number, branch_level = 'Center', parent_branch_id } = req.body;
    if (!district_id || !branch_name || !hospital_code) {
      return res.status(400).json({ success: false, message: 'district_id, branch_name and hospital_code are required' });
    }
    const [result] = await db.query(
      `INSERT INTO branches (district_id, branch_name, category, branch_level, parent_branch_id, hospital_code, address, contact_number, status)
       VALUES (?, ?, ?, ?, ?, UPPER(?), ?, ?, 'Active')`,
      [district_id, branch_name, category, branch_level, parent_branch_id || null, hospital_code, address || '', contact_number || '']
    );
    // This path previously never created a branch_hmis_config row at all,
    // silently blocking CDAC pull/push for any branch created this way
    // (see services/cdacService.js seedBranchHmisConfig).
    await seedBranchHmisConfig(result.insertId, district_id);
    res.json({ success: true, message: 'Hospital created', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Hospital code already exists' });
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateHospital = async (req, res) => {
  try {
    const { id } = req.params;
    const { branch_name, hospital_code, category, address, contact_number, status } = req.body;
    await db.query(
      `UPDATE branches SET branch_name=?, hospital_code=UPPER(?), category=?, address=?, contact_number=?, status=? WHERE id=?`,
      [branch_name, hospital_code, category, address || '', contact_number || '', status || 'Active', id]
    );
    res.json({ success: true, message: 'Hospital updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const deleteHospital = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(`DELETE FROM branches WHERE id = ?`, [id]);
    res.json({ success: true, message: 'Hospital deleted' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete — hospital has linked records' });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── DISTRICTS ────────────────────────────────────────────────────────────────
export const createDistrict = async (req, res) => {
  try {
    const { name, state = null } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'District name required' });
    const [result] = await db.query(`INSERT INTO districts (name, state) VALUES (?, ?)`, [name, state]);
    res.json({ success: true, message: 'District created', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'District already exists' });
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── LABS (INFRASTRUCTURE) ────────────────────────────────────────────────────
export const getLabs = async (req, res) => {
  try {
    const { branch_id } = req.query;
    let sql = `SELECT i.*, b.branch_name, b.hospital_code,
                (SELECT COUNT(*) FROM lab_machines WHERE lab_id = i.id) as machine_count
               FROM infrastructure i
               LEFT JOIN branches b ON i.branch_id = b.id
               WHERE i.type = 'Lab'`;
    const params = [];
    if (branch_id) { sql += ' AND i.branch_id = ?'; params.push(branch_id); }
    sql += ' ORDER BY b.branch_name, i.name';
    const [rows] = await db.query(sql, params);
    res.json({ success: true, labs: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createLab = async (req, res) => {
  try {
    const { name, branch_id, block, floor, capacity, status = 'Available' } = req.body;
    if (!name || !branch_id) return res.status(400).json({ success: false, message: 'name and branch_id required' });
    const [result] = await db.query(
      `INSERT INTO infrastructure (name, type, branch_id, block, floor, capacity, status) VALUES (?, 'Lab', ?, ?, ?, ?, ?)`,
      [name, branch_id, block || '', floor || '', capacity || 1, status]
    );
    res.json({ success: true, message: 'Lab created', id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateLab = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, block, floor, capacity, status } = req.body;
    await db.query(
      `UPDATE infrastructure SET name=?, block=?, floor=?, capacity=?, status=? WHERE id=? AND type='Lab'`,
      [name, block || '', floor || '', capacity || 1, status || 'Available', id]
    );
    res.json({ success: true, message: 'Lab updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const deleteLab = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(`DELETE FROM infrastructure WHERE id = ? AND type = 'Lab'`, [id]);
    res.json({ success: true, message: 'Lab deleted' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete — lab has linked machines or records' });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── USERS ────────────────────────────────────────────────────────────────────
export const getUsers = async (req, res) => {
  try {
    const { branch_id, role } = req.query;
    let sql = `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.role,
                      u.department, u.staff_id, u.branch_id, u.role_level,
                      COALESCE(u.is_active, 1) as is_active, u.created_at,
                      b.branch_name, b.hospital_code
               FROM users u
               LEFT JOIN branches b ON u.branch_id = b.id
               WHERE 1=1`;
    const params = [];
    if (branch_id) { sql += ' AND u.branch_id = ?'; params.push(branch_id); }
    if (role)      { sql += ' AND u.role = ?';      params.push(role); }
    sql += ' ORDER BY b.branch_name, u.role, u.first_name';
    const [rows] = await db.query(sql, params);
    res.json({ success: true, users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createUser = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, role, department, staffId, password, branch_id, role_level = 'Branch' } = req.body;
    if (!email || !password || !role || !firstName) {
      return res.status(400).json({ success: false, message: 'firstName, email, password and role are required' });
    }
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ success: false, message: problem });
    const hashed = await bcrypt.hash(password, 10);
    // VAPT #16 (No Compulsory Change Password Functionality): the developer
    // chose this password on the new user's behalf, so force a change on
    // their first login.
    const [result] = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, role, department, staff_id, password, branch_id, role_level, password_change_required)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [firstName, lastName || '', email, phone || null, role, department || '', staffId || null, hashed, branch_id || null, role_level]
    );
    res.json({ success: true, message: 'User created', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Email already exists' });
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone, role, department, staffId, branch_id, role_level } = req.body;
    await db.query(
      `UPDATE users SET first_name=?, last_name=?, phone=?, role=?, department=?, staff_id=?, branch_id=?, role_level=? WHERE id=?`,
      [firstName, lastName || '', phone || null, role, department || '', staffId || null, branch_id || null, role_level || 'Branch', id]
    );
    res.json({ success: true, message: 'User updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const [[user]] = await db.query(`SELECT COALESCE(is_active, 1) as is_active FROM users WHERE id = ?`, [id]);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const newStatus = user.is_active ? 0 : 1;
    await db.query(`UPDATE users SET is_active = ? WHERE id = ?`, [newStatus, id]);
    res.json({ success: true, message: newStatus ? 'User activated' : 'User deactivated', is_active: newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ success: false, message: problem });
    const hashed = await bcrypt.hash(password, 10);
    // VAPT #16: a reset password is admin-chosen, same as at account
    // creation — force the user to pick their own on next login.
    await db.query(`UPDATE users SET password = ?, password_change_required = 1 WHERE id = ?`, [hashed, id]);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── MACHINE BRANDS (protocol definitions) ────────────────────────────────────
export const getBrands = async (req, res) => {
  try {
    const dir = path.resolve('./utils/machinesid.json');
    const files = await fs.readdir(dir);
    const brands = await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async (file) => {
          const raw  = await fs.readFile(path.join(dir, file), 'utf8');
          const protocol = JSON.parse(raw);
          const name = file.replace('.json', '');
          const protocolType = protocol.protocol_type || protocol.protocol || 'Binary';
          const paramCount   = protocol.frame_structure?.['2']?.tests?.length
            || protocol.tests?.length
            || 0;
          return { name, file, protocolType, paramCount, protocol };
        })
    );
    res.json({ success: true, brands });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
