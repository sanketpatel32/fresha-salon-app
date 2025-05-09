const { DataTypes } = require('sequelize');
const sequelize = require('../utils/database'); // Adjust the path to your database connection file


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
});

module.exports = Appointment;