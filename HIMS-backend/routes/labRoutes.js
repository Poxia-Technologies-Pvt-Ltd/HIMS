import { getReagentOverview, getReagentAlerts, getReagentHistory, recordReagentChange, getReagentStock } from '../controllers/reagentController.js';
import { getMaintenanceOverview, getMaintenanceAlerts, getMaintenanceHistory, createSchedule, applyStandardSchedule, updateSchedule, completeTask } from '../controllers/equipmentMaintenanceController.js';
import { listCriticalAlerts, recordCriticalNotification } from '../controllers/criticalAlertController.js';
import { getResultHistory, cancelReport, reissueReport } from '../controllers/resultHistoryController.js';
import { getMySignature, saveMySignature, verifyReportPublic } from '../controllers/reportAuthController.js';
import { signalWorklistOnWrite } from '../utils/worklistSignal.js';
import { listRejectionReasons, rejectSample, listRejections } from '../controllers/sampleRejectionController.js';
import { getPublicTokenBoard } from '../controllers/queueController.js';
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
  getWorklistVersion,
  getResultFlagSettings,
  getVerificationWorkflows,
  saveVerificationWorkflow,
  updateResultFlagSettings,
  getWorklistById,
  generateSampleId,
  acknowledgeTest,
  updateTestStatus,
  saveTestResults,
  getManualEntryReasons,
  getManualEntryForm,
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
import { lookupSample, scanSample, listSamples, listSampleEvents, makeAliquots, getCustodyReport } from '../controllers/sampleController.js';
import { getReportSigningStatus, testReportSigning } from '../controllers/reportSigningController.js';
import { listDscUsers, uploadDsc, revokeDsc, saveDscSettings, myDsc } from '../controllers/dscController.js';
import { createJob, getJob, cancelJob, jobTokenAuth, agentSession, agentPrepare, agentComplete, agentFail } from '../controllers/dscAgentController.js';
import { listCollectionOrders, getCollectionOrder, collectOrder, logReprint, collectionSnapshot } from '../controllers/sampleCollectionController.js';
import { publicLookupLimiter, otpLimiter, tokenBoardLimiter, kioskTokenLimiter, kioskPayStatusLimiter, dscAgentLimiter } from '../middleware/rateLimiter.js';
import { issueKioskToken } from '../controllers/kioskTokenController.js';
import {
  kioskPaymentOrder, kioskPaymentVerify, kioskPaymentQr, kioskPaymentLink, kioskPaymentStatus, kioskPaymentCancel, kioskIdentify, kioskTests,
} from '../controllers/kioskPaymentController.js';

const router = express.Router();

// ── Public lobby-kiosk routes — deliberately registered BEFORE
// router.use(authenticateToken) below, so they're reachable with no login.
// Each returns only patient-self-service-safe data (see the controllers for
// exactly what's excluded) — never the full staff-facing worklist/report detail.
router.get('/kiosk-queue', publicLookupLimiter, getKioskQueue);
router.get('/kiosk-tokens', tokenBoardLimiter, getPublicTokenBoard);
// Patient takes a queue token at the kiosk: their order's Sample Collection
// token, or a Registration token when they have no order yet.
router.post('/kiosk-token', kioskTokenLimiter, issueKioskToken);
// Paying today's order at the kiosk (Razorpay). Verify is signature-checked.
router.post('/kiosk-payment/order', kioskTokenLimiter, kioskPaymentOrder);
// On-screen UPI QR, or a payment link to the registered mobile; the kiosk polls the status.
router.post('/kiosk-payment/identify', kioskTokenLimiter, kioskIdentify);
router.get('/kiosk-payment/tests', kioskTokenLimiter, kioskTests);
router.post('/kiosk-payment/qr', kioskTokenLimiter, kioskPaymentQr);
router.post('/kiosk-payment/link', kioskTokenLimiter, kioskPaymentLink);
router.get('/kiosk-payment/status/:txnId', kioskPayStatusLimiter, kioskPaymentStatus);
router.post('/kiosk-payment/cancel', kioskTokenLimiter, kioskPaymentCancel);
router.post('/kiosk-payment/verify', kioskTokenLimiter, kioskPaymentVerify);
router.get('/kiosk-reports', publicLookupLimiter, getKioskReports);
router.get('/kiosk-stats', publicLookupLimiter, getKioskStats);
// Scanning the QR printed on a report opens the PDF. Public by necessity — a
// phone camera carries no session — but the signed link is what protects it.
router.get('/report/:sampleId', publicLookupLimiter, getReportByQr);
router.get('/report-verify/:id', publicLookupLimiter, verifyReportPublic);
router.post('/whatsapp-send-report', otpLimiter, sendKioskReportWhatsApp);
router.post('/kiosk-print-report', publicLookupLimiter, printKioskReport);
// The same report as data, laid out on screen instead of as a PDF.
router.post('/kiosk-view-report', publicLookupLimiter, viewKioskReport);
// Tapping a row on the lobby board: goes to the registered number only.
router.post('/kiosk-send-ready', otpLimiter, sendReadyReportToPatient);

// Poxia DSC Agent (a doctor's USB-token signer): authenticated by the one-time job
// token of one signing request, not by a login — so registered BEFORE router.use(authenticateToken).
router.get('/dsc-agent/jobs/:id/session', dscAgentLimiter, jobTokenAuth, agentSession);
router.post('/dsc-agent/jobs/:id/prepare', dscAgentLimiter, jobTokenAuth, agentPrepare);
router.post('/dsc-agent/jobs/:id/complete', dscAgentLimiter, jobTokenAuth, agentComplete);
router.post('/dsc-agent/jobs/:id/fail', dscAgentLimiter, jobTokenAuth, agentFail);

router.use(authenticateToken);
router.use(signalWorklistOnWrite);

// The doctor's browser starts, watches and can cancel a USB-token signing.
router.post('/dsc-agent/jobs', createJob);
router.get('/dsc-agent/jobs/:id', getJob);
router.post('/dsc-agent/jobs/:id/cancel', cancelJob);

// Lab configuration, the test menu, and verification are restricted to the
// roles that own those decisions — Lab Technicians run the routine
// worklist/results flow below, unrestricted, but don't define the test menu
// or sign off on results (maker/checker separation for verify-test/rerun).
const LAB_MANAGE_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);

// Barcode sample tracking — everyone who physically handles a sample.
const SAMPLE_HANDLER_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician', 'Lab Doctor', 'Phlebotomist', 'Sample Collector']);
const REJECTOR_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician', 'Lab Doctor']);
router.get('/samples/lookup', SAMPLE_HANDLER_ROLES, lookupSample);
router.post('/samples/scan', SAMPLE_HANDLER_ROLES, scanSample);
router.get('/samples/events', SAMPLE_HANDLER_ROLES, listSampleEvents);
router.get('/samples/custody', SAMPLE_HANDLER_ROLES, getCustodyReport);
router.post('/samples/:sample_id/aliquots', SAMPLE_HANDLER_ROLES, makeAliquots);
router.get('/samples', SAMPLE_HANDLER_ROLES, listSamples);
router.get('/rejection-reasons', SAMPLE_HANDLER_ROLES, listRejectionReasons);
router.post('/samples/reject', REJECTOR_ROLES, rejectSample);
router.get('/rejections', SAMPLE_HANDLER_ROLES, listRejections);

// Sample collection desk — the Sample Collector role's whole workspace. Lab
// Head / Admin are included as supervisors.
const collectorRoleCheck = authorizeRole(['Sample Collector', 'Phlebotomist', 'Lab Head', 'Admin', 'Super Admin']);
// A registered LIS-Agent machine works the collection desk too, including the
// offline queue it syncs later (tender #59).
const COLLECTOR_ROLES = (req, res, next) => (req.user?.isDeviceKey ? next() : collectorRoleCheck(req, res, next));
router.get('/collection/snapshot', COLLECTOR_ROLES, collectionSnapshot);
router.get('/collection/orders', COLLECTOR_ROLES, listCollectionOrders);
router.get('/collection/orders/:bill_id', COLLECTOR_ROLES, getCollectionOrder);
router.post('/collection/orders/:bill_id/collect', COLLECTOR_ROLES, collectOrder);
router.post('/collection/reprint', COLLECTOR_ROLES, logReprint);

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
router.get('/worklist/version', getWorklistVersion);
router.get('/result-flag-settings', getResultFlagSettings);
router.put('/result-flag-settings', authorizeRole(['Admin', 'Super Admin', 'Lab Head']), updateResultFlagSettings);
router.get('/worklist-by-id/:id', getWorklistById);
router.post('/unsolicited-worklist', createUnsolicitedWorklist);
router.post('/map-unmapped-test', mapUnmappedTest);

// Analyzer results that arrived without a matching order. The technician
// finds the patient, picks which of their ordered tests the result belongs
// to, and only then does it reach the doctor's verification queue.
// One tube of serum can run several tests, so the technician may merge a
// patient's open tests onto one sample ID and short code.
router.get('/mergeable', COLLECTOR_ROLES, getMergeableTests);
router.post('/merge-samples', COLLECTOR_ROLES, mergeSamples);
router.post('/unmerge-sample', COLLECTOR_ROLES, unmergeSample);

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
// Digital Signature Certificate used to sign authorised report PDFs (admin only).
// Doctors' own certificates, managed by each hospital's admin; `mine` is for the doctor's sign dialog.
router.get('/dsc/mine', myDsc);
router.get('/dsc/users', authorizeRole(['Admin', 'Super Admin']), listDscUsers);
router.post('/dsc/upload', authorizeRole(['Admin', 'Super Admin']), uploadDsc);
router.post('/dsc/:id/revoke', authorizeRole(['Admin', 'Super Admin']), revokeDsc);
router.put('/dsc/settings', authorizeRole(['Admin', 'Super Admin']), saveDscSettings);
router.get('/report-signing/status', authorizeRole(['Admin', 'Super Admin']), getReportSigningStatus);
router.post('/report-signing/test', authorizeRole(['Admin', 'Super Admin']), testReportSigning);
// Typing a result in by hand: the reasons offered, and the entry form for one test.
router.get('/manual-entry/reasons', getManualEntryReasons);
router.get('/manual-entry/form/:billItemId', getManualEntryForm);
router.get('/test-results/:sampleId', getTestResultsBySampleId);

// Lab Head Doctor Verification Routes — viewing the queue is fine for any
// staff, but the actual sign-off/rerun decision is Lab Head/Admin only, so a
// Lab Technician can't verify their own result.
router.get('/pending-verifications', getPendingVerifications);
// The discipline's workflow (lab_verification_workflows) decides who may take each step.
router.post('/verify-test', authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician']), verifyTest);
router.get('/verification-workflows', getVerificationWorkflows);
const EQUIP_VIEW = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician']);
router.get('/maintenance/overview', EQUIP_VIEW, getMaintenanceOverview);
router.get('/reagents/overview', EQUIP_VIEW, getReagentOverview);
router.get('/reagents/alerts', EQUIP_VIEW, getReagentAlerts);
router.get('/reagents/history/:machineId', EQUIP_VIEW, getReagentHistory);
router.get('/reagents/stock', EQUIP_VIEW, getReagentStock);
router.post('/reagents/change', EQUIP_VIEW, recordReagentChange);
router.get('/maintenance/alerts', EQUIP_VIEW, getMaintenanceAlerts);
router.get('/maintenance/history/:machineId', EQUIP_VIEW, getMaintenanceHistory);
router.post('/maintenance/schedules', LAB_MANAGE_ROLES, createSchedule);
router.post('/maintenance/apply-standard', LAB_MANAGE_ROLES, applyStandardSchedule);
router.put('/maintenance/schedules/:id', LAB_MANAGE_ROLES, updateSchedule);
router.post('/maintenance/schedules/:id/complete', EQUIP_VIEW, completeTask);
const CRITICAL_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician']);
router.get('/critical-alerts', CRITICAL_ROLES, listCriticalAlerts);
router.post('/critical-alerts/:id/notify', CRITICAL_ROLES, recordCriticalNotification);
router.get('/results/:id/history', authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Technician']), getResultHistory);
router.post('/results/:id/cancel', LAB_MANAGE_ROLES, cancelReport);
router.post('/results/:id/reissue', LAB_MANAGE_ROLES, reissueReport);
const SIGNER_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);
router.get('/my-signature', SIGNER_ROLES, getMySignature);
router.put('/my-signature', SIGNER_ROLES, saveMySignature);
router.put('/verification-workflows/:category_id', LAB_MANAGE_ROLES, saveVerificationWorkflow);
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