import express from 'express';
import { getProgramme, exportProgramme } from '../controllers/programmeController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

// Mounted at /api/programme. What each user sees is scoped inside the controller
// (state → every district, district → own district, facility → own facility).
const router = express.Router();
router.use(authenticateToken);

const VIEWERS = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician', 'Programme Officer', 'Auditor']);

router.get('/dashboard', VIEWERS, getProgramme);
router.get('/export', VIEWERS, exportProgramme);

export default router;
