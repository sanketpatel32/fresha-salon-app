const express = require('express');
const router = express.Router();
const salonController = require('../controllers/salonController');
const authMiddleware = require('../middlewares/authMiddleware');
const { validate, loginSchema, salonSignupSchema, salonBrowseSchema, salonDetailsSchema, staffDirectorySchema } = require('../utils/validators');

// Public auth endpoints.
router.post('/signup', validate(salonSignupSchema), salonController.salonSignup);
router.post('/login', validate(loginSchema), salonController.salonLogin);

// Public salon browse (customers explore salons before logging in).
// getall is query-param-aware: validate the browse params (all optional).
// authMiddleware.optional lets a signed-in customer's token personalize the
// response (isFavorite flags) while anonymous/stale-token requests proceed
// untouched — browse itself stays public.
router.get('/getall', authMiddleware.optional, validate(salonBrowseSchema, 'query'), salonController.getAllSalons);
router.get('/getsalonbyId', salonController.getSalonById);
router.get('/profile/:salonId', salonController.getSalonProfile);

// Public staff directory: who works at a salon + what each member can book.
// Query-param style like getsalonbyId (static /staff, so no ordering or
// collision concerns with the paths above). Fully public without
// authMiddleware.optional — unlike browse there is no personalization in the
// response, so an optional token would be dead weight.
router.get('/staff', validate(staffDirectorySchema, 'query'), salonController.getSalonStaff);

// Salon-owner-only: fetch own profile, update own details.
// Role-gated; ownership is implicit (the token carries the salonId).
router.get('/getsalonbyIdSalonId', authMiddleware, authMiddleware.requireRole('salon'), salonController.getSalonBySalonId);
router.put('/changeSalonDetail', authMiddleware, authMiddleware.requireRole('salon'), validate(salonDetailsSchema), salonController.updateSalonDetails);

module.exports = router;
