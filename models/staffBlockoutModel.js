const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const StaffBlockout = sequelize.define('staffBlockout', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true,
    },
    staffId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'staff', key: 'id' },
        onDelete: 'CASCADE',
    },
    date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
    },
    startTime: {
        type: Sequelize.STRING,
        allowNull: false,
    },
    endTime: {
        type: Sequelize.STRING,
        allowNull: false,
    },
    reason: {
        type: Sequelize.STRING,
        allowNull: true,
    },
}, { timestamps: true });

module.exports = StaffBlockout;
