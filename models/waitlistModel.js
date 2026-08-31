const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

/**
 * Waitlist (#30) — customers queue for a busy salon on a specific DATE (not a
 * slot). When any appointment for that salon+date is cancelled, the oldest
 * 'waiting' entry whose partySize fits the freed capacity is flipped to
 * 'notified' and alerted (see services/waitlistService.js).
 *
 * salonId/userId are plain integer refs with NO FK associations — same
 * convention as notifications — so the table can never create circular
 * imports and legacy rows can't be orphaned by constraint enforcement.
 *
 * status lifecycle: waiting -> notified (an opening was claimed for them)
 *                   waiting -> left    (customer soft-left; row kept)
 */
const Waitlist = sequelize.define('Waitlist', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true,
    },
    salonId: {
        type: Sequelize.INTEGER,
        allowNull: false, // plain ref to salons.id; no FK by design
    },
    userId: {
        type: Sequelize.INTEGER,
        allowNull: false, // plain ref to users.id; no FK by design
    },
    date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
    },
    partySize: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: {
            min: { args: [1], msg: 'Party size must be at least 1' },
            max: { args: [20], msg: 'Party size cannot exceed 20' },
        },
    },
    status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'waiting',
        validate: {
            isIn: { args: [['waiting', 'notified', 'left']], msg: 'status must be waiting, notified or left' }
        }
    },
    notifiedAt: {
        type: Sequelize.DATE, // DATETIME on SQLite / TIMESTAMP on Postgres
        allowNull: true, // set when an opening is claimed for this entry
    },
}, {
    timestamps: true,
    indexes: [
        // Covers both hot lookups: the cancel-hook's "oldest waiting entry for
        // salon+date" and the salon dashboard's per-date day sheet. Indexes
        // created via sync() only apply on table creation — fine, new table.
        { fields: ['salonId', 'date', 'status'] },
        { fields: ['userId', 'createdAt'] },
        // One ACTIVE entry per user+salon+date, enforced by the database. The
        // controller's findOne pre-check is check-then-act; a double-tap on a
        // flaky network inserted two queue positions before this index existed.
        {
            unique: true,
            fields: ['userId', 'salonId', 'date'],
            where: { status: 'waiting' },
            name: 'waitlist_active_entry_uq',
        },
    ],
});

module.exports = Waitlist;
