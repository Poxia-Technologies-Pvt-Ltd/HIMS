import express from 'express';
import jwt from 'jsonwebtoken';
import {
  registerPatient,
  searchPatients,
  searchConsultants,
  loginByPhone,
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
import { patientLoginLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Verifies patient JWT and ensures the token owner matches the requested :phone param
const authenticatePatientPortal = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.type !== 'patient') {
      return res.status(403).json({ message: 'Access denied. Invalid token type.' });
    }
    if (decoded.phone !== req.params.phone) {
      return res.status(403).json({ message: 'Access denied.' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

const STAFF_ROLES = ['Admin', 'Doctor', 'Lab Head', 'Lab Technician', 'Staff', 'Receptionist', 'Phlebotomist', 'Super Admin'];

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
router.get('/portal/profile/:phone', authenticatePatientPortal, getPatientProfile);
router.get('/portal/reports/:phone', authenticatePatientPortal, getPatientReports);
router.get('/portal/reports/:phone/:sampleId', authenticatePatientPortal, downloadPatientReport);
router.get('/portal/reports/:phone/:sampleId/pdf', authenticatePatientPortal, downloadPatientReportPDF);

export default router;
