import express from 'express';
import {
  getAppointments, listSessions, bookAppointment, rescheduleAppointment, cancelAppointment, checkInAppointment,
  startConsultation, completeAppointment, markNoShow, doctorQueue,
  portalListPatients, portalOptions, portalSessions, portalAppointments, portalBook, portalCancel,
} from '../controllers/appointmentController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { authenticatePatientPortal } from '../middleware/patientPortalAuth.js';
import { portalBookingLimiter } from '../middleware/rateLimiter.js';
import { FRONT_DESK_ROLES } from '../utils/hr.js';

const router = express.Router();

// Patient portal (patient JWT, not a staff session) — mounted before the staff guard.
router.get('/portal/:phone/patients', authenticatePatientPortal, portalListPatients);
router.get('/portal/:phone/options', authenticatePatientPortal, portalOptions);
router.get('/portal/:phone/sessions', authenticatePatientPortal, portalSessions);
router.get('/portal/:phone/appointments', authenticatePatientPortal, portalAppointments);
router.post('/portal/:phone/book', portalBookingLimiter, authenticatePatientPortal, portalBook);
router.post('/portal/:phone/appointments/:id/cancel', portalBookingLimiter, authenticatePatientPortal, portalCancel);

router.use(authenticateToken);
const DESK = authorizeRole(FRONT_DESK_ROLES);
// Doctors move their own patients through the consultation; the desk can too.
const CLINIC = authorizeRole([...FRONT_DESK_ROLES, 'Doctor', 'Nurse']);

router.get('/', getAppointments);
router.get('/sessions', listSessions);
router.get('/queue', doctorQueue);
router.post('/book', DESK, bookAppointment);
router.post('/:id/reschedule', DESK, rescheduleAppointment);
router.post('/:id/cancel', DESK, cancelAppointment);
router.post('/:id/check-in', DESK, checkInAppointment);
router.post('/:id/no-show', DESK, markNoShow);
router.post('/:id/start', CLINIC, startConsultation);
router.post('/:id/complete', CLINIC, completeAppointment);

export default router;
