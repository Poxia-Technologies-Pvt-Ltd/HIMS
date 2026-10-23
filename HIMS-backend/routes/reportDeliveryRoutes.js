import express from 'express';
import {
  listDeliveries,
  resendDelivery,
  sendReport,
  getConsent,
  setConsent,
  whatsappWebhookVerify,
  whatsappWebhookReceive,
} from '../controllers/reportDeliveryController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

// Mounted at /api/report-delivery.
const router = express.Router();
router.use(authenticateToken);

const DELIVERY_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician', 'Receptionist', 'Auditor']);
const SEND_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician', 'Receptionist']);

router.get('/', DELIVERY_ROLES, listDeliveries);
router.post('/send', SEND_ROLES, sendReport);
router.post('/:id/resend', SEND_ROLES, resendDelivery);
router.get('/consent/:sampleId', SEND_ROLES, getConsent);
router.put('/consent/:patientId', SEND_ROLES, setConsent);

export default router;

// Mounted at /api/whatsapp — public, authenticated by Meta's HMAC signature.
export const whatsappWebhookRouter = express.Router();
whatsappWebhookRouter.get('/webhook', whatsappWebhookVerify);
whatsappWebhookRouter.post('/webhook', whatsappWebhookReceive);
