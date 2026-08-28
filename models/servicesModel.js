const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const Services = sequelize.define('services', {
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
    category: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'Other',
        validate: {
            isIn: [[
                'Hair', 'Spa & Massage', 'Facial & Skin', 'Nails',
                'Makeup', 'Bridal', "Men's Grooming", 'Other'
            ]]
        }
    },
    price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
    },
    duration: {
        type: Sequelize.INTEGER, // Duration in minutes
        allowNull: false
    },
    salonId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
            model: 'salons', // Name of the salons table
            key: 'id'
        }
    },
    statusbar: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'active' // Default status is 'active'
    },
    // Soft-delete stamp (#51). Set when a service that has BOOKING HISTORY is
    // deleted: the row must survive because appointments, payments, CSV exports
    // and revenue analytics all reference serviceId, and hard-deleting it
    // would corrupt historical reports. Null = never archived.
    archivedAt: {
        type: Sequelize.DATE,
        allowNull: true,
    },
}, { timestamps: true });

module.exports = Services;