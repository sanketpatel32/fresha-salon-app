const router = require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');
const salonAnalyticsController = require('../controllers/salonAnalyticsController');
const { validate, analyticsWindowSchema } = require('../utils/validators');

// /analytics and /calendar predate the dashboard's role guard; the #31
// revenue/top-services endpoints are salon-console reads and sit behind the
// full salon-only chain like every other salonsdashboard route.
const salonOnly = [authMiddleware, authMiddleware.requireRole('salon')];

router.get('/analytics', authMiddleware, salonAnalyticsController.getAnalytics);
router.get('/calendar', authMiddleware, salonAnalyticsController.getCalendar);

// Revenue analytics (#31) — trailing-N-day daily series. days is coerced +
// clamped to 1..90 (default 30) by analyticsWindowSchema at the route.
router.get('/analytics/revenue', salonOnly, validate(analyticsWindowSchema, 'query'), salonAnalyticsController.getRevenueAnalytics);
router.get('/analytics/top-services', salonOnly, validate(analyticsWindowSchema, 'query'), salonAnalyticsController.getTopServices);

module.exports = router;
