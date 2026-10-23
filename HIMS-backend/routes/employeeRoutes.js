import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { HR_ADMIN_ROLES } from '../utils/hr.js';
import {
  EMPLOYEE_DOC_DIR, listEmployees, lookupEmployees, employeeStats, myEmployeeProfile, getEmployee,
  createEmployee, updateEmployee, setEmployeeStatus, createEmployeeLogin, deleteEmployee,
  uploadEmployeeDocument, downloadEmployeeDocument, deleteEmployeeDocument,
} from '../controllers/employeeController.js';

fs.mkdirSync(EMPLOYEE_DOC_DIR, { recursive: true });

const ALLOWED_DOC_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

// Stored under a random name: the original name is kept in the DB only, so a
// crafted filename never reaches the filesystem.
const upload = multer({
  storage: multer.diskStorage({
    destination: EMPLOYEE_DOC_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_DOC_TYPES.has(file.mimetype)) return cb(new Error('Only image uploads or PDF documents are allowed'));
    cb(null, true);
  },
});

const router = express.Router();
router.use(authenticateToken);
const HR_ONLY = authorizeRole(HR_ADMIN_ROLES);

router.get('/', HR_ONLY, listEmployees);
router.get('/lookup', lookupEmployees);
router.get('/stats', HR_ONLY, employeeStats);
router.get('/me', myEmployeeProfile);
router.get('/documents/:docId/download', downloadEmployeeDocument);
router.delete('/documents/:docId', deleteEmployeeDocument);
router.get('/:id', getEmployee);
router.post('/', HR_ONLY, createEmployee);
router.put('/:id', HR_ONLY, updateEmployee);
router.patch('/:id/status', HR_ONLY, setEmployeeStatus);
router.post('/:id/login', HR_ONLY, createEmployeeLogin);
router.delete('/:id', HR_ONLY, deleteEmployee);
router.post('/:id/documents', upload.single('file'), uploadEmployeeDocument);

export default router;
