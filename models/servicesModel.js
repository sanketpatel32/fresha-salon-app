const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const Services = sequelize.define('services', {
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
    price: {
        type: Sequelize.FLOAT,
        allowNull: false
    },
    duration: {
        type: Sequelize.INTEGER, // Duration in minutes
        allowNull: false
    },
    salonId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
            model: 'salons', // Name of the salons table
            key: 'id'
        }
    },
    statusbar: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'active' // Default status is 'active'
    },
}, { timestamps: true });

module.exports = Services;