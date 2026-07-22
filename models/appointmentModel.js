const { DataTypes } = require('sequelize');
const sequelize = require('../utils/database'); 


const Appointment = sequelize.define('Appointment', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true,
    },
    staffId: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    salonId: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    serviceId:{
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    userId:{
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    date: {
        type: DataTypes.DATEONLY, // Store only the date (YYYY-MM-DD)
        allowNull: false,
    },
    time: {
        type: DataTypes.TIME, // Store the time (HH:mm:ss)
        allowNull: false,
    },
    endTime: {
        type: DataTypes.TIME, // Store the end time (HH:mm:ss)
        allowNull: false,
    },
    staffReview: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    userReview: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'confirmed',
        validate: {
            isIn: [['pending', 'confirmed', 'declined', 'completed', 'cancelled']]
        }
    },
    rating: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1, max: 5 }
    },
    orderId: {
        type: DataTypes.STRING,
        allowNull: true, // nullable for legacy rows created before this column existed
        unique: true, // DB-level guard against duplicate appointment creation on payment replay
    },
});

module.exports = Appointment;