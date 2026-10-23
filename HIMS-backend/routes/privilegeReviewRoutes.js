import express from 'express';
import { getReview, completeReview, reviewHistory, exportReview } from '../controllers/privilegeReviewController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

// Periodic privilege review (tender #107). Auditors may read; only an admin signs a review off.
const router = express.Router();
router.use(authenticateToken);
router.get('/', authorizeRole(['Admin', 'Super Admin', 'Auditor']), getReview);
router.get('/history', authorizeRole(['Admin', 'Super Admin', 'Auditor']), reviewHistory);
router.get('/export', authorizeRole(['Admin', 'Super Admin', 'Auditor']), exportReview);
router.post('/complete', authorizeRole(['Admin', 'Super Admin']), completeReview);

export default router;
