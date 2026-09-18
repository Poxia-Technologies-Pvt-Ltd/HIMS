import express from 'express';
import { getSurveillanceData, getAlerts } from '../controllers/disasterController.js';

const router = express.Router();

router.get('/surveillance', getSurveillanceData);
router.get('/alerts', getAlerts);

export default router;
