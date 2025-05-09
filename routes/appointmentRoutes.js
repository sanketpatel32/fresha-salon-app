const appointmentController = require('../controllers/appointmentController');
const router  =   require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/check',  appointmentController.appointmentChecker);
// router.get('/get/:id', authMiddleware, appointmentController.getAppointmentById);

router.get('/getAll',  appointmentController.getAllAppointmentsByUserId);

router.get('/sceduledAppointments', authMiddleware, appointmentController.getScheduledAppointmentsBySalonId);

router.post('/mail',appointmentController.mailAppointment);

router.put('/review/:appointmentId', appointmentController.updateCustomerReview);
router.put('/staffreview/:appointmentId', appointmentController.updateStaffReview);

module.exports = router;