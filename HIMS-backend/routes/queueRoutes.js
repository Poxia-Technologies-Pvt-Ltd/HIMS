import express from 'express';
import { listTokens, updateTokenStatus, getAuditEvents, getAuditTokens } from '../controllers/queueController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

const STAFF_ROLES = ['Admin', 'Doctor', 'Lab Head', 'Lab Technician', 'Staff', 'Receptionist', 'Phlebotomist', 'Super Admin'];
router.use(authorizeRole(STAFF_ROLES));

router.get('/tokens', listTokens);
router.put('/tokens/:id/status', updateTokenStatus);

// Audit trail — read-only. Supervisors, plus the receptionist, who issues
// the patient their token and needs to look one up ("where is my number?").
const AUDIT_ROLES = ['Admin', 'Super Admin', 'Lab Head', 'Receptionist'];
router.get('/audit/events', authorizeRole(AUDIT_ROLES), getAuditEvents);
router.get('/audit/tokens', authorizeRole(AUDIT_ROLES), getAuditTokens);

export default router;
