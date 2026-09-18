import express from 'express';
import { getSmartAnalytics } from '../controllers/inventoryAnalyticsController.js';

import { authenticateToken } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticateToken);

router.get('/', getSmartAnalytics);

export default router;
