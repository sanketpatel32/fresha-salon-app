const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

/**
 * Recently viewed salons (#58).
 *
 * "Where was that place I looked at yesterday?" is the question this answers —
 * browse history is the single most-requested convenience in booking apps and
 * the cheapest to store, because the row is three integers wide.
 *
 * Design decisions:
 *  - One row per (userId, salonId), with `viewedAt` UPDATED on a repeat view
 *    rather than a new row inserted. A customer who opens the same salon ten
 *    times has one recency entry, not ten — otherwise the list fills with
 *    duplicates and stops being useful.
 *  - No FK association to salons. The salon row can be hard-deleted by an
 *    admin, and a broken reference must not make a customer's history page
 *    500 — the read path therefore joins by hand and skips missing salons.
 *  - Pruned to the newest N per user (see services/recentViewsService) so the
 *    table can't grow without bound.
 */
const RecentlyViewed = sequelize.define('recentlyViewed', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true,
    },
    userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
    },
    salonId: {
        type: Sequelize.INTEGER,
        allowNull: false,
    },
    viewedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
    },
}, {
    timestamps: false, // viewedAt IS the timestamp; updatedAt would be noise
    indexes: [
        // Every read is "this user's entries, newest first".
        { fields: ['userId', 'viewedAt'] },
        // Enforces one row per user+salon so the upsert has something to hit.
        { fields: ['userId', 'salonId'], unique: true },
    ],
});

module.exports = RecentlyViewed;
