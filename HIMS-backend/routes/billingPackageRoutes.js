import express from 'express';
import billingPackageController from '../controllers/billingPackageController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

const ADMIN_ONLY = authorizeRole(['Admin', 'Super Admin']);

// Get all packages (with optional filters)
router.get('/', billingPackageController.getAllPackages);

// Get packages by department
router.get('/department/:department', billingPackageController.getPackagesByDepartment);

// Get single package by ID
router.get('/:id', billingPackageController.getPackageById);

// Create new package
router.post('/', ADMIN_ONLY, billingPackageController.createPackage);

// Update package
router.put('/:id', ADMIN_ONLY, billingPackageController.updatePackage);

// Delete package
router.delete('/:id', ADMIN_ONLY, billingPackageController.deletePackage);

export default router;
