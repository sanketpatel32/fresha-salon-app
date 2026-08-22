const appointmentController = require('../controllers/appointmentController');
const router = require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { validate, appointmentCheckSchema, customerReviewSchema, staffReviewSchema, reviewReplySchema, statusUpdateSchema, rescheduleSchema } = require('../utils/validators');

// Availability check — requires an authenticated customer.
router.post('/check', authMiddleware, authMiddleware.requireRole('customer'), validate(appointmentCheckSchema), appointmentController.appointmentChecker);

// A customer's own bookings. Scoped to req.user.userId in the controller.
router.get('/getAll', authMiddleware, authMiddleware.requireRole('customer'), appointmentController.getAllAppointmentsByUserId);

// Salon-side scheduled appointments (already had auth; now role-gated).
router.get('/sceduledAppointments', authMiddleware, authMiddleware.requireRole('salon'), appointmentController.getScheduledAppointmentsBySalonId);

// Email send after payment — requires an authenticated customer.
router.post('/mail', authMiddleware, authMiddleware.requireRole('customer'), appointmentController.mailAppointment);

// Review writing — customer only (ownership checked in the controller).
router.put('/review/:appointmentId', authMiddleware, authMiddleware.requireRole('customer'), validate(customerReviewSchema), appointmentController.updateCustomerReview);

// Staff/service notes — staff or salon owner (ownership checked in the controller).
router.put('/staffreview/:appointmentId', authMiddleware, authMiddleware.requireRole('staff', 'salon'), validate(staffReviewSchema), appointmentController.updateStaffReview);

// Public reply to a customer review — salon owner only (salon ownership
// checked in the controller; replying before a review exists 400s there too).
router.put('/:appointmentId/reply', authMiddleware, authMiddleware.requireRole('salon'), validate(reviewReplySchema), appointmentController.replyToReview);

// Reschedule — customer only (ownership + >24h rule enforced in the controller).
// Declared with the other parameterized appointment actions.
router.patch('/:appointmentId/reschedule', authMiddleware, authMiddleware.requireRole('customer'), validate(rescheduleSchema), appointmentController.rescheduleAppointment);

// Status workflow (accept/decline/complete) — salon or staff.
router.put('/cancel/:appointmentId', authMiddleware, appointmentController.cancelAppointment);
router.put('/status/:appointmentId', authMiddleware, authMiddleware.requireRole('salon', 'staff'), validate(statusUpdateSchema), appointmentController.updateAppointmentStatus);

module.exports = router;
