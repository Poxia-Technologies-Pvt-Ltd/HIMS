import express from 'express';
import {
  getInfraList, addInfra, updateInfra, deleteInfra, roomBoard, listBeds, addBeds, updateBed, setBedStatus, deleteBed,
} from '../controllers/infraController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

const ADMIN_ONLY = authorizeRole(['Admin', 'Super Admin']);
// Ward staff turn beds over (cleaning, occupied, free) through the day.
const BED_STATUS_ROLES = authorizeRole(['Admin', 'Super Admin', 'Nurse', 'Receptionist', 'Nursing Superintendent', 'Medical Superintendent']);

router.get('/', getInfraList);
router.get('/board', roomBoard);
router.post('/add', ADMIN_ONLY, addInfra);
router.put('/update/:id', ADMIN_ONLY, updateInfra);
router.delete('/delete/:id', ADMIN_ONLY, deleteInfra);

router.get('/:roomId/beds', listBeds);
router.post('/:roomId/beds', ADMIN_ONLY, addBeds);
router.put('/beds/:id', ADMIN_ONLY, updateBed);
router.patch('/beds/:id/status', BED_STATUS_ROLES, setBedStatus);
router.delete('/beds/:id', ADMIN_ONLY, deleteBed);

export default router;
