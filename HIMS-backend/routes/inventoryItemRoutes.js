import express from 'express';
import {
  getItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem
} from '../controllers/inventoryItemController.js';

import { authenticateToken, authorizeRole } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticateToken);

const LAB_MANAGE_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);

router.get('/', getItems);
router.get('/:id', getItemById);
router.post('/', LAB_MANAGE_ROLES, createItem);
router.put('/:id', LAB_MANAGE_ROLES, updateItem);
router.delete('/:id', LAB_MANAGE_ROLES, deleteItem);

export default router;
