const router = require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');
const salonAnalyticsController = require('../controllers/salonAnalyticsController');
const { validate, analyticsWindowSchema } = require('../utils/validators');

// All analytics/calendar reads are salon-console endpoints behind the full
// salon-only chain — bare authMiddleware let other-role tokens through to a
// controller that scopes on req.user.salonId (undefined for them), producing
// 500s instead of clean 403s.
const salonOnly = [authMiddleware, authMiddleware.requireRole('salon')];

router.get('/analytics', salonOnly, salonAnalyticsController.getAnalytics);
router.get('/calendar', salonOnly, salonAnalyticsController.getCalendar);

// Revenue analytics (#31) — trailing-N-day daily series. days is coerced +
// clamped to 1..90 (default 30) by analyticsWindowSchema at the route.
router.get('/analytics/revenue', salonOnly, validate(analyticsWindowSchema, 'query'), salonAnalyticsController.getRevenueAnalytics);
router.get('/analytics/top-services', salonOnly, validate(analyticsWindowSchema, 'query'), salonAnalyticsController.getTopServices);

// Cancellation reasons (#60) — the breakdown behind the cancellation count.
// Same trailing-window contract and salon-only guard as the #31 endpoints.
router.get('/analytics/cancellation-reasons', salonOnly, validate(analyticsWindowSchema, 'query'), salonAnalyticsController.getCancellationReasons);

module.exports = router;
