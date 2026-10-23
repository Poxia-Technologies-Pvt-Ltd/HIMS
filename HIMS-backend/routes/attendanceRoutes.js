import express from 'express';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { HR_ADMIN_ROLES } from '../utils/hr.js';
import {
  myToday, punch, myMonth, dailyRegister, monthlyReport, manualPunch, deletePunch, getSettings, saveSettings,
} from '../controllers/attendanceController.js';

const router = express.Router();
router.use(authenticateToken);
const HR_ONLY = authorizeRole(HR_ADMIN_ROLES);

router.get('/me/today', myToday);
router.post('/punch', punch);
router.get('/me', myMonth);
// Register and monthly view are also open to roster planners; the controller checks.
router.get('/register', dailyRegister);
router.get('/monthly', monthlyReport);
router.post('/manual', HR_ONLY, manualPunch);
router.delete('/punch/:id', HR_ONLY, deletePunch);
router.get('/settings', HR_ONLY, getSettings);
router.put('/settings', HR_ONLY, saveSettings);

export default router;
