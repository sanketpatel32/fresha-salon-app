const router = require('express').Router();
const salonServices = require('../controllers/salonServicesController');

// Public: list a salon's active services (customers browse before booking).
router.get('/getAllActiveServicesBySalonId', salonServices.getAllActiveServicesBySalonId);

module.exports = router;
