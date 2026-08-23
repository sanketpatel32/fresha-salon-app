/**
 * Waitlist endpoints (#30).
 *
 * Customer surface (mounted under /api/appointment/waitlist, customer-only):
 *   POST /      join a salon's waitlist for a day
 *   GET /       list MY entries, newest-first, legacy/envelope pagination
 *   DELETE /:id soft-leave (status='left', row kept)
 *
 * Salon surface (mounted under /api/salonsdashboard, salon-only):
 *   GET /waitlist?date=YYYY-MM-DD  own rows for that date, oldest-first,
 *                                  customer names joined manually (plain
 *                                  integer userId refs — no associations,
 *                                  same convention as notifications).
 *
 * Every handler scopes strictly to the token identity (req.user.userId /
 * req.user.salonId) — never a client-supplied id.
 */
const { Op } = require('sequelize');
const Waitlist = require('../models/waitlistModel');
const Salons = require('../models/salonsModel');
const User = require('../models/userModel');
const { paginateQuery, buildMeta } = require('../utils/pagination');

/** Today as YYYY-MM-DD in the SAME UTC frame rescheduleSchema compares in,
 * so route-schema and controller date gates can never contradict each other. */
const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * POST /waitlist — join a salon's waitlist for a day.
 * The zod schema has already coerced/bounded the body; the controller owns
 * the DB-backed rules: salon must exist and be active, date must be
 * today-or-later, and no duplicate ACTIVE (status='waiting') entry.
 */
const joinWaitlist = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { salonId, date } = req.body;
        // Schema defaults partySize to 1; belt-and-braces for direct calls.
        const partySize = req.body.partySize ?? 1;

        // Defense in depth: the route schema enforces this too, but the
        // controller is callable directly (tests/legacy callers), so the
        // rule lives here as well.
        if (date < todayStr()) {
            return res.status(400).json({ message: 'Waitlist date must be today or later' });
        }

        const salon = await Salons.findByPk(salonId);
        if (!salon) {
            return res.status(404).json({ message: 'Salon not found' });
        }
        // statusbar exists on Salons (default 'active') — an inactive salon
        // takes no more names. Reported as 404 so closed salons are not
        // distinguishable from unknown ones.
        if (salon.statusbar && salon.statusbar !== 'active') {
            return res.status(404).json({ message: 'Salon not found' });
        }

        // One ACTIVE entry per user+salon+date. A left/notified entry never
        // blocks rejoining — the customer gets a fresh queue position.
        const existing = await Waitlist.findOne({
            where: { userId, salonId, date, status: 'waiting' },
        });
        if (existing) {
            return res.status(409).json({ message: 'Already on the waitlist' });
        }

        const entry = await Waitlist.create({
            userId, // always the caller — never client-supplied
            salonId,
            date,
            partySize,
        });
        return res.status(201).json(entry);
    } catch (error) {
        console.error('Error joining waitlist:', error.message);
        return res.status(500).json({ message: 'Server error' });
    }
};

/**
 * GET /waitlist — my entries, newest-first.
 * Backward-compatible contract shared with every other listing:
 * no page/limit params -> legacy bare array; either param -> envelope.
 */
const getMyWaitlist = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { requested, page, limit, offset } = paginateQuery(req);

        const findOpts = {
            where: { userId },
            order: [['createdAt', 'DESC'], ['id', 'DESC']], // id tiebreak: deterministic order
        };

        if (!requested) {
            const rows = await Waitlist.findAll(findOpts);
            return res.status(200).json(rows);
        }

        const { rows, count } = await Waitlist.findAndCountAll({
            ...findOpts,
            limit,
            offset,
        });
        return res.status(200).json({ data: rows, ...buildMeta(page, limit, count) });
    } catch (error) {
        console.error('Error listing waitlist:', error.message);
        return res.status(500).json({ message: 'Server error' });
    }
};

/**
 * DELETE /waitlist/:id — SOFT leave: sets status='left', keeps the row (so
 * the salon's history and any prior notifiedAt stamp survive). Foreign or
 * unknown ids 404 — no existence leak, mirroring notifications mark-read.
 * Idempotent: leaving an already-left own row just stays 'left'.
 */
const leaveWaitlist = async (req, res) => {
    try {
        const entry = await Waitlist.findByPk(req.params.id);
        if (!entry || Number(entry.userId) !== Number(req.user.userId)) {
            return res.status(404).json({ message: 'Waitlist entry not found' });
        }

        entry.status = 'left';
        await entry.save();
        return res.status(200).json({ message: 'Left the waitlist', entry });
    } catch (error) {
        console.error('Error leaving waitlist:', error.message);
        return res.status(500).json({ message: 'Server error' });
    }
};

/**
 * GET /salonsdashboard/waitlist?date=YYYY-MM-DD — the salon's day sheet:
 * every waitlist row for OWN salon on that date, oldest-first (queue
 * order), each annotated with the customer's name via ONE batched users
 * query (userId is a plain integer ref — no association to include).
 */
const getSalonDayWaitlist = async (req, res) => {
    try {
        const salonId = req.user.salonId;
        const { date } = req.query; // validated (YYYY-MM-DD) at the route

        const rows = await Waitlist.findAll({
            where: { salonId, date },
            order: [['createdAt', 'ASC'], ['id', 'ASC']],
        });

        // Batched name lookup — no N+1, no FK needed.
        const userIds = [...new Set(rows.map((r) => r.userId))];
        const customers = userIds.length
            ? await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'name'] })
            : [];
        const nameById = new Map(customers.map((u) => [Number(u.id), u.name]));

        return res.status(200).json(
            rows.map((r) => ({
                ...r.toJSON(),
                customerName: nameById.get(Number(r.userId)) || null,
            }))
        );
    } catch (error) {
        console.error('Error listing salon waitlist:', error.message);
        return res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { joinWaitlist, getMyWaitlist, leaveWaitlist, getSalonDayWaitlist };
