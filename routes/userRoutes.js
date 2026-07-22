const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');
const { validate, loginSchema, customerSignupSchema } = require('../utils/validators');

// Public auth endpoints.
router.post('/signup', validate(customerSignupSchema), userController.handleUserSignup);
router.post('/login', validate(loginSchema), userController.handleUserLogin);

// User search is an admin-only enumeration tool (the public salon browse is
// served by /api/buisness/getall).
router.get('/search', authMiddleware, authMiddleware.requireRole('admin'), userController.searchUsers);

// A customer's own profile — scoped by req.user in the controllers.
router.get('/profile', authMiddleware, userController.getUserProfile);
router.put('/edit', authMiddleware, userController.editProfile);

module.exports = router;
