import express from 'express';
import {
  getBranches,
  createDistrict,
  updateDistrict,
  deleteDistrict,
  patchBranchBlock,
  createCenter,
  updateCenter,
  deleteCenter,
  createFacilityCategory,
  updateFacilityCategory,
  deleteFacilityCategory
} from '../controllers/branchController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

// Public: the self-registration page needs to list branches/districts before
// the visitor has an account, so this one route stays ahead of the auth gate.
router.get('/', getBranches);

router.use(authenticateToken);

const ADMIN_ONLY = authorizeRole(['Admin', 'Super Admin']);

router.post('/district', ADMIN_ONLY, createDistrict);
router.put('/district/:id', ADMIN_ONLY, updateDistrict);
router.delete('/district/:id', ADMIN_ONLY, deleteDistrict);

router.patch('/center/:id/block', ADMIN_ONLY, patchBranchBlock);
router.post('/center', ADMIN_ONLY, createCenter);
router.put('/center/:id', ADMIN_ONLY, updateCenter);
router.delete('/center/:id', ADMIN_ONLY, deleteCenter);

router.post('/categories', ADMIN_ONLY, createFacilityCategory);
router.put('/categories/:id', ADMIN_ONLY, updateFacilityCategory);
router.delete('/categories/:id', ADMIN_ONLY, deleteFacilityCategory);

export default router;
