import express from 'express';
import * as c from '../controllers/clinicianController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { portalOtpLimiter } from '../middleware/rateLimiter.js';

// Clinician portal (tender #41). The portal router is mounted at /api/clinician-portal and is
// reached by referring clinicians with a one-time code; the admin router is mounted at
// /api/clinicians and keeps the register of who may sign in.
const portal = express.Router();
portal.post('/otp/request', portalOtpLimiter, c.requestOtp);
portal.post('/otp/verify', portalOtpLimiter, c.verifyOtp);
portal.use(c.authenticateClinician);
portal.get('/me', c.me);
portal.get('/reports', c.reports);
portal.get('/reports/:sampleId/pdf', c.reportPdf);

export const clinicianAdminRouter = express.Router();
clinicianAdminRouter.use(authenticateToken);
clinicianAdminRouter.use(authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Receptionist']));
clinicianAdminRouter.get('/', c.listClinicians);
clinicianAdminRouter.post('/', c.createClinician);
clinicianAdminRouter.put('/:id', c.updateClinician);

export default portal;
