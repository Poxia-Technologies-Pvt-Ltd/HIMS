import express from 'express';
import {
  getTransfers,
  createTransfer,
  updateTransferStatus
} from '../controllers/inventoryTransferController.js';

import { authenticateToken, authorizeRole } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticateToken);

const LAB_MANAGE_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);

router.get('/', getTransfers);
router.post('/', LAB_MANAGE_ROLES, createTransfer);
router.put('/:id/status', LAB_MANAGE_ROLES, updateTransferStatus);

export default router;
