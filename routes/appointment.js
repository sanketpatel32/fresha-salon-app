const appointmentController = require('../controllers/appointmentController');
const router  =   require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/check',  appointmentController.appointmentChecker);

module.exports = router;