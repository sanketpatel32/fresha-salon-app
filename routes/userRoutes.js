// routes/auth.js
const express = require('express');
const path = require('path');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/signup', userController.handleUserSignup);
router.post('/login', userController.handleUserLogin);
router.get('/search', userController.searchUsers); // Search for users
router.get('/profile', authMiddleware, userController.getUserProfile); // Get user profile
router.put('/edit', authMiddleware, userController.editProfile); // Edit user profile

module.exports = router;

