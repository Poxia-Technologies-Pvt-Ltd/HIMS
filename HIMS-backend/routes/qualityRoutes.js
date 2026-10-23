import express from 'express';
import {
  getOptions,
  listMaterials,
  createMaterial,
  updateMaterial,
  listRuns,
  recordRun,
  addCorrectiveAction,
  listEqas,
  createEqas,
  updateEqas,
  getDashboard,
} from '../controllers/qualityController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

// Mounted at /api/quality.
const router = express.Router();
router.use(authenticateToken);

const LAB_STAFF = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician']);
const LAB_MANAGERS = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);
const DASHBOARD_VIEWERS = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician', 'Programme Officer', 'Auditor']);

router.get('/options', DASHBOARD_VIEWERS, getOptions);
router.get('/dashboard', DASHBOARD_VIEWERS, getDashboard);

router.get('/materials', DASHBOARD_VIEWERS, listMaterials);
router.post('/materials', LAB_MANAGERS, createMaterial);
router.put('/materials/:id', LAB_MANAGERS, updateMaterial);
router.get('/materials/:id/runs', DASHBOARD_VIEWERS, listRuns);
router.post('/runs', LAB_STAFF, recordRun);
router.put('/runs/:id/corrective-action', LAB_STAFF, addCorrectiveAction);

router.get('/eqas', DASHBOARD_VIEWERS, listEqas);
router.post('/eqas', LAB_MANAGERS, createEqas);
router.put('/eqas/:id', LAB_MANAGERS, updateEqas);

export default router;
