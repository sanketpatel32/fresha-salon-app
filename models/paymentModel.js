const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const Payment = sequelize.define('payment', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true
    },
    orderId: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
    },
    paymentSessionId: {
        type: Sequelize.STRING,
        allowNull: false
    },
    orderAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
    },
    orderCurrency: {
        type: Sequelize.STRING,
        allowNull: false
    },
    paymentStatus: {
        type: Sequelize.STRING,
        allowNull: false
    },
    customerID: { // Ensure this field exists
        type: Sequelize.INTEGER,
        allowNull: false
    },
    dateSelected: {
        type: Sequelize.DATEONLY,
        allowNull: false
    },
    timeSelected: {
        type: Sequelize.TIME,
        allowNull: false
    },
    endTime: {
        type: Sequelize.TIME,
        allowNull: false
    },
    staffId: {
        type: Sequelize.INTEGER,
        allowNull: false
    },
    salonId: {
        type: Sequelize.INTEGER,
        allowNull: false
    }, 
    serviceId: {
        type: Sequelize.INTEGER,
        allowNull: false
    },
    duration: {
        type: Sequelize.INTEGER,
        allowNull: true
    },

});

module.exports = Payment;