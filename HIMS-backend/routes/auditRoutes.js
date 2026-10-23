import express from 'express';
import { listAudit, verifyAudit, exportAudit, syncIntegrity } from '../controllers/auditController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);
router.use(authorizeRole(['Admin', 'Super Admin', 'Auditor']));

router.get('/', listAudit);
router.get('/verify', verifyAudit);
router.get('/sync-integrity', syncIntegrity);
router.get('/export', exportAudit);

export default router;
