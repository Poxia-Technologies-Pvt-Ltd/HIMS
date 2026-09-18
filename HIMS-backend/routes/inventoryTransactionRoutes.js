import express from 'express';
import {
  getTransactions,
  createTransaction
} from '../controllers/inventoryTransactionController.js';

import { authenticateToken, authorizeRole } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticateToken);

router.get('/', getTransactions);
router.post('/', authorizeRole(['Admin', 'Super Admin', 'Lab Head']), createTransaction);

export default router;
