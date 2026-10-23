import express from 'express';
import {
  getConfig, createCheckoutOrder, verifyCheckout, checkoutFailed, createLink,
  checkStatus, cancelLink, billPayments, listTransactions, reconcile, webhook,
} from '../controllers/paymentController.js';
import { listTestPrices, saveTestPrices } from '../controllers/testPriceController.js';
import { getSettings, saveSettings, billingContext } from '../controllers/paymentSettingsController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

// Mounted at /api/payments.
const router = express.Router();

// Razorpay webhook — public, authenticated by its X-Razorpay-Signature HMAC.
router.post('/razorpay/webhook', webhook);

router.use(authenticateToken);
const CASHIER = authorizeRole(['Admin', 'Super Admin', 'Receptionist', 'Accounts Manager']);
const VIEW = authorizeRole(['Admin', 'Super Admin', 'Receptionist', 'Auditor']);

router.get('/config', getConfig);
router.post('/razorpay/order', CASHIER, createCheckoutOrder);
router.post('/razorpay/verify', CASHIER, verifyCheckout);
router.post('/razorpay/checkout-failed', CASHIER, checkoutFailed);
router.post('/razorpay/link', CASHIER, createLink);
router.post('/transactions/:id/check', CASHIER, checkStatus);
router.post('/transactions/:id/cancel', CASHIER, cancelLink);
router.get('/transactions', VIEW, listTransactions);
router.post('/reconcile', CASHIER, reconcile);
router.get('/bills/:billId', VIEW, billPayments);

export default router;

// Facility price lists for lab tests — mounted at /api/test-prices.
export const testPriceRouter = express.Router();
testPriceRouter.use(authenticateToken);
testPriceRouter.get('/', authorizeRole(['Admin', 'Super Admin', 'Receptionist', 'Auditor']), listTestPrices);
testPriceRouter.put('/', authorizeRole(['Admin', 'Super Admin']), saveTestPrices);

// Payment settings per hospital — mounted at /api/payment-settings.
export const paymentSettingsRouter = express.Router();
paymentSettingsRouter.use(authenticateToken);
paymentSettingsRouter.get('/billing', authorizeRole(['Admin', 'Super Admin', 'Receptionist', 'Accounts Manager']), billingContext);
paymentSettingsRouter.get('/', authorizeRole(['Admin', 'Super Admin', 'Auditor']), getSettings);
paymentSettingsRouter.put('/', authorizeRole(['Admin', 'Super Admin']), saveSettings);
