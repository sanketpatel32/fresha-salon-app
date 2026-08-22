/**
 * Admin audit trail — single fire-and-forget entry point.
 *
 * Contract mirrors notificationService.notify(): `recordAudit()` NEVER throws
 * into the caller's flow. Every failure is caught and logged via the
 * structured logger so a broken audit write can never break (or roll back) a
 * deletion that already succeeded. Callers may call it without awaiting; it is
 * awaitable only so tests (and anyone who cares) can wait for the write.
 */
const logger = require('../utils/logger');

let AdminAudit;
try {
    AdminAudit = require('../models/adminAuditModel');
} catch (err) {
    AdminAudit = null;
}

const recordAudit = async ({ adminEmail, action, targetType, targetId, details }) => {
    try {
        if (!AdminAudit) throw new Error('admin audit model unavailable');
        if (!adminEmail || !action || !targetType || targetId === undefined || targetId === null) return null;

        return await AdminAudit.create({
            adminEmail: String(adminEmail),
            action: String(action).slice(0, 64),
            targetType: String(targetType).slice(0, 32),
            targetId: String(targetId).slice(0, 64),
            // Free-form context (names/emails of what was destroyed); capped
            // at the column width so oversized payloads can't reject the INSERT.
            details: details !== undefined && details !== null ? String(details).slice(0, 255) : null,
        });
    } catch (err) {
        logger.error('Failed to create admin audit entry:', err.message);
        return null;
    }
};

module.exports = { recordAudit };
