const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const User = sequelize.define('user', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true
    },
    name: {
        type: Sequelize.STRING,
        allowNull: false
    },
    phoneNumber: {
        type: Sequelize.STRING,
        allowNull: false,
    },
    email: {
        type: Sequelize.STRING,
        allowNull: false,
    },
    password: {
        type: Sequelize.STRING,
        allowNull: false
    },

    // Password reset (customers). Nullable — populated between a reset
    // request and its completion; only ever stores the SHA-256 hash of the
    // emailed token, never the token itself.
    resetTokenHash: {
        type: Sequelize.STRING,
        allowNull: true
    },
    resetTokenExpiresAt: {
        type: Sequelize.DATE,
        allowNull: true
    },

    // Email verification (soft — accounts stay usable either way; the flag is
    // exposed for future gating). Nullable token fields, populated between a
    // signup/resend and the verify call; only ever stores the SHA-256 hash of
    // the emailed token, never the token itself.
    emailVerified: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
        defaultValue: false
    },
    verificationTokenHash: {
        type: Sequelize.STRING,
        allowNull: true
    },
    verificationExpiresAt: {
        type: Sequelize.DATE,
        allowNull: true
    },

    // Loyalty points (#27): a flat 10 points per completed appointment.
    // loyaltyPoints is the current (spendable) balance; lifetimePointsEarned
    // is the cumulative, never-decrementing audit counter. Both are added to
    // existing databases as INTEGER NOT NULL DEFAULT 0 (boot backfill in
    // app.js) so every legacy row starts at zero; readers additionally coerce
    // null/undefined to 0 defensively.
    loyaltyPoints: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 0
    },
    lifetimePointsEarned: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 0
    },

}, { timestamps: true });

module.exports = User;