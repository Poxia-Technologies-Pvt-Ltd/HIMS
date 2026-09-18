import express from 'express';
import {
  createBill,
  updateBill,
  getAllBills,
  getBillById,
  processPayment,
  getAvailableServices,
  getPatients,
  deleteBill,
  generateInvoice,
  sendWhatsApp,
  downloadInvoicePdf,
  getPatientBills
} from '../controllers/billingController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

// Day-to-day billing/collection work — front desk plus admin oversight.
const BILLING_ROLES = authorizeRole(['Admin', 'Super Admin', 'Receptionist']);
// Deleting a bill is destructive and auditable — restricted further than creating/updating one.
const ADMIN_ONLY = authorizeRole(['Admin', 'Super Admin']);

// Specific routes before wildcards
router.post('/create', BILLING_ROLES, createBill);
router.get('/all', getAllBills);
router.get('/services/available', getAvailableServices);
router.get('/patients/list', getPatients);
router.get('/patient/:regNo', getPatientBills);
router.post('/send-whatsapp', BILLING_ROLES, sendWhatsApp);

// Wildcard bill routes
router.put('/:id', BILLING_ROLES, updateBill);
router.get('/:id/pdf', downloadInvoicePdf);
router.post('/:id/payment', BILLING_ROLES, processPayment);
router.delete('/:id', ADMIN_ONLY, deleteBill);
router.get('/:id', getBillById);

export default router;
