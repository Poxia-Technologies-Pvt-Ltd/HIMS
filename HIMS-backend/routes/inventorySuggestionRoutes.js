import express from 'express';
import {
  getPurchaseSuggestions,
  generatePurchaseSuggestions,
  updateSuggestionStatus
} from '../controllers/inventorySuggestionController.js';

import { authenticateToken, authorizeRole } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticateToken);

const LAB_MANAGE_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);

router.get('/', getPurchaseSuggestions);
router.post('/generate', LAB_MANAGE_ROLES, generatePurchaseSuggestions);
router.put('/:id', LAB_MANAGE_ROLES, updateSuggestionStatus);

export default router;
