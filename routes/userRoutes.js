const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');
const { validate, loginSchema, customerSignupSchema, forgotPasswordSchema, resetPasswordSchema } = require('../utils/validators');
const { strictLimiter } = require('../middlewares/rateLimiters');

// Public auth endpoints.
router.post('/signup', validate(customerSignupSchema), userController.handleUserSignup);
router.post('/login', validate(loginSchema), userController.handleUserLogin);

// Password reset pair — PUBLIC (pre-auth) but throttled by the same strict
// limiter as login/signup (see middlewares/rateLimiters.js): both endpoints
// are abuse-worthy even though they never reveal account existence.
router.post('/forgot-password', strictLimiter, validate(forgotPasswordSchema), userController.forgotPassword);
router.post('/reset-password', strictLimiter, validate(resetPasswordSchema), userController.resetPassword);

// User search is an admin-only enumeration tool (the public salon browse is
// served by /api/buisness/getall).
router.get('/search', authMiddleware, authMiddleware.requireRole('admin'), userController.searchUsers);

// A customer's own profile — scoped by req.user in the controllers.
router.get('/profile', authMiddleware, userController.getUserProfile);
router.put('/edit', authMiddleware, userController.editProfile);

module.exports = router;
