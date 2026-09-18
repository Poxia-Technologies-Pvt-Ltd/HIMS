import express from 'express';
import {
  getFreeSchemes,
  createFreeScheme,
  updateFreeScheme,
  deactivateFreeScheme,
} from '../controllers/freeSchemeController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

const ADMIN_ONLY = authorizeRole(['Admin', 'Super Admin']);

router.get('/', getFreeSchemes);
router.post('/', ADMIN_ONLY, createFreeScheme);
router.put('/:id', ADMIN_ONLY, updateFreeScheme);
router.delete('/:id', ADMIN_ONLY, deactivateFreeScheme);

export default router;
