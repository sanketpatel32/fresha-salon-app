const router = require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');
const favoriteController = require('../controllers/favoriteController');
const { validate, favoriteAddSchema } = require('../utils/validators');

// Customer-only (scoped by req.user.userId) — other roles carry no userId and
// would otherwise reach Sequelize with an undefined where value (500 instead
// of 403).
const customerOnly = [authMiddleware, authMiddleware.requireRole('customer')];

router.get('/', customerOnly, favoriteController.getFavorites);
router.post('/', customerOnly, validate(favoriteAddSchema), favoriteController.addFavorite);
router.delete('/:salonId', customerOnly, favoriteController.removeFavorite);

module.exports = router;
