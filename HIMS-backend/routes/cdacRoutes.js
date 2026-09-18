import express from 'express';
import {
  pullCdacOrder,
  syncCdacMasterData,
  getCdacLogs,
  getBranchConfig,
  setBranchConfig,
  getTestMappings,
  runAutoMapTestCodes,
  confirmTestMappingRow,
  getParameterMappings,
  upsertParameterMappingRow,
  importParameterMappings,
} from '../controllers/cdacController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

// Integration/mapping config affects the clinical semantics of released
// results if misconfigured, so it's restricted to admin tier. pull-order is
// left open since it's the routine "fetch this incoming order" action, not config.
const ADMIN_ONLY = authorizeRole(['Admin', 'Super Admin']);

router.post('/pull-order', pullCdacOrder);
router.post('/sync-master-data', ADMIN_ONLY, syncCdacMasterData);
router.get('/logs', getCdacLogs);

router.get('/branch-config', getBranchConfig);
router.post('/branch-config', ADMIN_ONLY, setBranchConfig);

router.get('/test-mappings', getTestMappings);
router.post('/test-mappings/auto-map', ADMIN_ONLY, runAutoMapTestCodes);
router.post('/test-mappings/:id/confirm', ADMIN_ONLY, confirmTestMappingRow);

router.get('/parameter-mappings', getParameterMappings);
router.post('/parameter-mappings', ADMIN_ONLY, upsertParameterMappingRow);
router.post('/parameter-mappings/import', ADMIN_ONLY, importParameterMappings);

export default router;
