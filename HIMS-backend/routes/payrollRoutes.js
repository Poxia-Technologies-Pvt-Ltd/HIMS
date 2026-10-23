import express from 'express';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { HR_ADMIN_ROLES } from '../utils/hr.js';
import {
  salaryOverview, salaryHistory, saveSalaryStructure, listRuns, createOrRebuildRun, getRun, editPayslip,
  finalizeRun, reopenRun, markRunPaid, deleteRun, bankFile, myPayslips, payslipPdf,
} from '../controllers/payrollController.js';

const router = express.Router();
router.use(authenticateToken);
const HR_ONLY = authorizeRole(HR_ADMIN_ROLES);

router.get('/my/payslips', myPayslips);
router.get('/payslips/:id/pdf', payslipPdf); // employee's own or HR; controller checks

router.get('/salary', HR_ONLY, salaryOverview);
router.get('/salary/:employeeId', HR_ONLY, salaryHistory);
router.post('/salary', HR_ONLY, saveSalaryStructure);

router.get('/runs', HR_ONLY, listRuns);
router.post('/runs', HR_ONLY, createOrRebuildRun);
router.get('/runs/:id', HR_ONLY, getRun);
router.post('/runs/:id/finalize', HR_ONLY, finalizeRun);
router.post('/runs/:id/reopen', HR_ONLY, reopenRun);
router.post('/runs/:id/paid', HR_ONLY, markRunPaid);
router.delete('/runs/:id', HR_ONLY, deleteRun);
router.get('/runs/:id/bank-file', HR_ONLY, bankFile);
router.put('/payslips/:id', HR_ONLY, editPayslip);

export default router;
