const appointmentController = require('../controllers/appointmentController');
const router  =   require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/check',  appointmentController.appointmentChecker);
// router.get('/get/:id', authMiddleware, appointmentController.getAppointmentById);

router.get('/getAll', authMiddleware, appointmentController.getAllAppointmentsByUserId);

router.get('/sceduledAppointments', authMiddleware, appointmentController.getScheduledAppointmentsBySalonId);
module.exports = router;