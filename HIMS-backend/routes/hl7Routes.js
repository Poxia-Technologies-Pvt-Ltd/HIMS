import express from 'express';
import { getPatientHL7, registerPatientHL7 } from '../controllers/hl7Controller.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';

const router = express.Router();

// HL7 Compatible Patient APIs — external HMIS-to-HMIS sync, gated by shared API key
router.get('/patient/search', requireApiKey, getPatientHL7);
router.post('/patient/register', requireApiKey, registerPatientHL7);

export default router;
