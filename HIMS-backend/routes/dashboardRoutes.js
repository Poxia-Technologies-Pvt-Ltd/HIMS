import express from 'express';
import { getDashboardStats, getCentralDashboardStats, getSubCentralDashboardStats, getBranchDashboardStats } from '../controllers/dashboardController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/stats',       authenticateToken, getDashboardStats);
router.get('/central',     authenticateToken, getCentralDashboardStats);
router.get('/sub-central', authenticateToken, getSubCentralDashboardStats);
router.get('/branch',      authenticateToken, getBranchDashboardStats);

export default router;
