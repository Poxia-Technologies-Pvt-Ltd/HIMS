import express from 'express';
import {
  getTodayAppointments,
  saveConsultation,
  getConsultationDetails,
  getPatientHistory,
  getPatientLabTrends,
  getPrescriptionTemplates,
  savePrescriptionTemplate,
  deletePrescriptionTemplate,
  getFollowUpDue,
  
  getPatientTimeline,
  sendSummarySMS,
} from '../controllers/consultationController.js';
import { medicineStock } from '../controllers/imagingController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
const DOCTOR_ROLES = ['Doctor', 'Admin', 'Super Admin'];

// Specific routes before wildcard
router.get('/today',                    authenticateToken, authorizeRole(DOCTOR_ROLES), getTodayAppointments);
router.get('/medicine-stock',           authenticateToken, authorizeRole([...DOCTOR_ROLES, 'Pharmacist', 'Nurse']), medicineStock);
router.get('/followup-due',             authenticateToken, authorizeRole(DOCTOR_ROLES), getFollowUpDue);
router.post('/',                        authenticateToken, authorizeRole(DOCTOR_ROLES), saveConsultation);
router.post('/send-summary-sms',        authenticateToken, authorizeRole(DOCTOR_ROLES), sendSummarySMS);
router.get('/patient/:regNo/history',   authenticateToken, authorizeRole(DOCTOR_ROLES), getPatientHistory);
router.get('/patient/:regNo/lab-trends',authenticateToken, authorizeRole(DOCTOR_ROLES), getPatientLabTrends);
router.get('/patient/:regNo/timeline',  authenticateToken, authorizeRole(DOCTOR_ROLES), getPatientTimeline);
router.get('/templates/:doctorId',      authenticateToken, authorizeRole(DOCTOR_ROLES), getPrescriptionTemplates);
router.post('/templates',               authenticateToken, authorizeRole(DOCTOR_ROLES), savePrescriptionTemplate);
router.delete('/templates/:id',         authenticateToken, authorizeRole(DOCTOR_ROLES), deletePrescriptionTemplate);

// Wildcard last
router.get('/:appointmentId',           authenticateToken, authorizeRole(DOCTOR_ROLES), getConsultationDetails);

export default router;
