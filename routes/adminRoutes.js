const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Serve the admin login page
router.get('/dashboard', (req, res) => {
    res.sendFile(require('path').join(__dirname, '../views/admin/index.html'));
});

// Handle admin login POST
router.post('/login', adminController.adminlogin);

router.get('/appointments', (req, res) => {
    res.sendFile(require('path').join(__dirname, '../views/admin/appointments.html'));
});
router.get('/appointments/getall', adminController.getAllAppointments);
router.delete('/appointments/:id', adminController.deleteAppointment);

router.get('/users', (req, res) => {
    res.sendFile(require('path').join(__dirname, '../views/admin/user.html'));
});
router.get('/users/search', adminController.searchUsers);
router.delete('/users/:id', adminController.deleteUser);

module.exports = router;