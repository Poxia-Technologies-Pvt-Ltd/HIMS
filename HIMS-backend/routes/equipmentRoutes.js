import express from 'express';
import {
  listTickets,
  createTicket,
  updateTicket,
  listRegistry,
  updateRegistry,
  setInstallLocation,
  checkLocation,
  ticketSamples,
  linkTicketSample,
} from '../controllers/equipmentController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

// Mounted at /api/equipment.
const router = express.Router();
router.use(authenticateToken);

const VIEW = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician', 'Programme Officer', 'Auditor']);
const REPORT = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician']);
const MANAGE = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);

router.get('/tickets', VIEW, listTickets);
router.post('/tickets', REPORT, createTicket);
router.put('/tickets/:id', REPORT, updateTicket);
router.get('/tickets/:id/samples', VIEW, ticketSamples);
router.post('/tickets/:id/samples', REPORT, linkTicketSample);

router.get('/registry', VIEW, listRegistry);
router.put('/registry/:id', MANAGE, updateRegistry);

router.put('/machines/:id/install-location', MANAGE, setInstallLocation);
router.post('/machines/:id/location-check', REPORT, checkLocation);

export default router;
