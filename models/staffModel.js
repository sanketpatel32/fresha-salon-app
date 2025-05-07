const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const Staff = sequelize.define('staff', {
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
    salonId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
            model: 'salons', // Name of the target table
            key: 'id' // Key in the target table
        },
        onDelete: 'CASCADE' // Delete staff if the associated salon is deleted
    },
    statusbar: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'active' // Default status is 'active'
    },
}, { timestamps: true });

module.exports = Staff;