const router = require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');
const favoriteController = require('../controllers/favoriteController');
const { validate, favoriteAddSchema } = require('../utils/validators');

router.get('/', authMiddleware, favoriteController.getFavorites);
router.post('/', authMiddleware, validate(favoriteAddSchema), favoriteController.addFavorite);
router.delete('/:salonId', authMiddleware, favoriteController.removeFavorite);

module.exports = router;
