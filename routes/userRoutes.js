const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');
const { validate, loginSchema, customerSignupSchema, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema, resendVerificationSchema } = require('../utils/validators');
const { strictLimiter } = require('../middlewares/rateLimiters');

// Public auth endpoints.
router.post('/signup', validate(customerSignupSchema), userController.handleUserSignup);
router.post('/login', validate(loginSchema), userController.handleUserLogin);

// Password reset pair — PUBLIC (pre-auth) but throttled by the same strict
// limiter as login/signup (see middlewares/rateLimiters.js): both endpoints
// are abuse-worthy even though they never reveal account existence.
router.post('/forgot-password', strictLimiter, validate(forgotPasswordSchema), userController.forgotPassword);
router.post('/reset-password', strictLimiter, validate(resetPasswordSchema), userController.resetPassword);

// Email verification pair — PUBLIC (pre-auth), same strict limiter: both are
// token-burning / mail-sending endpoints even though neither reveals whether
// an account exists.
router.post('/verify-email', strictLimiter, validate(verifyEmailSchema), userController.verifyEmail);
router.post('/resend-verification', strictLimiter, validate(resendVerificationSchema), userController.resendVerification);

// User search is an admin-only enumeration tool (the public salon browse is
// served by /api/buisness/getall).
router.get('/search', authMiddleware, authMiddleware.requireRole('admin'), userController.searchUsers);

// A customer's own profile — scoped by req.user in the controllers.
router.get('/profile', authMiddleware, userController.getUserProfile);
router.put('/edit', authMiddleware, userController.editProfile);

// A customer's own loyalty balance (#27). Customer tokens only: the role
// guard rejects salon/staff/admin tokens (they carry no userId to scope by).
router.get('/loyalty', authMiddleware, authMiddleware.requireRole('customer'), userController.getLoyaltyBalance);

// The customer's personal referral code (#28) — lazily assigned on first
// read. Customer-only for the same reason as /loyalty.
router.get('/referral', authMiddleware, authMiddleware.requireRole('customer'), userController.getMyReferralCode);

module.exports = router;
