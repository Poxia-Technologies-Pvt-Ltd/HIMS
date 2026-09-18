import express from 'express';
import { requireCareBearer } from '../middleware/careAuth.js';
import { careInboundLimiter } from '../middleware/rateLimiter.js';
import { receiveOrder, getOpenIdConfiguration, getHealthStatus } from '../controllers/careController.js';

const router = express.Router();

// Public (no auth) — CARE and anyone verifying us must reach these without a token.
router.get('/openid-configuration', getOpenIdConfiguration);
router.get('/health/status', careInboundLimiter, getHealthStatus);

// Care_Bearer JWT verified against CARE's own JWKS, not a static API key.
router.post('/send-order', careInboundLimiter, requireCareBearer, receiveOrder);

export default router;
