import express from 'express';
import { getDutySchedules, addDutySchedule, deleteDutySchedule, getAvailableDoctors, getDutySlots } from '../controllers/dutyController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

// Matches App.jsx's own RequireLabAccess/RequireStaffAccess convention, which
// already treats duty-scheduler as an Admin/Super Admin/Lab Head page.
const DUTY_MANAGE_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);

router.get('/', getDutySchedules);
router.get('/available', getAvailableDoctors);
router.get('/slots', getDutySlots);
router.post('/add', DUTY_MANAGE_ROLES, addDutySchedule);
router.delete('/:id', DUTY_MANAGE_ROLES, deleteDutySchedule);

export default router;
