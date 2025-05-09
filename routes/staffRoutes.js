// routes/auth.js
const express = require('express');
const path = require('path');
const router = express.Router();
const staffController = require('../controllers/staffController')


router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..','views','staff' ,'login.html'));
});

router.post('/login', staffController.handleStaffLogin);

router.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..','views','staff' ,'dashboard.html'));
});

router.get('/appointments',staffController.getAppointments);


module.exports = router;
