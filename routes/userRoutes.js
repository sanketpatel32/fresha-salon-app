const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');
const { validate, loginSchema, customerSignupSchema, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema, resendVerificationSchema, accountDeletionSchema, recentlyViewedSchema, favoriteStaffSchema, profileUpdateSchema } = require('../utils/validators');
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
router.put('/edit', authMiddleware, validate(profileUpdateSchema), userController.editProfile);

// A customer's own loyalty balance (#27). Customer tokens only: the role
// guard rejects salon/staff/admin tokens (they carry no userId to scope by).
router.get('/loyalty', authMiddleware, authMiddleware.requireRole('customer'), userController.getLoyaltyBalance);

// ── Recently viewed salons (#58) ──────────────────────────────────────
// Customer-only (scoped by userId). The GET is a cheap indexed read; the POST
// is the explicit record-a-view ping (the salon profile route also records
// server-side). limit is clamped in the service, not validated here — an
// out-of-range value degrades to the nearest legal one rather than 400ing a
// convenience feature.
router.get('/recently-viewed', authMiddleware, authMiddleware.requireRole('customer'), userController.getRecentlyViewed);
router.post('/recently-viewed', authMiddleware, authMiddleware.requireRole('customer'), validate(recentlyViewedSchema), userController.recordRecentlyViewed);

// ── Favorite staff (#59) ─────────────────────────────────────────────
// Same customer-only scoping as salon favorites (which live under
// /user/favorites). POST is idempotent, DELETE is forgiving — both by design
// so a double-tap can never surface an error.
router.get('/favorites/staff', authMiddleware, authMiddleware.requireRole('customer'), userController.getFavoriteStaff);
router.post('/favorites/staff', authMiddleware, authMiddleware.requireRole('customer'), validate(favoriteStaffSchema), userController.addFavoriteStaff);
router.delete('/favorites/staff/:staffId', authMiddleware, authMiddleware.requireRole('customer'), userController.removeFavoriteStaff);

// The customer's personal referral code (#28) — lazily assigned on first
// read. Customer-only for the same reason as /loyalty.
router.get('/referral', authMiddleware, authMiddleware.requireRole('customer'), userController.getMyReferralCode);

// GDPR account self-deletion (#32). Customer-only (salon/staff/admin tokens
// carry no userId to scope by and must never erase a customer row), body
// password re-auth in the controller, and behind the SAME strict limiter as
// every other credential endpoint: this verifies a password AND destroys
// data, making it exactly as abuse-worthy as login.
router.delete('/me', strictLimiter, authMiddleware, authMiddleware.requireRole('customer'), validate(accountDeletionSchema), userController.deleteMyAccount);

module.exports = router;
