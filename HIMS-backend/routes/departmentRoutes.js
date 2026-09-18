import express from 'express';
import departmentController from '../controllers/departmentController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

const ADMIN_ONLY = authorizeRole(['Admin', 'Super Admin']);

// Get all departments (with optional filters)
router.get('/', departmentController.getAllDepartments);

// Get single department by ID
router.get('/:id', departmentController.getDepartmentById);

// Create new department
router.post('/', ADMIN_ONLY, departmentController.createDepartment);

// Update department
router.put('/:id', ADMIN_ONLY, departmentController.updateDepartment);

// Delete department
router.delete('/:id', ADMIN_ONLY, departmentController.deleteDepartment);

export default router;
