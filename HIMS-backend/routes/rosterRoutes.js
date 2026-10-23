import express from 'express';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { ROSTER_ROLES } from '../utils/hr.js';
import {
  listShifts, createShift, updateShift, deleteShift,
  listRoster, myRoster, createRoster, updateRosterEntry, cancelRosterEntry, copyWeek, onDutyNow,
} from '../controllers/rosterController.js';

const router = express.Router();
router.use(authenticateToken);
const PLANNERS = authorizeRole(ROSTER_ROLES);

router.get('/shifts', listShifts);
router.post('/shifts', PLANNERS, createShift);
router.put('/shifts/:id', PLANNERS, updateShift);
router.delete('/shifts/:id', PLANNERS, deleteShift);

router.get('/my', myRoster);
router.get('/on-duty', onDutyNow);
router.get('/', listRoster);
router.post('/', PLANNERS, createRoster);
router.post('/copy-week', PLANNERS, copyWeek);
router.put('/:id', PLANNERS, updateRosterEntry);
router.delete('/:id', PLANNERS, cancelRosterEntry);

export default router;
