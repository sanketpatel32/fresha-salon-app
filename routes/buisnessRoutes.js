const express = require('express');
const router = express.Router();
const salonController = require('../controllers/salonController');
const authMiddleware = require('../middlewares/authMiddleware');
const { validate, loginSchema, salonSignupSchema, salonBrowseSchema, salonDetailsSchema } = require('../utils/validators');

// Public auth endpoints.
router.post('/signup', validate(salonSignupSchema), salonController.salonSignup);
router.post('/login', validate(loginSchema), salonController.salonLogin);

// Public salon browse (customers explore salons before logging in).
// getall is query-param-aware: validate the browse params (all optional).
router.get('/getall', validate(salonBrowseSchema, 'query'), salonController.getAllSalons);
router.get('/getsalonbyId', salonController.getSalonById);
router.get('/profile/:salonId', salonController.getSalonProfile);

// Salon-owner-only: fetch own profile, update own details.
// Role-gated; ownership is implicit (the token carries the salonId).
router.get('/getsalonbyIdSalonId', authMiddleware, authMiddleware.requireRole('salon'), salonController.getSalonBySalonId);
router.put('/changeSalonDetail', authMiddleware, authMiddleware.requireRole('salon'), validate(salonDetailsSchema), salonController.updateSalonDetails);

module.exports = router;
