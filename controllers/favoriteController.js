const Favorite = require('../models/favoriteModel');
const salonModel = require('../models/salonsModel');

// GET /api/user/favorites — list the calling customer's favorited salons.
const getFavorites = async (req, res) => {
    const userId = req.user.userId;
    try {
        const favorites = await Favorite.findAll({
            where: { userId },
            include: [{ model: salonModel, as: 'salon', attributes: { exclude: ['password', 'createdAt', 'updatedAt'] } }],
        });
        // Return the salon objects directly (cleaner for the frontend).
        const salons = favorites.map(f => f.salon);
        res.status(200).json(salons);
    } catch (error) {
        console.error('Error fetching favorites:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/user/favorites — add a salon to favorites (idempotent: re-adding is not an error).
const addFavorite = async (req, res) => {
    const userId = req.user.userId;
    const { salonId } = req.body;
    if (!salonId) {
        return res.status(400).json({ message: 'salonId is required' });
    }
    try {
        await Favorite.findOrCreate({ where: { userId, salonId } });
        res.status(200).json({ message: 'Added to favorites' });
    } catch (error) {
        console.error('Error adding favorite:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// DELETE /api/user/favorites/:salonId — remove a salon from favorites.
const removeFavorite = async (req, res) => {
    const userId = req.user.userId;
    const { salonId } = req.params;
    try {
        const deleted = await Favorite.destroy({ where: { userId, salonId } });
        if (deleted === 0) {
            return res.status(404).json({ message: 'Favorite not found' });
        }
        res.status(200).json({ message: 'Removed from favorites' });
    } catch (error) {
        console.error('Error removing favorite:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getFavorites, addFavorite, removeFavorite };
