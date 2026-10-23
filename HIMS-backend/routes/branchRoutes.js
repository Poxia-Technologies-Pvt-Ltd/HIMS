import express from 'express';
import { getBranches } from '../controllers/branchController.js';

// Single hospital: the one facility record is read here and edited through
// Settings (hospital profile). Facilities and districts are never created.
const router = express.Router();

router.get('/', getBranches);

export default router;
