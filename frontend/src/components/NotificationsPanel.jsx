import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Bell, CheckCircle, XCircle, CalendarPlus, RefreshCw,
  Ban, AlertTriangle, PartyPopper, Inbox, CheckCheck
} from 'lucide-react';
import { useToast } from '../context/ToastContext.jsx';

/**
 * Maps a notification `type` to an icon + short label. Unknown types fall back
 * to a generic bell so the panel never crashes on future server-side types.
 */
const TYPE_META = {
  'booking.new':         { Icon: CalendarPlus,   label: 'New booking', tone: 'info' },
  'booking.confirmed':   { Icon: CheckCircle,    label: 'Confirmed',   tone: 'success' },
  'booking.declined':    { Icon: XCircle,        label: 'Declined',    tone: 'danger' },
  'booking.completed':   { Icon: PartyPopper,    label: 'Completed',   tone: 'success' },
  'booking.cancelled':   { Icon: Ban,            label: 'Cancelled',   tone: 'danger' },
  'booking.no-show':     { Icon: AlertTriangle,  label: 'No-show',     tone: 'warning' },
  'booking.rescheduled': { Icon: RefreshCw,      label: 'Rescheduled', tone: 'info' },
};

const metaForType = (type) => TYPE_META[type] || { Icon: Bell, label: 'Update', tone: 'info' };

/** Compact relative time — "just now", "5m ago", "3h ago", "2d ago", else date. */
function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Reusable notifications list shared by the customer and salon dashboards.
 * Fetches GET /api/notifications on mount (auth token rides axios defaults),
 * supports per-item "Mark read" (PATCH /:id/read) and "Mark all read"
 * (POST /read-all). Calls onUnreadChange(count) whenever the unread total
 * changes so a parent can badge its own toggle/nav button.
 */
export default function NotificationsPanel({ onUnreadChange }) {
  const showToast = useToast();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const reportUnread = useCallback((rows) => {
    if (onUnreadChange) onUnreadChange(rows.filter(n => !n.readAt).length);
  }, [onUnreadChange]);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await axios.get('/api/notifications');
      // Bare array by default; ?page/?limit would return an envelope — handle both.
      const rows = Array.isArray(res.data) ? res.data : (res.data.data || []);
      setNotifications(rows);
      reportUnread(rows);
    } catch (err) {
      console.error('Error fetching notifications', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [reportUnread]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkRead = async (id) => {
    try {
      await axios.patch(`/api/notifications/${id}/read`);
      setNotifications(prev => {
        const next = prev.map(n => (
          n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n
        ));
        reportUnread(next);
        return next;
      });
    } catch (err) {
      showToast('Could not mark notification as read', 'error');
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await axios.post('/api/notifications/read-all');
      setNotifications(prev => {
        const now = new Date().toISOString();
        const next = prev.map(n => ({ ...n, readAt: n.readAt || now }));
        reportUnread(next);
        return next;
      });
      showToast('All notifications marked as read', 'success');
    } catch (err) {
      showToast('Could not mark all as read', 'error');
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter(n => !n.readAt).length;

  return (
    <div className="booking-panel">
      <div className="notifications-head">
        <h3 className="panel-title">Notifications</h3>
        <button
          onClick={handleMarkAllRead}
          disabled={markingAll || unreadCount === 0}
          className="btn btn-secondary btn-sm"
        >
          <CheckCheck size={14} /> Mark all read
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Loading notifications…</div>
      ) : loadError ? (
        <div style={{ textAlign: 'center', padding: '24px' }}>
          <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>Couldn't load notifications.</span>
          <button onClick={fetchNotifications} className="btn btn-primary btn-sm">Try again</button>
        </div>
      ) : notifications.length === 0 ? (
        <div className="notifications-empty">
          <Inbox size={32} />
          <p>You're all caught up — no notifications yet.</p>
        </div>
      ) : (
        <ul className="notifications-list">
          {notifications.map(n => {
            const { Icon, label, tone } = metaForType(n.type);
            const isUnread = !n.readAt;
            return (
              <li key={n.id} className={`notification-item ${isUnread ? 'is-unread' : ''}`}>
                <span className={`notification-icon tone-${tone}`} aria-hidden="true"><Icon size={18} /></span>
                <div className="notification-body">
                  <div className="notification-top">
                    <span className={`badge badge-${tone === 'info' ? 'info' : tone}`}>{label}</span>
                    {isUnread && <span className="notification-dot" title="Unread" aria-label="Unread" />}
                    <span className="notification-time">{relativeTime(n.createdAt)}</span>
                  </div>
                  <strong className="notification-title">{n.title}</strong>
                  {n.body && <p className="notification-text">{n.body}</p>}
                </div>
                {isUnread && (
                  <button
                    onClick={() => handleMarkRead(n.id)}
                    className="btn btn-secondary btn-sm notification-read-btn"
                    aria-label={`Mark "${n.title}" as read`}
                  >
                    Mark read
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
