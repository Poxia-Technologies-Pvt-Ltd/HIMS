import express from 'express';
import { bookAppointment, getAppointments } from '../controllers/appointmentController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

router.post('/book', bookAppointment);
router.get('/', getAppointments);

export default router;
