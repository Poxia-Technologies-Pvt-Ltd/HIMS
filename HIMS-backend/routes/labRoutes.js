import express from 'express';
import {
  getLabTests,
  getLabTestById,
  addLabTest,
  updateLabTest,
  deleteLabTest,
  getLabCategories,
  addLabCategory,
  updateLabCategory,
  deleteLabCategory,
  getSampleContainers,
  addSampleContainer,
  updateSampleContainer,
  deleteSampleContainer,
  getSampleTypes,
  addSampleType,
  updateSampleType,
  deleteSampleType,
  getLabs,
  getSuggestedLab,
  getWorklist,
  getWorklistById,
  generateSampleId,
  acknowledgeTest,
  updateTestStatus,
  saveTestResults,
  getTestResultsBySampleId,
  getPendingVerifications,
  verifyTest,
  requestRerun,
  getApprovedReports,
  getReportDetails,
  generateLabReportPDF,
  bookLabTests,
  trackTestStatus,
  getHospitalCode,
  getMachineProtocol,
  getActivityLogs,
  mapAnalyzerTests,
  createUnsolicitedWorklist,
  mapUnmappedTest,
  getKioskReports,
  getKioskQueue,
  getKioskStats,
  sendKioskReportWhatsApp,
  printKioskReport,
  viewKioskReport,
  getReportByQr,
  sendReadyReportToPatient,
  resendReportWhatsApp,
  getGeneralTests,
  getParameterCodeNames,
  upsertParameterCodeName
} from '../controllers/labController.js';
import {
  getLabMachines,
  getNetworkMachines,
  getMachineBySerial,
  addLabMachine,
  syncLabMachine,
  updateLabMachine,
  deleteLabMachine,
  logAnalyzerEvent,
  getAnalyzerLogs,
  getMachineStats,
} from '../controllers/labMachineController.js';
import { getMachineModels, upsertMachineModel } from '../controllers/machineModelController.js';
import { generateTestParameters } from '../controllers/aiController.js';
import {
  getUnmappedResults, getOpenTestsForPatient, attachResultToTest,
} from '../controllers/unmappedController.js';
import {
  getMergeableTests, mergeSamples, unmergeSample,
} from '../controllers/mergeSamplesController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { publicLookupLimiter, otpLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// ── Public lobby-kiosk routes — deliberately registered BEFORE
// router.use(authenticateToken) below, so they're reachable with no login.
// Each returns only patient-self-service-safe data (see the controllers for
// exactly what's excluded) — never the full staff-facing worklist/report detail.
router.get('/kiosk-queue', publicLookupLimiter, getKioskQueue);
router.get('/kiosk-reports', publicLookupLimiter, getKioskReports);
router.get('/kiosk-stats', publicLookupLimiter, getKioskStats);
// Scanning the QR printed on a report opens the PDF. Public by necessity — a
// phone camera carries no session — but the signed link is what protects it.
router.get('/report/:sampleId', publicLookupLimiter, getReportByQr);
router.post('/whatsapp-send-report', otpLimiter, sendKioskReportWhatsApp);
router.post('/kiosk-print-report', publicLookupLimiter, printKioskReport);
// The same report as data, laid out on screen instead of as a PDF.
router.post('/kiosk-view-report', publicLookupLimiter, viewKioskReport);
// Tapping a row on the lobby board: goes to the registered number only.
router.post('/kiosk-send-ready', otpLimiter, sendReadyReportToPatient);

router.use(authenticateToken);

// Lab configuration, the test menu, and verification are restricted to the
// roles that own those decisions — Lab Technicians run the routine
// worklist/results flow below, unrestricted, but don't define the test menu
// or sign off on results (maker/checker separation for verify-test/rerun).
const LAB_MANAGE_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);

// Lab Categories Routes
router.get('/categories', getLabCategories);
router.post('/categories', LAB_MANAGE_ROLES, addLabCategory);
router.put('/categories/:id', LAB_MANAGE_ROLES, updateLabCategory);
router.delete('/categories/:id', LAB_MANAGE_ROLES, deleteLabCategory);

// Sample Containers Routes
router.get('/containers', getSampleContainers);
router.post('/containers', LAB_MANAGE_ROLES, addSampleContainer);
router.put('/containers/:id', LAB_MANAGE_ROLES, updateSampleContainer);
router.delete('/containers/:id', LAB_MANAGE_ROLES, deleteSampleContainer);

// Sample Types Routes
router.get('/sample-types', getSampleTypes);
router.post('/sample-types', LAB_MANAGE_ROLES, addSampleType);
router.put('/sample-types/:id', LAB_MANAGE_ROLES, updateSampleType);
router.delete('/sample-types/:id', LAB_MANAGE_ROLES, deleteSampleType);

// Labs Routes (from infrastructure)
router.get('/labs', getLabs);
router.get('/suggested-lab', getSuggestedLab);

// Lab Tests Routes
router.get('/tests', getLabTests);
router.get('/tests/:id', getLabTestById);
router.post('/tests', LAB_MANAGE_ROLES, addLabTest);
router.put('/tests/:id', LAB_MANAGE_ROLES, updateLabTest);
router.delete('/tests/:id', LAB_MANAGE_ROLES, deleteLabTest);
router.post('/map-analyzer-tests', LAB_MANAGE_ROLES, mapAnalyzerTests);

// AI Parameter Generation Route — only useful while creating/editing a test
// definition above, so it carries the same restriction.
router.post('/generate-parameters', LAB_MANAGE_ROLES, generateTestParameters);

// Lab Worklist & Sample Collection Routes
router.get('/worklist', getWorklist);
router.get('/worklist-by-id/:id', getWorklistById);
router.post('/unsolicited-worklist', createUnsolicitedWorklist);
router.post('/map-unmapped-test', mapUnmappedTest);

// Analyzer results that arrived without a matching order. The technician
// finds the patient, picks which of their ordered tests the result belongs
// to, and only then does it reach the doctor's verification queue.
// One tube of serum can run several tests, so the technician may merge a
// patient's open tests onto one sample ID and short code.
router.get('/mergeable', getMergeableTests);
router.post('/merge-samples', mergeSamples);
router.post('/unmerge-sample', unmergeSample);

router.get('/unmapped-results', getUnmappedResults);
router.get('/open-tests', getOpenTestsForPatient);
router.post('/attach-result', attachResultToTest);
router.post('/generate-sample-id', generateSampleId);
router.post('/acknowledge-test', acknowledgeTest);
router.post('/update-test-status', updateTestStatus);

// Lab Test Booking Route
router.post('/book-tests', bookLabTests);

// Track Test Status Route
router.get('/track/:referenceNumber', publicLookupLimiter, trackTestStatus);

// Test Results Routes
router.post('/save-test-results', saveTestResults);
router.get('/test-results/:sampleId', getTestResultsBySampleId);

// Lab Head Doctor Verification Routes — viewing the queue is fine for any
// staff, but the actual sign-off/rerun decision is Lab Head/Admin only, so a
// Lab Technician can't verify their own result.
router.get('/pending-verifications', getPendingVerifications);
router.post('/verify-test', LAB_MANAGE_ROLES, verifyTest);
router.post('/request-rerun', LAB_MANAGE_ROLES, requestRerun);

// Report Download Routes
router.get('/approved-reports', getApprovedReports);
router.get('/report-details/:sampleId', getReportDetails);
router.get('/generate-report-pdf/:sampleId', generateLabReportPDF);
router.post('/resend-report-whatsapp/:sampleId', resendReportWhatsApp);
router.get('/activity-logs', getActivityLogs);

// Note: /whatsapp-send-report and /kiosk-reports are registered as public
// routes above, before the authenticateToken gate — kept there since they're
// used by the unauthenticated lobby kiosk (LabTVMode.jsx), not from here.

// Hospital Code for Machine ID
router.get('/hospital-code/:userId', getHospitalCode);

// Lab Machines Routes — /machines/sync is left open since it may be called
// by the LIS-Agent (see analyzer-event below) as a routine heartbeat/status
// sync, not a human config change; add/update/delete are real config edits.
router.get('/network-machines', getNetworkMachines);
router.get('/machines/:labId', getLabMachines);
router.get('/machine-by-serial/:serialNumber', getMachineBySerial);
router.post('/machines', LAB_MANAGE_ROLES, addLabMachine);
router.post('/machines/sync', syncLabMachine);
router.put('/machines/:id', LAB_MANAGE_ROLES, updateLabMachine);
router.delete('/machines/:id', LAB_MANAGE_ROLES, deleteLabMachine);

// Analyzer Connection Event Logging (called by LIS-Agent)
router.post('/analyzer-event', logAnalyzerEvent);
router.get('/analyzer-logs', getAnalyzerLogs);
router.get('/machine-stats', getMachineStats);

// Machine Protocol Route
router.get('/machine-protocol/:model', getMachineProtocol);

router.get('/tests-general', getGeneralTests);

// Parameter code -> display name, used by the PDF report generator.
// Admin-only: reviewable/editable so a code an analyzer sends that isn't
// covered yet can be added without a code change.
router.get('/parameter-codes', authorizeRole(['Admin']), getParameterCodeNames);
router.post('/parameter-codes', authorizeRole(['Admin']), upsertParameterCodeName);
router.get('/machine-models', authorizeRole(['Admin']), getMachineModels);
router.post('/machine-models', authorizeRole(['Admin']), upsertMachineModel);

export default router;