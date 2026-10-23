import express from 'express';
import { getDutySchedules, getAvailableDoctors, getDutySlots } from '../controllers/dutyController.js';
import { authenticateToken } from '../middleware/auth.js';

// Read-only OPD availability for booking. Duties are created and changed
// through /api/roster.
const router = express.Router();
router.use(authenticateToken);

router.get('/', getDutySchedules);
router.get('/available', getAvailableDoctors);
router.get('/slots', getDutySlots);

export default router;
