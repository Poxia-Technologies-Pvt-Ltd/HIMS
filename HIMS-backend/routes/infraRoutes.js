import express from 'express';
import { getInfraList, addInfra, updateInfra, deleteInfra } from '../controllers/infraController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

const ADMIN_ONLY = authorizeRole(['Admin', 'Super Admin']);

router.get('/', getInfraList);
router.post('/add', ADMIN_ONLY, addInfra);
router.put('/update/:id', ADMIN_ONLY, updateInfra);
router.delete('/delete/:id', ADMIN_ONLY, deleteInfra);

export default router;
