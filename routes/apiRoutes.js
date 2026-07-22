const express = require('express');
const router = express.Router();

const userRoutes = require('./userRoutes');
const businessRoutes = require('./buisnessRoutes');
const userDashboardRoutes = require('./userDashboard');
const businessDashboardRoutes = require('./salonsDashboardRoutes');
const appointmentRoutes = require('./appointmentRoutes');
const paymentRoutes = require('./paymentroutes');
const staffRoutes = require('./staffRoutes')
const favoriteRoutes = require('./favoriteRoutes');
const salonAnalyticsRoutes = require('./salonAnalyticsRoutes');
const adminRoutes = require('./adminRoutes');

router.use('/user', userRoutes);
router.use('/user/favorites', favoriteRoutes);
// Correctly-spelled mount + legacy alias (the frontend still calls /buisness).
// New code should target /business; /buisness stays for backward compatibility.
router.use('/business', businessRoutes);
router.use('/buisness', businessRoutes);
router.use('/userdashboard', userDashboardRoutes);
router.use('/salonsdashboard', businessDashboardRoutes);
router.use('/salonsdashboard', salonAnalyticsRoutes);
router.use('/appointment', appointmentRoutes);
router.use('/pay', paymentRoutes);
router.use('/staff',staffRoutes);
router.use('/admin', adminRoutes);
module.exports = router;
