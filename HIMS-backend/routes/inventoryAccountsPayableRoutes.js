import express from 'express';
import {
  getInvoices,
  createInvoice,
  createPayment,
  getDashboardStats,
  getSupplierLedger
} from '../controllers/inventoryAccountsPayableController.js';

import { authenticateToken, authorizeRole } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticateToken);

const ADMIN_ONLY = authorizeRole(['Admin', 'Super Admin']);

router.get('/stats', getDashboardStats);
router.get('/invoices', getInvoices);
router.post('/invoices', ADMIN_ONLY, createInvoice);
router.post('/payments', ADMIN_ONLY, createPayment);
router.get('/ledger/:vendor_id', getSupplierLedger);

export default router;
