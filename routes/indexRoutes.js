const express = require('express');
const router = express.Router();

const authMiddleware = require('../middlewares/authMiddleware');

const userRoutes = require('./userRoutes');
const businessRoutes = require('./buisnessRoutes');
const userDashboardRoutes = require('./userDashboard');
const businessDashboardRoutes = require('./salonsDashboard');

router.use('/user', userRoutes);
router.use('/buisness', businessRoutes);
router.use('/userdashboard', userDashboardRoutes);
router.use('/salonsdashboard', businessDashboardRoutes);

module.exports = router;
