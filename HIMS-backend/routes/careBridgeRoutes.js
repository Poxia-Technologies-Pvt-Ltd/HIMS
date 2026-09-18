import express from 'express';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { careInboundLimiter } from '../middleware/rateLimiter.js';
import { importCareOrders, getResultsByRequestId, markCareSaved } from '../controllers/careBridgeController.js';

const router = express.Router();

// API-key auth rather than a session: the caller is a browser extension whose
// origin (chrome-extension://…) is not in ALLOWED_ORIGINS, so a cookie-based
// POST would be rejected by the Referer/Origin guard before reaching the
// route. An X-API-Key is the credential that guard already recognises for
// non-browser clients, and it also means no LIMS password lives in the
// extension.
router.post('/import', careInboundLimiter, requireApiKey, importCareOrders);

// The return leg: the extension reads the request id off CARE's result entry
// page and asks for our verified values to type in.
router.get('/results/:requestId', careInboundLimiter, requireApiKey, getResultsByRequestId);

// The technician confirms they pressed save on CARE's form. CARE forwards to
// ABHA from there, so this is the only evidence we can hold that a result
// reached the national record.
router.post('/mark-saved', careInboundLimiter, requireApiKey, markCareSaved);

export default router;
