const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const salons = sequelize.define('salons', {
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

    pricing : {
        type: Sequelize.STRING,
        allowNull: false
    },
}, {timestamps:true});

module.exports = salons;