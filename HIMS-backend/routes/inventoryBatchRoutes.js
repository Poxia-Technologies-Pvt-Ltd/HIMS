import express from 'express';
import {
  getBatches,
  getBatchById,
  createBatch,
  updateBatch,
  deleteBatch
} from '../controllers/inventoryBatchController.js';

import { authenticateToken, authorizeRole } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticateToken);

const LAB_MANAGE_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);

router.get('/', getBatches);
router.get('/:id', getBatchById);
router.post('/', LAB_MANAGE_ROLES, createBatch);
router.put('/:id', LAB_MANAGE_ROLES, updateBatch);
router.delete('/:id', LAB_MANAGE_ROLES, deleteBatch);

export default router;
