/**
 * Reminder emails service (#29).
 *
 * Rule: a booking that is still pending|confirmed and starts within the next
 * REMINDER_WINDOW_HOURS gets ONE reminder email. The deterministic window is
 * deliberately simple — "start strictly after now AND start <= now+24h" — so
 * pickReminders is a pure function of (rows, now) and trivially testable at
 * its boundaries.
 *
 * Exactly-once: mirroring loyalty (#27), the sweep CLAIMS each booking by
 * stamping nullable reminderSentAt FIRST and only then sending. A crash
 * between the two writes can only SKIP one reminder (at-most-once), never
 * double-send; the candidate query filters stamped rows out, so restarts and
 * overlapping sweeps are naturally idempotent. An unconfigured mailer still
 * counts as handled ({ sent:false, reason:'not-configured' }) — the stamp is
 * about "we dealt with this booking", not about SMTP succeeding.
 *
 * Contract mirrors notificationService/loyaltyService: runReminderSweep never
 * throws into its caller (the app.js scheduler); every failure is caught,
 * logged, and summarized in the return value.
 */
const { Op } = require('sequelize');
const Appointment = require('../models/appointmentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Services = require('../models/servicesModel');
const logger = require('../utils/logger');

// Required lazily as a NAMESPACE (not destructured) so tests can stub
// emailService.sendAppointmentReminderEmail before/after either module is
// loaded — the property is read at call time.
const emailService = require('./emailService');

const REMINDER_WINDOW_HOURS = 24;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

const pad = (n) => String(n).padStart(2, '0');
/** Local calendar date string (YYYY-MM-DD) — matches the DATEONLY frame. */
const localDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Pure filter: which of these appointment rows are due for a reminder?
 * A row qualifies when it has not been reminded yet (reminderSentAt null)
 * AND its start datetime (built from the DATEONLY date + TIME time fields
 * exactly like cancel/reschedule/no-show do) satisfies:
 *   start strictly after now  AND  start <= now + REMINDER_WINDOW_HOURS.
 *
 * @param {Array<object>} rows - appointment rows exposing date/time/reminderSentAt
 * @param {Date|number|string} [now] - injectable clock for determinism
 * @returns {Array<object>} the due rows, same order as given
 */
function pickReminders(rows, now = new Date()) {
    const nowMs = new Date(now).getTime();
    const horizonMs = nowMs + REMINDER_WINDOW_HOURS * 3600 * 1000;
    return (rows || []).filter((row) => {
        if (!row || row.reminderSentAt) return false; // already claimed/reminded
        const startMs = new Date(`${row.date}T${row.time}`).getTime();
        if (Number.isNaN(startMs)) return false; // unparseable slot → never remind
        // Strictly after now (a just-started booking is too late to remind
        // about) and within the window inclusive of the exact horizon.
        return startMs > nowMs && startMs <= horizonMs;
    });
}

/**
 * One sweep: find candidates, pick the due ones, stamp + email each.
 * Safe to await from tests/scheduler: never rejects. Returns a summary:
 * { candidates, due, reminded } where reminded counts rows actually claimed
 * this sweep (stamping counts as handled even when the mailer is unconfigured).
 */
const runReminderSweep = async (now = new Date()) => {
    try {
        const nowDate = new Date(now);
        // Candidates: live bookings nobody has reminded yet. The date upper
        // bound is a cheap superset prefilter (any start within [now,
        // now+24h] must fall on or before the horizon's LOCAL calendar day);
        // pickReminders does the exact filtering in JS because start is a
        // DATEONLY+TIME pair that can't be compared as one datetime portably.
        const horizon = new Date(nowDate.getTime() + REMINDER_WINDOW_HOURS * 3600 * 1000);
        const candidates = await Appointment.findAll({
            where: {
                status: { [Op.in]: ['confirmed', 'pending'] },
                reminderSentAt: null,
                date: { [Op.lte]: localDateStr(horizon) },
            },
            include: [
                { model: User, as: 'user', attributes: ['email'] },
                { model: Salons, as: 'salon', attributes: ['name'] },
                { model: Services, as: 'service', attributes: ['name'] },
            ],
            order: [['date', 'ASC'], ['time', 'ASC']],
        });

        const due = pickReminders(candidates, nowDate);
        let reminded = 0;
        for (const row of due) {
            try {
                // Claim-first: stamp BEFORE sending (at-most-once semantics).
                // A failed stamp skips the send — never risk a double-mail.
                // The stamp is a CONDITIONAL update (only when still null) so
                // two overlapping sweeps can't both claim the same row —
                // instance.save() is UPDATE ... WHERE id only, which lets a
                // slow sweep (many sends) race the next interval and
                // double-mail.
                const [claimed] = await Appointment.update(
                    { reminderSentAt: new Date() },
                    { where: { id: row.id, reminderSentAt: null } }
                );
                if (claimed === 0) continue; // another sweep already claimed it

                await emailService.sendAppointmentReminderEmail(row.user?.email, {
                    salonName: row.salon?.name,
                    serviceName: row.service?.name,
                    date: row.date,
                    time: row.time,
                }).catch((err) => {
                    // The helper itself never rejects; belt-and-braces anyway.
                    logger.error(`Reminder email failed for appointment ${row.id}:`, err.message);
                });
                reminded += 1; // stamped = handled (not-configured included)
            } catch (err) {
                // One bad row must never abort the rest of the sweep.
                logger.error(`Reminder processing failed for appointment ${row.id}:`, err.message);
            }
        }

        console.log(`⏰ Reminder sweep: ${due.length} due of ${candidates.length} candidates — ${reminded} reminded`);
        return { candidates: candidates.length, due: due.length, reminded };
    } catch (err) {
        logger.error('Reminder sweep failed:', err.message);
        return { candidates: 0, due: 0, reminded: 0 };
    }
};

/**
 * Whether the app-level scheduler may start (app.js wiring). REMINDERS_DISABLED=1
 * opts tests/CI out entirely. Exposed as a pure function of the env so the
 * guard is assertable without ever loading app.js (which binds a port).
 */
function isSchedulerEnabled(env = process.env) {
    return env.REMINDERS_DISABLED !== '1';
}

module.exports = {
    REMINDER_WINDOW_HOURS,
    SWEEP_INTERVAL_MS,
    pickReminders,
    runReminderSweep,
    isSchedulerEnabled,
};
