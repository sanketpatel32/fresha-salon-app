/**
 * Waitlist service (#30).
 *
 * findNextWaitlistEntry(salonId, date, freedPartySize) is the auto-notify
 * hook fired (fire-and-forget) after a cancellation write succeeds: it picks
 * the OLDEST 'waiting' entry for that salon+date whose partySize fits inside
 * the freed capacity, flips it to 'notified', and sends the customer an
 * in-app alert. Entries too large for the freed slot are SKIPPED (not
 * blocking) — a 6-person queue behind a freed 2-top shouldn't starve the
 * couple waiting behind them.
 *
 * Contract mirrors notificationService/loyaltyService: NEVER throws into the
 * caller's flow. Every failure is caught and logged; the caller may call it
 * without awaiting (it is awaitable only so tests can wait for the writes).
 * Claiming is atomic — the status flip happens via UPDATE ... WHERE
 * status='waiting' (claim-first, like loyalty #27 / reminders #29), so two
 * concurrent cancellations can never both notify the same entry.
 */
const { Op } = require('sequelize');
const Waitlist = require('../models/waitlistModel');
const Salons = require('../models/salonsModel');
const { notify } = require('./notificationService');
const logger = require('../utils/logger');

const findNextWaitlistEntry = async (salonId, date, freedPartySize) => {
    try {
        if (!salonId || !date || !freedPartySize) return null;

        // Oldest eligible waiter: still 'waiting' AND small enough to fit.
        // id as tiebreak so same-millisecond inserts order deterministically.
        const entry = await Waitlist.findOne({
            where: {
                salonId,
                date,
                status: 'waiting',
                partySize: { [Op.lte]: freedPartySize },
            },
            order: [['createdAt', 'ASC'], ['id', 'ASC']],
        });
        if (!entry) return null;

        // Atomic claim: only the update that sees status='waiting' wins, so
        // concurrent cancellations can't double-notify this entry.
        const [claimed] = await Waitlist.update(
            { status: 'notified', notifiedAt: new Date() },
            { where: { id: entry.id, status: 'waiting' } }
        );
        if (!claimed) return null; // someone else claimed it first

        entry.status = 'notified';
        entry.notifiedAt = new Date();

        // The alert names the salon + date so the customer knows where and
        // when to act. One cheap read; missing name degrades gracefully.
        const salon = await Salons.findByPk(salonId, { attributes: ['name'] });

        await notify({
            recipientRole: 'customer',
            recipientId: entry.userId,
            type: 'waitlist.opening',
            title: 'A slot opened up',
            body: `${salon && salon.name ? salon.name : 'The salon'} has an opening on ${entry.date}`,
        });
        return entry;
    } catch (err) {
        logger.error('Waitlist notify failed:', err.message);
        return null;
    }
};

module.exports = { findNextWaitlistEntry };
