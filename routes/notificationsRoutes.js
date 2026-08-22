const router = require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');
const notificationController = require('../controllers/notificationController');

router.get('/', authMiddleware, authMiddleware.requireRole('customer', 'salon', 'admin'), notificationController.listNotifications);
router.patch('/:id/read', authMiddleware, authMiddleware.requireRole('customer', 'salon', 'admin'), notificationController.markNotificationRead);
router.post('/read-all', authMiddleware, authMiddleware.requireRole('customer', 'salon', 'admin'), notificationController.markAllNotificationsRead);

module.exports = router;
