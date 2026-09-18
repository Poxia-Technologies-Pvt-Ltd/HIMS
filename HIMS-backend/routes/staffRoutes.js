import express from 'express';
import { getStaffStats, getAllStaff, addStaff, getDoctors, updateStaff, deleteStaff, unlockStaff, resetStaffPassword } from '../controllers/staffController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

// 'Lab Admin' and 'Lab Head' are included alongside 'Admin'/'Super Admin' for
// the two recovery actions only: they are the people physically present when a
// technician is locked out mid-shift, and making them wait for a Central admin
// defeats the purpose. They remain unable to create, edit or delete staff, and
// branch-level callers can still only act within their own branch
// (loadTargetStaff enforces that).
const STAFF_ADMIN = ['Admin', 'Super Admin'];
const STAFF_RECOVERY = ['Admin', 'Super Admin', 'Lab Admin', 'Lab Head'];

router.get('/stats',   authenticateToken, getStaffStats);
router.get('/list',    authenticateToken, getAllStaff);
router.get('/doctors', authenticateToken, getDoctors);
router.post('/add',    authenticateToken, authorizeRole(STAFF_ADMIN), addStaff);
router.put('/:id',     authenticateToken, authorizeRole(STAFF_ADMIN), updateStaff);
router.delete('/:id',  authenticateToken, authorizeRole(STAFF_ADMIN), deleteStaff);

router.patch('/:id/unlock',         authenticateToken, authorizeRole(STAFF_RECOVERY), unlockStaff);
router.patch('/:id/reset-password', authenticateToken, authorizeRole(STAFF_RECOVERY), resetStaffPassword);

export default router;
