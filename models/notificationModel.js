const { DataTypes } = require('sequelize');
const sequelize = require('../utils/database');

/**
 * In-app notification. recipientRole/recipientId are plain integer refs (no
 * FK associations) so the table can point at either a user id or a salon id
 * without circular model imports.
 */
const Notification = sequelize.define('Notification', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true,
    },
    recipientRole: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isIn: [['customer', 'salon']],
        },
    },
    recipientId: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    type: {
        type: DataTypes.STRING,
        allowNull: false, // e.g. 'booking.new', 'booking.confirmed', 'booking.cancelled'
    },
    title: {
        type: DataTypes.STRING(120),
        allowNull: false,
    },
    body: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    appointmentId: {
        type: DataTypes.INTEGER,
        allowNull: true, // plain ref to appointments.id; no FK by design
    },
    readAt: {
        type: DataTypes.DATE,
        allowNull: true, // null == unread
    },
}, {
    indexes: [
        // Covers the list endpoint's WHERE + ORDER BY. Note: indexes created
        // via sync() only apply on table creation — fine for this new table.
        { fields: ['recipientRole', 'recipientId', 'createdAt'] },
    ],
});

module.exports = Notification;
