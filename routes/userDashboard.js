const router = require('express').Router();
const salonServices = require('../controllers/salonServicesController');
const { validate, activeServicesBySalonSchema } = require('../utils/validators');

// Public: list a salon's active services (customers browse before booking).
// salonId arrives as a query param — validate it so bad input is rejected
// before it hits the DB.
router.get('/getAllActiveServicesBySalonId', validate(activeServicesBySalonSchema, 'query'), salonServices.getAllActiveServicesBySalonId);

module.exports = router;
