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
}, { timestamps: true });

module.exports = Salons;