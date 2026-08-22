const Notification = require('../models/notificationModel');
const { paginateQuery, buildMeta } = require('../utils/pagination');

/**
 * Map the authenticated caller to a notification recipient scope.
 * authMiddleware keeps both shapes on req.user: role-specific keys (userId /
 * salonId) and the normalized `id`. Customers receive notifications addressed
 * to their userId; salons to their salonId. Admin tokens carry no entity id,
 * so admins simply own zero notifications.
 */
const resolveRecipient = (user) => {
    if (!user || !user.role) return null;
    if (user.role === 'customer' && user.userId !== undefined && user.userId !== null) {
        return { recipientRole: 'customer', recipientId: Number(user.userId) };
    }
    if (user.role === 'salon' && user.salonId !== undefined && user.salonId !== null) {
        return { recipientRole: 'salon', recipientId: Number(user.salonId) };
    }
    return null;
};

// GET /api/notifications — list OWN notifications, newest first.
// Backward-compatible contract shared with the appointment listings:
// no page/limit params -> legacy bare array; either param -> envelope.
const listNotifications = async (req, res) => {
    try {
        const scope = resolveRecipient(req.user);
        if (!scope) {
            // Admin (or unrecognized principal): owns no notifications.
            const { requested } = paginateQuery(req);
            return res.status(200).json(requested
                ? { data: [], ...buildMeta(1, 10, 0) }
                : []);
        }

        const { requested, page, limit, offset } = paginateQuery(req);
        const findOpts = {
            where: scope,
            order: [['createdAt', 'DESC']],
        };

        if (!requested) {
            const rows = await Notification.findAll(findOpts);
            return res.status(200).json(rows);
        }

        const { rows, count } = await Notification.findAndCountAll({
            ...findOpts,
            limit,
            offset,
        });
        return res.status(200).json({ data: rows, ...buildMeta(page, limit, count) });
    } catch (error) {
        console.error('Error listing notifications:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// PATCH /api/notifications/:id/read — mark one of MY notifications read.
const markNotificationRead = async (req, res) => {
    try {
        const scope = resolveRecipient(req.user);
        if (!scope) return res.status(404).json({ message: 'Notification not found' });

        const notification = await Notification.findByPk(req.params.id);
        // 404 (not 403) for someone else's notification — no existence leak.
        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }
        if (
            notification.recipientRole !== scope.recipientRole ||
            Number(notification.recipientId) !== scope.recipientId
        ) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        if (!notification.readAt) {
            notification.readAt = new Date();
            await notification.save();
        }
        res.status(200).json({ message: 'Notification marked as read', notification });
    } catch (error) {
        console.error('Error marking notification read:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/notifications/read-all — mark ALL my unread as read.
const markAllNotificationsRead = async (req, res) => {
    try {
        const scope = resolveRecipient(req.user);
        if (!scope) return res.status(200).json({ message: 'No unread notifications', updated: 0 });

        const [updated] = await Notification.update(
            { readAt: new Date() },
            { where: { ...scope, readAt: null } }
        );
        res.status(200).json({ message: 'All notifications marked as read', updated });
    } catch (error) {
        console.error('Error marking all notifications read:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { resolveRecipient, listNotifications, markNotificationRead, markAllNotificationsRead };
