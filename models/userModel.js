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

}, { timestamps: true });

module.exports = User;