const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const Favorite = sequelize.define('favorite', {
    userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
    },
    salonId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: 'salons', key: 'id' },
        onDelete: 'CASCADE',
    },
}, { timestamps: true });

module.exports = Favorite;
