import { signalWorklistOnWrite } from '../utils/worklistSignal.js';
import express from 'express';
import {
  createBill,
  updateBill,
  getAllBills,
  getBillById,
  processPayment,
  getAvailableServices,
  getPatients,
  generateInvoice,
  sendWhatsApp,
  downloadInvoicePdf,
  getPatientBills,
  getOrderStatus,
  cancelPendingOrder
} from '../controllers/billingController.js';
import {
  APPROVER_ROLES, patientCharges, chargeQueue, cancelCharge, patientDues, listTariffs, saveTariff,
  requestApproval, listApprovals, approve, reject, withdraw, currentShift, closeShift, listClosings, controlSummary,
} from '../controllers/billingControlController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);
router.use(signalWorklistOnWrite);

// Day-to-day billing/collection work — front desk plus admin oversight.
const BILLING_ROLES = authorizeRole(['Admin', 'Super Admin', 'Receptionist', 'Accounts Manager']);
// Credit, cancellations, concessions, prices: never the person who asked.
const APPROVERS = authorizeRole(APPROVER_ROLES);

// Billing control
router.get('/charges', BILLING_ROLES, patientCharges);
router.get('/charges/queue', BILLING_ROLES, chargeQueue);
router.post('/charges/:id/cancel', APPROVERS, cancelCharge);
router.get('/dues', BILLING_ROLES, patientDues);
router.get('/tariffs', listTariffs);
router.post('/tariffs', APPROVERS, saveTariff);
router.put('/tariffs/:id', APPROVERS, saveTariff);
router.get('/approvals', BILLING_ROLES, listApprovals);
router.post('/approvals', BILLING_ROLES, requestApproval);
router.post('/approvals/:id/approve', APPROVERS, approve);
router.post('/approvals/:id/reject', APPROVERS, reject);
router.post('/approvals/:id/withdraw', BILLING_ROLES, withdraw);
router.get('/closing/current', BILLING_ROLES, currentShift);
router.post('/closing', BILLING_ROLES, closeShift);
router.get('/closings', BILLING_ROLES, listClosings);
router.get('/control', APPROVERS, controlSummary);

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
router.get('/:id/order-status', getOrderStatus);
router.post('/:id/cancel-order', BILLING_ROLES, cancelPendingOrder);
router.post('/:id/payment', BILLING_ROLES, processPayment);
router.get('/:id', getBillById);

export default router;
