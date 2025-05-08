const express = require('express');
const router = express.Router();

const authMiddleware = require('../middlewares/authMiddleware');

const userRoutes = require('./userRoutes');
const businessRoutes = require('./buisnessRoutes');
const userDashboardRoutes = require('./userDashboard');
const businessDashboardRoutes = require('./salonsDashboard');
const appointmentRoutes = require('./appointment');
const paymentRoutes = require('./paymentroutes');

router.use('/user', userRoutes);
router.use('/buisness', businessRoutes);
router.use('/userdashboard', userDashboardRoutes);
router.use('/salonsdashboard', businessDashboardRoutes);
router.use('/appointment', appointmentRoutes);
router.use('/pay', paymentRoutes);
module.exports = router;
