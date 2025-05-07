const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const staff = sequelize.define('staff', {
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
    address : {
        type: Sequelize.STRING,
        allowNull: true
    },
    documentNumber: {
        type: Sequelize.STRING,
        allowNull: true
    },

}, {timestamps:true});

module.exports = staff;