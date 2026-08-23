const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const Salons = sequelize.define('salons', {
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
    address: {
        type: Sequelize.STRING,
        allowNull: false
    },
    pricing: {
        type: Sequelize.STRING,
        allowNull: false
    },
    statusbar: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'active' // Default status is 'active'
    },
    workingDays: {
        type: Sequelize.JSON, // Store working days as a JSON array
        allowNull: true,
        defaultValue: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] // Default to Monday to Saturday
    },
    openingTime: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '09:00'
    },
    closingTime: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '20:00'
    },
    requiresApproval: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    // Denormalized rating cache — kept in sync by the review handler so browse
    // filtering/sorting (minRating, sort=rating) is a cheap WHERE/ORDER BY
    // instead of a grouped aggregation subquery on every request.
    avgRating: {
        type: Sequelize.DECIMAL(3, 2),
        allowNull: true,
        defaultValue: null,
    },
    reviewCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    // Photo gallery: JSON.stringify(string[]) of http(s) image URLs, or null
    // when the salon hasn't set one. TEXT so it works identically on SQLite
    // and Postgres; parsed defensively (parseGallery) before exposure.
    galleryImages: {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: null,
    },
    // Booking policy, enforced in services/availabilityService.js on every
    // booking path (checker, payment, reschedule):
    //   bookingLeadTimeMinutes — a slot must start at least this many minutes
    //     from now. null/0 = bookable immediately.
    //   slotStepMinutes — the minute-grid pickers should align to.
    //     null = default 30 (see resolveSlotStepMinutes).
    bookingLeadTimeMinutes: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
    },
    slotStepMinutes: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
    },
    // Weekly working hours: JSON.stringify of exactly seven day entries
    // ("0"=Sunday .. "6"=Saturday), each { open, close, closed } with strict
    // 24h HH:mm times; closed:true days ignore open/close. null (the state
    // until the salon saves a schedule once) keeps the legacy behavior of
    // the single openingTime/closingTime window above on every open day.
    // Enforced in services/availabilityService.js on every booking path;
    // parsed defensively (parseWeeklyHours) so corrupt values degrade to
    // that same legacy logic instead of erroring.
    weeklyHours: {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: null,
    },
}, { timestamps: true });

module.exports = Salons;