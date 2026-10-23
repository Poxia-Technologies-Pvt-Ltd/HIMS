import express from 'express';
import {
  registerPatient,
  searchPatients,
  searchConsultants,
  loginByPhone,
  requestPortalOtp,
  verifyPortalOtp,
  getPatientProfile,
  getPatientReports,
  downloadPatientReport,
  downloadPatientReportPDF,
  getPatientChart,
  getPatientByPhone,
  checkDuplicate,
  mergePatients,
} from '../controllers/patientController.js';
import {
  getFieldConfig,
  upsertFieldConfig,
  deleteCustomField,
} from '../controllers/patientFieldConfigController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { patientLoginLimiter, portalOtpLimiter } from '../middleware/rateLimiter.js';
import { authenticatePatientPortal } from '../middleware/patientPortalAuth.js';

const router = express.Router();

const STAFF_ROLES = ['Admin', 'Doctor', 'Lab Head', 'Lab Technician', 'Staff', 'Receptionist', 'Phlebotomist', 'Super Admin', 'Accounts Manager'];

const DOCTOR_ROLES = ['Doctor', 'Admin', 'Super Admin'];

// Staff/Admin routes
router.post('/register', authenticateToken, authorizeRole(STAFF_ROLES), registerPatient);
router.get('/search', authenticateToken, authorizeRole(STAFF_ROLES), searchPatients);
router.get('/consultants', authenticateToken, authorizeRole(STAFF_ROLES), searchConsultants);
router.get('/phone-lookup/:phone', authenticateToken, authorizeRole(STAFF_ROLES), getPatientByPhone);
router.get('/check-duplicate', authenticateToken, authorizeRole(STAFF_ROLES), checkDuplicate);
router.post('/merge', authenticateToken, authorizeRole(['Admin', 'Super Admin']), mergePatients);

// Patient Field Config (Settings > Patient Field Config) — read available to
// any staff role so the registration form can render itself; writes are
// Admin-only, same tier as Machine Master / Device Keys.
router.get('/field-config', authenticateToken, authorizeRole(STAFF_ROLES), getFieldConfig);
router.post('/field-config', authenticateToken, authorizeRole(['Admin', 'Super Admin']), upsertFieldConfig);
router.delete('/field-config/:field_key', authenticateToken, authorizeRole(['Admin', 'Super Admin']), deleteCustomField);

// Doctor patient chart — fetch full demographics by reg_no
router.get('/:regNo/chart', authenticateToken, authorizeRole(DOCTOR_ROLES), getPatientChart);

// Patient Portal routes
router.post('/portal/login', patientLoginLimiter, loginByPhone);
router.post('/portal/otp/request', portalOtpLimiter, requestPortalOtp);
router.post('/portal/otp/verify', portalOtpLimiter, verifyPortalOtp);
router.get('/portal/profile/:phone', authenticatePatientPortal, getPatientProfile);
router.get('/portal/reports/:phone', authenticatePatientPortal, getPatientReports);
router.get('/portal/reports/:phone/:sampleId', authenticatePatientPortal, downloadPatientReport);
router.get('/portal/reports/:phone/:sampleId/pdf', authenticatePatientPortal, downloadPatientReportPDF);

export default router;
