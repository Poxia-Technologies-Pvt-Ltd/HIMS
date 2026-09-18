import express from 'express';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import {
  getStates, createState, updateState, deleteState,
  getBlocks, createBlock, updateBlock, deleteBlock,
  getSpecialties, createSpecialty, updateSpecialty, deleteSpecialty,
  getBeds, createBed, createBedsBulk, updateBed, updateBedStatus, deleteBed,
  getWorkingHours, upsertWorkingHours, deleteWorkingHours,
  getHolidays, createHoliday, updateHoliday, deleteHoliday,
} from '../controllers/orgController.js';

const router = express.Router();
router.use(authenticateToken);

const ADMIN_ONLY = authorizeRole(['Admin', 'Super Admin']);

// ── States ────────────────────────────────────────────────────────────────────
router.get   ('/states',            getStates);
router.post  ('/states',            ADMIN_ONLY, createState);
router.put   ('/states/:id',        ADMIN_ONLY, updateState);
router.delete('/states/:id',        ADMIN_ONLY, deleteState);

// ── Blocks ────────────────────────────────────────────────────────────────────
router.get   ('/blocks',            getBlocks);      // ?district_id=X
router.post  ('/blocks',            ADMIN_ONLY, createBlock);
router.put   ('/blocks/:id',        ADMIN_ONLY, updateBlock);
router.delete('/blocks/:id',        ADMIN_ONLY, deleteBlock);

// ── Specialties ───────────────────────────────────────────────────────────────
router.get   ('/specialties',       getSpecialties); // ?branch_id=X
router.post  ('/specialties',       ADMIN_ONLY, createSpecialty);
router.put   ('/specialties/:id',   ADMIN_ONLY, updateSpecialty);
router.delete('/specialties/:id',   ADMIN_ONLY, deleteSpecialty);

// ── Beds ──────────────────────────────────────────────────────────────────────
router.get   ('/beds',              getBeds);        // ?branch_id=X&ward_id=Y&status=Z
router.post  ('/beds',              ADMIN_ONLY, createBed);
router.post  ('/beds/bulk',         ADMIN_ONLY, createBedsBulk);
router.put   ('/beds/:id',          ADMIN_ONLY, updateBed);
router.patch ('/beds/:id/status',   ADMIN_ONLY, updateBedStatus);
router.delete('/beds/:id',          ADMIN_ONLY, deleteBed);

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
