const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

// Audit trail of destructive admin actions (user.delete, appointment.delete,
// ...). One row per action, written fire-and-forget AFTER the underlying
// operation already succeeded — a failed audit write must never undo or fail
// the deletion it describes. Plain sync() creates the table on boot; there are
// no FK associations, so no circular-import risk (same approach as
// notifications). updatedAt is disabled: audit rows are append-only.
const AdminAudit = sequelize.define('adminAudit', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true
    },
    adminEmail: {
        type: Sequelize.STRING,
        allowNull: false
    },
    action: {
        type: Sequelize.STRING(64),
        allowNull: false
    },
    targetType: {
        type: Sequelize.STRING(32),
        allowNull: false
    },
    targetId: {
        // String so non-integer identifiers (order ids, slugs, ...) fit too.
        type: Sequelize.STRING(64),
        allowNull: false
    },
    details: {
        type: Sequelize.STRING(255),
        allowNull: true
    },
}, { timestamps: true, updatedAt: false });

module.exports = AdminAudit;
