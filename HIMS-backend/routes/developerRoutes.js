import express from 'express';
import {
  sendOTP, verifyOTP, devAuth, devLogout,
  getStats,
  getHospitals, createHospital, updateHospital, deleteHospital, createDistrict,
  getLabs, createLab, updateLab, deleteLab,
  getUsers, createUser, updateUser, toggleUserStatus, resetPassword,
  getBrands
} from '../controllers/developerController.js';
import { otpLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Public — OTP auth
router.post('/send-otp',    otpLimiter, sendOTP);
router.post('/verify-otp',  otpLimiter, verifyOTP);
router.post('/logout',      devLogout);

// Protected — all routes below require developer JWT
router.use(devAuth);

router.get('/stats',                    getStats);

router.get('/hospitals',                getHospitals);
router.post('/hospitals',               createHospital);
router.put('/hospitals/:id',            updateHospital);
router.delete('/hospitals/:id',         deleteHospital);
router.post('/districts',               createDistrict);

router.get('/labs',                     getLabs);
router.post('/labs',                    createLab);
router.put('/labs/:id',                 updateLab);
router.delete('/labs/:id',              deleteLab);

router.get('/brands',                   getBrands);

router.get('/users',                    getUsers);
router.post('/users',                   createUser);
router.put('/users/:id',                updateUser);
router.patch('/users/:id/toggle',       toggleUserStatus);
router.patch('/users/:id/reset-password', resetPassword);

export default router;
