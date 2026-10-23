import express from 'express';
import { login, logout, getCaptcha, authConfig, quickSession, changePassword, forgotPassword, resetPasswordWithToken } from '../controllers/authController.js';

import { authenticateToken } from '../middleware/auth.js';
import { loginLimiter, captchaLimiter, forgotPasswordLimiter, resetPasswordLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.get('/captcha', captchaLimiter, getCaptcha);
router.get('/config', authConfig);
router.post('/login', loginLimiter, login);
router.post('/quick-session', captchaLimiter, quickSession);
router.post('/logout', logout);
router.post('/change-password', authenticateToken, changePassword);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', resetPasswordLimiter, resetPasswordWithToken);

export default router;
