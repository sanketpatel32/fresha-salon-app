const router = require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');
const salonAnalyticsController = require('../controllers/salonAnalyticsController');

router.get('/analytics', authMiddleware, salonAnalyticsController.getAnalytics);
router.get('/calendar', authMiddleware, salonAnalyticsController.getCalendar);

module.exports = router;
