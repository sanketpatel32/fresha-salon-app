const Favorite = require('../models/favoriteModel');
const salonModel = require('../models/salonsModel');
const { paginateQuery, buildMeta } = require('../utils/pagination');

// GET /api/user/favorites — list the calling customer's favorited salons.
//
// Backward compatible pagination (same contract as the appointment listings):
//   - no ?page/?limit  -> legacy bare array of salon objects
//   - either param     -> { data, page, limit, total, totalPages }
// Both shapes are newest-first (most recently favorited salon first).
const getFavorites = async (req, res) => {
    const userId = req.user.userId;
    try {
        const { requested, page, limit, offset } = paginateQuery(req);

        const findOpts = {
            where: { userId },
            include: [{ model: salonModel, as: 'salon', attributes: { exclude: ['password', 'createdAt', 'updatedAt'] } }],
            order: [['createdAt', 'DESC']],
        };

        if (!requested) {
            const favorites = await Favorite.findAll(findOpts);
            // Return the salon objects directly (cleaner for the frontend).
            return res.status(200).json(favorites.map(f => f.salon));
        }

        const { rows, count } = await Favorite.findAndCountAll({
            ...findOpts,
            limit,
            offset,
            // NOTE: no `distinct: true` here — Favorite's composite PK
            // (userId, salonId) makes Sequelize count DISTINCT userId, which
            // collapses every row of one customer to 1. The salon include is
            // many-to-one and cannot multiply rows, so COUNT(*) is exact.
        });

        return res.status(200).json({ data: rows.map(f => f.salon), ...buildMeta(page, limit, count) });
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
