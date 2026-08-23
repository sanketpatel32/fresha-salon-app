const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const Payment = sequelize.define('payment', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true
    },
    orderId: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
    },
    paymentSessionId: {
        type: Sequelize.STRING,
        allowNull: false
    },
    orderAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
    },
    orderCurrency: {
        type: Sequelize.STRING,
        allowNull: false
    },
    paymentStatus: {
        type: Sequelize.STRING,
        allowNull: false
    },
    customerID: { // Ensure this field exists
        type: Sequelize.INTEGER,
        allowNull: false
    },
    dateSelected: {
        type: Sequelize.DATEONLY,
        allowNull: false
    },
    timeSelected: {
        type: Sequelize.TIME,
        allowNull: false
    },
    endTime: {
        type: Sequelize.TIME,
        allowNull: false
    },
    staffId: {
        type: Sequelize.INTEGER,
        allowNull: false
    },
    salonId: {
        type: Sequelize.INTEGER,
        allowNull: false
    }, 
    serviceId: {
        type: Sequelize.INTEGER,
        allowNull: false
    },
    duration: {
        type: Sequelize.INTEGER,
        allowNull: true
    },

    // ── Promo-code ledger ──
    // orderAmount carries the DISCOUNTED final charge (matching the Cashfree
    // order); these preserve what the price was before the discount and how
    // much came off. Nullable so legacy rows stay valid.
    originalAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
    },
    discountAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
    },
    promoCodeApplied: {
        type: Sequelize.STRING(64),
        allowNull: true
    },

    // ── Customer booking note ──
    // Captured (trimmed, ≤500 chars) at order creation and copied onto the
    // Appointment when the payment finalizes into a booking — see
    // finalizeAppointmentFromPayment. Nullable: most orders carry none and
    // legacy rows predate notes entirely.
    customerNote: {
        type: Sequelize.TEXT,
        allowNull: true
    },

    // ── Group booking size (carrier) ──
    // Captured at order creation (schema-clamped 1..20, default 1) and copied
    // onto the Appointment in finalizeAppointmentFromPayment — the webhook and
    // redirect handlers only ever hold the Payment row, so it must ride along
    // here exactly like customerNote. NOT NULL DEFAULT 1 keeps legacy rows
    // valid after the boot-time ensureColumns backfill.
    partySize: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1
    },

    // ── Optional customer tip ──
    // Captured at order creation (schema-clamped 0..10000, rounded to 2dp).
    // The tip is ADDED ON TOP of the discounted service charge when both the
    // Cashfree order and this row's orderAmount are computed (see
    // processPayment) — it is itself never discounted, and it deliberately
    // does NOT count toward promo min-order thresholds. Null = no tip, which
    // keeps legacy rows (and tip-less orders) valid without backfill.
    tipAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
    },
    // Flips to 1 inside finalizeAppointmentFromPayment once the booking has
    // actually materialized — mirroring how success bookkeeping works for the
    // promo ledger. Admin tip totals only sum rows where this flag is set, so
    // a tipped order that never completes a booking can't inflate them.
    // NOT NULL DEFAULT 0 keeps legacy rows valid after the boot-time
    // ensureColumns backfill.
    tipCaptured: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
    },

});

module.exports = Payment;