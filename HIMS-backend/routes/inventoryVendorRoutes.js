import express from 'express';
import {
  getVendors,
  getVendorById,
  createVendor,
  updateVendor,
  deleteVendor
} from '../controllers/inventoryVendorController.js';

import { authenticateToken, authorizeRole } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticateToken);

const LAB_MANAGE_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);

router.get('/', getVendors);
router.get('/:id', getVendorById);
router.post('/', LAB_MANAGE_ROLES, createVendor);
router.put('/:id', LAB_MANAGE_ROLES, updateVendor);
router.delete('/:id', LAB_MANAGE_ROLES, deleteVendor);

export default router;
