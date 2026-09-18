import express from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

router.get('/', getSettings);
router.put('/', authorizeRole(['Admin', 'Super Admin']), updateSettings);

export default router;
