const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

/**
 * Idempotency key store (#46).
 *
 * A client that times out or retries a payment has no way to know whether the
 * first attempt succeeded. Without idempotency the retry creates a SECOND
 * Cashfree order and a second booking — the customer is charged twice.
 *
 * With it: the client generates one key per logical operation and sends it on
 * every retry. The first execution stores the response; retries replay the
 * stored response instead of re-running the handler.
 *
 * `requestHash` is a SHA-256 of the method + path + body. A key reused with a
 * DIFFERENT body is a client bug (or an attack), and is rejected with 409 —
 * silently replaying a stale response for different input would be worse.
 *
 * Rows are self-cleaning via `expiresAt`; the service prunes on write and the
 * boot sequence prunes stale rows, so the table can't grow without bound.
 */
const IdempotencyKey = sequelize.define('IdempotencyKey', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true,
    },
    // Namespaced per principal so two users picking the same uuid can never
    // collide into one record. `scope:role:id` or `scope:anon`.
    scope: {
        type: Sequelize.STRING(64),
        allowNull: false,
    },
    // The client-supplied key, unique within its scope.
    key: {
        type: Sequelize.STRING(128),
        allowNull: false,
    },
    // SHA-256 of method + path + canonical body — the fingerprint guard.
    requestHash: {
        type: Sequelize.STRING(64),
        allowNull: false,
    },
    // HTTP status of the original response. null while in flight.
    statusCode: {
        type: Sequelize.INTEGER,
        allowNull: true,
    },
    // Serialized response body (JSON text). null while in flight.
    responseBody: {
        type: Sequelize.TEXT,
        allowNull: true,
    },
    // Set once the handler completes — a row without it means "in flight".
    completedAt: {
        type: Sequelize.DATE,
        allowNull: true,
    },
    expiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
    },
}, {
    timestamps: true,
    indexes: [
        // The hot lookup: "have I seen this key for this principal?"
        { fields: ['scope', 'key'], unique: true },
        // Sweep target for the periodic prune.
        { fields: ['expiresAt'] },
    ],
});

module.exports = IdempotencyKey;
