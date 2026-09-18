import express from 'express';
import { register, login, logout, getCaptcha, changePassword, forgotPassword, resetPasswordWithToken } from '../controllers/authController.js';

import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { loginLimiter, captchaLimiter, forgotPasswordLimiter, resetPasswordLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.get('/captcha', captchaLimiter, getCaptcha);
router.post('/register', authenticateToken, authorizeRole(['Admin', 'Lab Head', 'Doctor']), register);
router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.post('/change-password', authenticateToken, changePassword);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', resetPasswordLimiter, resetPasswordWithToken);

export default router;
