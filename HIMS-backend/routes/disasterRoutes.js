import express from 'express';
import { getSurveillanceData, getAlerts, getDistrictResources, listRules, updateRule } from '../controllers/disasterController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

// Aggregates of real patient results now, so staff login is required.
const router = express.Router();
router.use(authenticateToken);

router.get('/surveillance', getSurveillanceData);
router.get('/alerts', getAlerts);
router.get('/resources', getDistrictResources);
router.get('/rules', listRules);
router.put('/rules/:id', authorizeRole(['Admin', 'Super Admin', 'Programme Officer']), updateRule);

export default router;
