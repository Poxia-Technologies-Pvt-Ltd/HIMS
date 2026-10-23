import express from 'express';
import * as c from '../controllers/bloodBankController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

// Mounted at /api/blood-bank (tender #123). Facility scoping is applied inside the handlers.
const router = express.Router();
router.use(authenticateToken);

const STAFF = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Doctor', 'Lab Technician']);
const VIEW = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Doctor', 'Lab Technician', 'Auditor', 'Programme Officer', 'Doctor']);

router.get('/summary', VIEW, c.summary);
router.get('/donors', STAFF, c.listDonors);
router.post('/donors', STAFF, c.createDonor);
router.post('/donors/:id/defer', STAFF, c.deferDonor);
router.post('/donations', STAFF, c.recordDonation);
router.get('/units', VIEW, c.listUnits);
router.post('/units/:id/screening', STAFF, c.recordScreening);
router.post('/units/:id/process', STAFF, c.processUnit);
router.post('/units/:id/discard', STAFF, c.discardUnit);
router.get('/requests', VIEW, c.listRequests);
router.post('/requests', authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Doctor', 'Lab Technician', 'Doctor']), c.createRequest);
router.post('/requests/:id/cancel', STAFF, c.cancelRequest);
router.get('/requests/:id/units', STAFF, c.suitableUnits);
router.post('/requests/:id/issue', STAFF, c.issueUnit);
router.get('/issues', VIEW, c.listIssues);
router.post('/issues/:id/outcome', STAFF, c.setOutcome);
router.get('/reactions', VIEW, c.listReactions);
router.post('/reactions', STAFF, c.reportReaction);

export default router;
