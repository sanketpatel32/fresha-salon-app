const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const authMiddleware = require('../middlewares/authMiddleware');
const { validate, loginSchema } = require('../utils/validators');

// Staff login is public.
router.post('/login', validate(loginSchema), staffController.handleStaffLogin);

// A staff member's own schedule for today. Static path, declared before any
// parameterized route could ever shadow it. Scoped to req.user.staffId.
router.get(
    '/today',
    authMiddleware,
    authMiddleware.requireRole('staff'),
    staffController.getMyTodaySchedule
);

// A staff member's own appointments. Scoped to req.user.staffId in the controller.
router.get(
    '/appointments',
    authMiddleware,
    authMiddleware.requireRole('staff'),
    staffController.getAppointments
);

module.exports = router;
