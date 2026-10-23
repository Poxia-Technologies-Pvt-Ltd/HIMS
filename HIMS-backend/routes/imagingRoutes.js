import express from 'express';
import { listOrders, updateOrder } from '../controllers/imagingController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
const IMAGING_ROLES = ['Radiographer', 'Doctor', 'Admin', 'Super Admin', 'Medical Superintendent', 'Receptionist', 'Accounts Manager'];
const PERFORM_ROLES = ['Radiographer', 'Doctor', 'Admin', 'Super Admin'];

router.get('/orders', authenticateToken, authorizeRole(IMAGING_ROLES), listOrders);
router.patch('/orders/:id', authenticateToken, authorizeRole(PERFORM_ROLES), updateOrder);

export default router;
