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
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '09:00'
    },
    closingTime: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '20:00'
    },
    requiresApproval: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    // Denormalized rating cache — kept in sync by the review handler so browse
    // filtering/sorting (minRating, sort=rating) is a cheap WHERE/ORDER BY
    // instead of a grouped aggregation subquery on every request.
    avgRating: {
        type: Sequelize.DECIMAL(3, 2),
        allowNull: true,
        defaultValue: null,
    },
    reviewCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
}, { timestamps: true });

module.exports = Salons;