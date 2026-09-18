import express from 'express';
import {
  getCareLogs,
  listDevices,
  getLoincMappings,
  runAutoMapLoincTests,
  confirmLoincMappingRow,
  getLoincParameterMappings,
  upsertLoincParameterMappingRow,
  importLoincParameterMappings,
} from '../controllers/careAdminController.js';
import { getAbhaDashboard } from '../controllers/abhaDashboardController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken); // staff JWT — unlike careRoutes.js's protocol endpoints

// LOINC mapping config affects the clinical semantics of released results.
const ADMIN_ONLY = authorizeRole(['Admin', 'Super Admin']);

// Read-only view of ABHA coverage and what actually reached CARE. Any staff
// role may look: it answers "did this patient's result get into the national
// record", which is a question the lab floor needs as much as an admin.
router.get('/abha-dashboard', getAbhaDashboard);

router.get('/logs', getCareLogs);
router.get('/devices', listDevices);

router.get('/loinc-mappings', getLoincMappings);
router.post('/loinc-mappings/auto-map', ADMIN_ONLY, runAutoMapLoincTests);
router.post('/loinc-mappings/:id/confirm', ADMIN_ONLY, confirmLoincMappingRow);

router.get('/loinc-parameter-mappings', getLoincParameterMappings);
router.post('/loinc-parameter-mappings', ADMIN_ONLY, upsertLoincParameterMappingRow);
router.post('/loinc-parameter-mappings/import', ADMIN_ONLY, importLoincParameterMappings);

export default router;
