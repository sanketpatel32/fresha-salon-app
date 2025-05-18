// routes/auth.js
const express = require('express');
const path = require('path');
const router = express.Router();
const userController = require('../controllers/userController');
// router.get('/signup', (req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'views','user' ,'signup.html'));
// });

// router.get('/login', (req, res) => {
//     res.sendFile(path.join(__dirname, '..','views','user' ,'login.html'));
// });
router.post('/signup', userController.handleUserSignup);
router.post('/login', userController.handleUserLogin);
router.get('/search', userController.searchUsers); // Search for users
router.get('/profile', userController.getUserProfile); // Get user profile
// router.get('/edit', (req, res) => {
//     res.sendFile(path.join(__dirname, '..','views','user' ,'editProfile.html'));
// });
router.put('/edit', userController.editProfile); // Edit user profile

module.exports = router;
