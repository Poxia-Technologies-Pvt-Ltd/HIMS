import express from 'express';
import * as c from '../controllers/fhirController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { operationOutcome } from '../utils/fhirMapper.js';

// Mounted at /api/fhir. HL7 FHIR R4, read and search only. The capability statement is public so
// a client can discover what is offered; everything else needs a credential (staff session,
// Bearer token or an integration device key issued under LIS-Agent Keys).
const router = express.Router();

router.get('/metadata', c.metadata);

router.use(authenticateToken);
router.use(authorizeRole(['Admin', 'Super Admin', 'Lab Head', 'Lab Doctor', 'Lab Technician', 'Auditor', 'Programme Officer', 'Doctor']));

router.get('/Patient', c.patients);
router.get('/Patient/:id', c.patientRead);
router.get('/Patient/:id/:op', (req, res, next) => (req.params.op === '$everything' ? c.patientEverything(req, res, next)
  : res.status(404).type('application/fhir+json').send(JSON.stringify(operationOutcome('error', 'not-supported', `Operation ${req.params.op} is not supported.`)))));
router.get('/ServiceRequest', c.serviceRequests);
router.get('/ServiceRequest/:id', c.serviceRequestRead);
router.get('/Specimen', c.specimens);
router.get('/Specimen/:id', c.specimenRead);
router.get('/Observation', c.observations);
router.get('/Observation/:id', c.observationRead);
router.get('/DiagnosticReport', c.diagnosticReports);
router.get('/DiagnosticReport/:id', c.diagnosticReportRead);
router.get('/Organization', c.organizations);
router.get('/Organization/:id', c.organizationRead);

// Anything else (including writes) is not offered.
router.use((req, res) => res.status(req.method === 'GET' ? 404 : 405).type('application/fhir+json')
  .send(JSON.stringify(operationOutcome('error', 'not-supported', req.method === 'GET' ? 'Unknown resource type.' : 'This FHIR API is read-only.'))));

export default router;
