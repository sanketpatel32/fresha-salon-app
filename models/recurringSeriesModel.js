const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

/**
 * Recurring booking series (#61).
 *
 * A customer who gets a haircut every six weeks should not have to re-enter
 * the same booking six times a year. This table stores the INTENT; the
 * individual visits are ordinary Appointment rows stamped with `seriesId`,
 * materialized by the series sweep (services/recurringService.js) as each
 * occurrence comes due.
 *
 * Why store intent instead of creating all the bookings up front:
 *  - A salon's staff, hours and prices change. Booking a visit six months out
 *    today would silently commit a price and a chair that may not exist.
 *  - Occurrences materialize as PENDING appointments, so the salon still
 *    confirms each one — a recurring series is a request for a standing
 *    appointment, not a purchased right to a chair.
 *
 * `occurrencesCreated` + `status` make the sweep idempotent: it always asks
 * "how many occurrences are due, and how many exist?" rather than tracking a
 * mutable next-date cursor that a restart could double-advance.
 */
const RecurringSeries = sequelize.define('recurringSeries', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true,
    },
    userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
    },
    salonId: {
        type: Sequelize.INTEGER,
        allowNull: false,
    },
    serviceId: {
        type: Sequelize.INTEGER,
        allowNull: false,
    },
    staffId: {
        type: Sequelize.INTEGER,
        allowNull: false,
    },
    // Anchor of the pattern. Occurrence N starts here + N × interval.
    startDate: {
        type: Sequelize.DATEONLY,
        allowNull: false,
    },
    time: {
        type: Sequelize.TIME,
        allowNull: false,
    },
    frequency: {
        type: Sequelize.ENUM('weekly', 'biweekly', 'monthly'),
        allowNull: false,
        defaultValue: 'weekly',
    },
    // Total visits the customer asked for, including the first.
    occurrences: {
        type: Sequelize.INTEGER,
        allowNull: false,
        validate: { min: 2, max: 52 },
    },
    // How many have actually been materialized so far. Compared with the
    // number "due" by date to decide whether to create the next one.
    occurrencesCreated: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    partySize: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
    },
    status: {
        type: Sequelize.ENUM('active', 'paused', 'cancelled'),
        allowNull: false,
        defaultValue: 'active',
    },
}, {
    timestamps: true,
    indexes: [
        // The sweep only ever scans active series.
        { fields: ['status', 'startDate'] },
        { fields: ['userId'] },
    ],
});

module.exports = RecurringSeries;
