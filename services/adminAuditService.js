/**
 * Audit trail — single fire-and-forget entry point.
 *
 * Contract mirrors notificationService.notify(): `recordAudit()` NEVER throws
 * into the caller's flow. Every failure is caught and logged via the
 * structured logger so a broken audit write can never break (or roll back) an
 * operation that already succeeded. Callers may call it without awaiting; it is
 * awaitable only so tests (and anyone who cares) can wait for the write.
 *
 * Extended in #52 from admin-only to any actor: the useful questions ("which
 * staff member marked this no-show?", "which salon edited this promo after it
 * went live?") are all about non-admin actors, and admin-only coverage left
 * them unanswerable.
 */
const logger = require('../utils/logger');

let AdminAudit;
try {
    AdminAudit = require('../models/adminAuditModel');
} catch (err) {
    AdminAudit = null;
}

/** Column widths, mirrored from the model so oversized values truncate here. */
const LIMITS = Object.freeze({ action: 64, targetType: 32, targetId: 64, details: 255, userAgent: 255, ip: 45 });

/** Truncate a value to a column width, tolerating null/undefined. */
const fit = (value, max) => (value === undefined || value === null ? null : String(value).slice(0, max));

/**
 * Pull the best available client IP from a request.
 *
 * Trusts X-Forwarded-For only because `trust proxy` is set on the app (see
 * app.js); without that, req.ip is the proxy itself. Takes the FIRST entry,
 * which is the original client — later entries are proxies the request passed
 * through, and any of them can be spoofed by the client.
 */
const clientIpFrom = (req) => {
    if (!req) return null;
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
        const first = xff.split(',')[0].trim();
        if (first) return first;
    }
    return req.ip || req.socket?.remoteAddress || null;
};

/**
 * Record an audit entry.
 *
 * @param {object} params
 * @param {object|string} params.actor   Either a req.user-shaped object
 *   ({ role, id, email }) or an email string (legacy admin callers).
 * @param {string} params.action         Dotted verb, e.g. 'appointment.cancel'.
 * @param {string} params.targetType     'user' | 'appointment' | 'service' | ...
 * @param {string|number} params.targetId
 * @param {string} [params.details]      Free-form context.
 * @param {object} [params.req]          Express request, for ip + user agent.
 */
const recordAudit = async ({ actor, adminEmail, action, targetType, targetId, details, req }) => {
    try {
        if (!AdminAudit) throw new Error('admin audit model unavailable');
        if (!action || !targetType || targetId === undefined || targetId === null) return null;

        // Accept both the new `actor` object and the legacy `adminEmail` string.
        const actorObj = typeof actor === 'string' ? { role: 'admin', email: actor } : (actor || {});
        const role = actorObj.role || (adminEmail ? 'admin' : 'system');
        const email = actorObj.email || adminEmail || `role:${role}`;

        return await AdminAudit.create({
            adminEmail: fit(email, 255),
            actorRole: fit(role, 16),
            actorId: actorObj.id === undefined || actorObj.id === null ? null : fit(actorObj.id, LIMITS.actorId ?? 64),
            action: fit(action, LIMITS.action),
            targetType: fit(targetType, LIMITS.targetType),
            targetId: fit(targetId, LIMITS.targetId),
            details: fit(details, LIMITS.details),
            ip: fit(clientIpFrom(req), LIMITS.ip),
            userAgent: fit(req?.headers?.['user-agent'], LIMITS.userAgent),
        });
    } catch (err) {
        logger.error('Failed to create audit entry:', err.message);
        return null;
    }
};

/**
 * Convenience wrapper: audit an action taken by the currently authenticated
 * user, deriving actor identity and request context from `req`.
 *
 *   await auditRequest(req, 'appointment.no_show', 'appointment', appt.id);
 */
const auditRequest = (req, action, targetType, targetId, details) =>
    recordAudit({
        actor: req?.user,
        action,
        targetType,
        targetId,
        details,
        req,
    });

module.exports = { recordAudit, auditRequest, clientIpFrom, LIMITS };
