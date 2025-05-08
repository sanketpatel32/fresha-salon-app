const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const Salons = sequelize.define('salons', {
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
    address: {
        type: Sequelize.STRING,
        allowNull: false
    },
    pricing: {
        type: Sequelize.STRING,
        allowNull: false
    },
    statusbar: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'active' // Default status is 'active'
    },
    workingDays: {
        type: Sequelize.JSON, // Store working days as a JSON array
        allowNull: true,
        defaultValue: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] // Default to Monday to Saturday
    },
    openingTime: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 11 // Default opening time (11 AM)
    },
    closingTime: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 23 // Default closing time (11 PM)
    },
}, { timestamps: true });

module.exports = Salons;