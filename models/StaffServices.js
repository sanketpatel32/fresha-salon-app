const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const StaffServices = sequelize.define('StaffServices', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true
    },
    staffId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
            model: 'staff',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    serviceId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
            model: 'services',
            key: 'id'
        },
        onDelete: 'CASCADE'
    }
}, { timestamps: true });

module.exports = StaffServices;