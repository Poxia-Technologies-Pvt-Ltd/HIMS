import express from 'express';
import {
  getMappings,
  createMapping,
  deleteMapping
} from '../controllers/inventoryMappingController.js';

import { authenticateToken, authorizeRole } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticateToken);

const LAB_MANAGE_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);

router.get('/', getMappings);
router.post('/', LAB_MANAGE_ROLES, createMapping);
router.delete('/:id', LAB_MANAGE_ROLES, deleteMapping);

export default router;
