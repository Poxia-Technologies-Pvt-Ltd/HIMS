import express from 'express';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { HR_ADMIN_ROLES } from '../utils/hr.js';
import {
  listLeaveTypes, createLeaveType, updateLeaveType, getBalances, allocateYear, adjustBalance,
  listRequests, applyLeave, approveLeave, rejectLeave, cancelLeave,
} from '../controllers/leaveController.js';

const router = express.Router();
router.use(authenticateToken);
const HR_ONLY = authorizeRole(HR_ADMIN_ROLES);

router.get('/types', listLeaveTypes);
router.post('/types', HR_ONLY, createLeaveType);
router.put('/types/:id', HR_ONLY, updateLeaveType);

router.get('/balances', getBalances);
router.post('/allocate', HR_ONLY, allocateYear);
router.post('/balances/adjust', HR_ONLY, adjustBalance);

// Approve/reject are open to reporting managers too; the controller checks.
router.get('/requests', listRequests);
router.post('/requests', applyLeave);
router.post('/requests/:id/approve', approveLeave);
router.post('/requests/:id/reject', rejectLeave);
router.post('/requests/:id/cancel', cancelLeave);

export default router;
