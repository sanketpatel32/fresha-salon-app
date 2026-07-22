const express = require('express');
const router = express.Router();
const salonController = require('../controllers/salonController');
const authMiddleware = require('../middlewares/authMiddleware');
const { validate, loginSchema, salonSignupSchema } = require('../utils/validators');

// Public auth endpoints.
router.post('/signup', validate(salonSignupSchema), salonController.salonSignup);
router.post('/login', validate(loginSchema), salonController.salonLogin);

// Public salon browse (customers explore salons before logging in).
router.get('/getall', salonController.getAllSalons);
router.get('/getsalonbyId', salonController.getSalonById);

// Salon-owner-only: fetch own profile, update own details.
// Role-gated; ownership is implicit (the token carries the salonId).
router.get('/getsalonbyIdSalonId', authMiddleware, authMiddleware.requireRole('salon'), salonController.getSalonBySalonId);
router.put('/changeSalonDetail', authMiddleware, authMiddleware.requireRole('salon'), salonController.updateSalonDetails);

module.exports = router;
