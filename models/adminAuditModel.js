const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

// Audit trail of security-relevant actions. One row per action, written
// fire-and-forget AFTER the underlying operation already succeeded — a failed
// audit write must never undo or fail the operation it describes. Plain sync()
// creates the table on boot; there are no FK associations, so no
// circular-import risk (same approach as notifications). updatedAt is
// disabled: audit rows are append-only.
//
// Originally admin-only (#16); extended in #52 to record ANY actor, because
// "which staff member cancelled this booking" and "which salon changed its
// payout details" are exactly the questions an audit trail exists to answer,
// and admin-only coverage left them unanswerable. `adminEmail` is retained for
// backward compatibility with the admin console; new rows populate actorRole
// and actorId alongside it.
const AdminAudit = sequelize.define('adminAudit', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true
    },
    adminEmail: {
        // Retained for admin-console compatibility. For non-admin actors this
        // carries the actor's email when known, or a role placeholder
        // (e.g. "role:staff") so the NOT NULL constraint still holds.
        type: Sequelize.STRING,
        allowNull: false
    },
    // ── Actor identity (#52) ───────────────────────────────────────────
    // Nullable: rows written before this extension legitimately have no actor
    // breakdown, and they must stay readable.
    actorRole: {
        type: Sequelize.STRING(16), // customer | salon | staff | admin | system
        allowNull: true
    },
    actorId: {
        type: Sequelize.STRING(64), // the entity id; null for admin/system
        allowNull: true
    },
    // Request context — the difference between "someone changed this" and
    // "someone changed this from this address". IPv6 needs 45 chars.
    ip: {
        type: Sequelize.STRING(45),
        allowNull: true
    },
    userAgent: {
        type: Sequelize.STRING(255),
        allowNull: true
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
