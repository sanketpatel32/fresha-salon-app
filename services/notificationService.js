/**
 * In-app notification service — single fire-and-forget entry point.
 *
 * Contract: `notify()` NEVER throws into the caller's flow. Every failure
 * (validation, DB down) is caught and logged via the structured logger so a
 * broken notification can never break a booking, cancellation, or status
 * update that already succeeded. Callers may call it without awaiting; it is
 * awaitable only so tests (and anyone who cares) can wait for the write.
 */
const logger = require('../utils/logger');

let Notification;
try {
    Notification = require('../models/notificationModel');
} catch (err) {
    Notification = null;
}

const notify = async ({ recipientRole, recipientId, type, title, body, appointmentId }) => {
    try {
        if (!Notification) throw new Error('notification model unavailable');
        if (!recipientRole || !type || !title) return null;
        if (recipientId === undefined || recipientId === null) return null;

        return await Notification.create({
            recipientRole,
            recipientId: Number(recipientId),
            type,
            title: String(title).slice(0, 120),
            body: body !== undefined && body !== null ? String(body).slice(0, 255) : null,
            appointmentId: appointmentId ?? null,
        });
    } catch (err) {
        logger.error('Failed to create in-app notification:', err.message);
        return null;
    }
};

module.exports = { notify };
