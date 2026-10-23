import express from 'express';
import * as c from '../controllers/poctController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

// Mounted at /api/poct (tender #123).
const router = express.Router();
router.use(authenticateToken);

const STAFF = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Doctor', 'Lab Technician', 'Doctor']);
const MANAGERS = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Doctor']);
const VIEW = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Doctor', 'Lab Technician', 'Doctor', 'Auditor', 'Programme Officer']);

router.get('/devices', VIEW, c.listDevices);
router.post('/devices', MANAGERS, c.saveDevice);
router.put('/devices/:id', MANAGERS, c.saveDevice);
router.get('/devices/:id/operators', VIEW, c.listOperators);
router.post('/devices/:id/operators', MANAGERS, c.certifyOperator);
router.delete('/devices/:id/operators/:userId', MANAGERS, c.removeOperator);
router.get('/devices/:id/qc', VIEW, c.listQc);
router.post('/devices/:id/qc', STAFF, c.recordQc);
router.get('/results', VIEW, c.listResults);
router.post('/results', STAFF, c.recordResult);

export default router;
