import express from 'express';
import {
  getPRs,
  createPR,
  updatePRStatus,
  getPOs,
  createPO,
  updatePOStatus,
  sendPOByEmail
} from '../controllers/inventoryProcurementController.js';

import { authenticateToken, authorizeRole } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticateToken);

const LAB_MANAGE_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);

router.get('/requisitions', getPRs);
router.post('/requisitions', LAB_MANAGE_ROLES, createPR);
router.put('/requisitions/:id/status', LAB_MANAGE_ROLES, updatePRStatus);

router.get('/orders', getPOs);
router.post('/orders', LAB_MANAGE_ROLES, createPO);
router.put('/orders/:id/status', LAB_MANAGE_ROLES, updatePOStatus);
router.post('/orders/:id/send-email', LAB_MANAGE_ROLES, sendPOByEmail);

export default router;
