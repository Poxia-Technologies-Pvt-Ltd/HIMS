import express from 'express';
import { getSettings, updateSettings, getBranding } from '../controllers/settingsController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.get('/branding', getBranding);
router.use(authenticateToken);

router.get('/', getSettings);
router.put('/', authorizeRole(['Admin', 'Super Admin']), updateSettings);

export default router;
