const router = require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');
const favoriteController = require('../controllers/favoriteController');

router.get('/', authMiddleware, favoriteController.getFavorites);
router.post('/', authMiddleware, favoriteController.addFavorite);
router.delete('/:salonId', authMiddleware, favoriteController.removeFavorite);

module.exports = router;
