const express = require('express');
const router = express.Router();
const { 
    register, 
    verifyOTP, // Added for mobile verification
    login, 
    forgotPassword, 
    resetPassword, 
    getMe, 
    updateProfile,
    getNotifications,
    markNotificationsRead,
    verifyNGO 
} = require('../controllers/authController');
const { protect, authorize } = require('../middleware/authMiddleware');

// --- Public Routes ---

// 1. Initial Registration (Sends OTP)
router.post('/register', register);

// 2. OTP Verification (Completes Registration)
router.post('/verify-otp', verifyOTP);

// 3. Standard Auth
router.post('/login', login);
router.post('/forgotpassword', forgotPassword);
router.post('/reset-password-otp', resetPassword);


// --- Protected Routes (Requires Login Token) ---

router.get('/profile', protect, getMe);
router.put('/updateprofile', protect, updateProfile);
router.get('/notifications', protect, getNotifications);
router.put('/notifications/read-all', protect, markNotificationsRead);


// --- Admin Only Routes ---

router.put('/verify-ngo/:id', protect, authorize('admin'), verifyNGO);

module.exports = router;
