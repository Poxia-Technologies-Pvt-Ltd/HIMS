import express from 'express';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import {
  getSpecialties, createSpecialty, updateSpecialty, deleteSpecialty,
  getWorkingHours, upsertWorkingHours, deleteWorkingHours,
  getHolidays, createHoliday, updateHoliday, deleteHoliday,
} from '../controllers/orgController.js';

// Hospital setup: specialties, working hours and holidays. Beds are managed
// per room under /api/infra.
const router = express.Router();
router.use(authenticateToken);

const ADMIN_ONLY = authorizeRole(['Admin', 'Super Admin']);

// ── Specialties ───────────────────────────────────────────────────────────────
router.get   ('/specialties',       getSpecialties); // ?branch_id=X
router.post  ('/specialties',       ADMIN_ONLY, createSpecialty);
router.put   ('/specialties/:id',   ADMIN_ONLY, updateSpecialty);
router.delete('/specialties/:id',   ADMIN_ONLY, deleteSpecialty);

// ── Working Hours ─────────────────────────────────────────────────────────────
router.get   ('/working-hours',     getWorkingHours); // ?branch_id=X
router.post  ('/working-hours',     ADMIN_ONLY, upsertWorkingHours);
router.delete('/working-hours/:id', ADMIN_ONLY, deleteWorkingHours);

// ── Holidays ──────────────────────────────────────────────────────────────────
router.get   ('/holidays',          getHolidays);    // ?branch_id=X&upcoming=1
router.post  ('/holidays',          ADMIN_ONLY, createHoliday);
router.put   ('/holidays/:id',      ADMIN_ONLY, updateHoliday);
router.delete('/holidays/:id',      ADMIN_ONLY, deleteHoliday);

export default router;
