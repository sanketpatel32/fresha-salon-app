const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middlewares/authMiddleware');
const { validate, adminLoginSchema } = require('../utils/validators');

// Admin login is public (obviously).
router.post('/login', validate(adminLoginSchema), adminController.adminlogin);

// Every admin data endpoint requires a valid admin token. The old
// res.sendFile HTML routes are removed — the SPA serves all views now.
const adminOnly = [authMiddleware, authMiddleware.requireRole('admin')];

router.get('/appointments/getall', adminOnly, adminController.getAllAppointments);
router.delete('/appointments/:id', adminOnly, adminController.deleteAppointment);
router.get('/users/search', adminOnly, adminController.searchUsers);
router.delete('/users/:id', adminOnly, adminController.deleteUser);

module.exports = router;
