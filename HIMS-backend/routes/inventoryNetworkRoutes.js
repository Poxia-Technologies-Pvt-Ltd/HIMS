import express from 'express';
import {
  getCentralInventoryStats,
  getSubCentralInventoryStats,
  getBranchInventoryStats,
  getOverallStock,
} from '../controllers/inventoryNetworkController.js';

import { authenticateToken } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticateToken);

router.get('/central',     getCentralInventoryStats);
router.get('/sub-central', getSubCentralInventoryStats);
router.get('/branch',      getBranchInventoryStats);
router.get('/overall',     getOverallStock);

export default router;
