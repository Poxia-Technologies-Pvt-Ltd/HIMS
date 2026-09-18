import express from 'express';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { createDeviceKey, listDeviceKeys, revokeDeviceKey, verifyDeviceKey } from '../controllers/deviceKeyController.js';

const router = express.Router();

// Admin-only: generating/listing/revoking device keys is equivalent to
// managing a lab tech's credentials, gated the same as parameter-codes
// (see labRoutes.js) — Admin role, nothing looser.
router.post('/', authenticateToken, authorizeRole(['Admin']), createDeviceKey);
router.get('/', authenticateToken, authorizeRole(['Admin']), listDeviceKeys);
router.delete('/:id', authenticateToken, authorizeRole(['Admin']), revokeDeviceKey);

// Unauthenticated on purpose — this is exactly what the LIS-Agent's
// activation screen calls to sanity-check a pasted key *before* the app has
// any credential of its own to authenticate the check itself with. It only
// ever confirms validity/label, never anything else.
router.post('/verify', verifyDeviceKey);

export default router;
