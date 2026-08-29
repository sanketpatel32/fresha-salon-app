const appointmentModel = require('../models/appointmentModel');
const paymentModel = require('../models/paymentModel');
const servicesModel = require('../models/servicesModel');
const staffModel = require('../models/staffModel');
const { Op, fn, col, literal } = require('sequelize');

// ── Revenue analytics (#31) ───────────────────────────────────────────
// Pure helpers are exported for direct unit tests (same pattern as the
// reminder service's pickReminders): the window math and bucketing carry
// all the correctness weight, so they're testable without a live "now".

// YYYY-MM-DD in the SERVER-LOCAL frame (never toISOString, which is UTC and
// shifts the day near midnight). This is the frame every consumer of the
// DATEONLY/TIME columns parses dates in.
const localDateString = (d) => (
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
);

// Trailing `days` calendar days INCLUDING today, in the local frame.
// Returns the inclusive [start, end] Date boundaries (local midnight of the
// first day → end of today) plus every day's YYYY-MM-DD string, oldest-first.
const revenueWindow = (days, now = new Date()) => {
    const start = new Date(now);
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const dates = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dates.push(localDateString(d));
    }
    return { start, end, dates };
};

// round2: strip IEEE float dust after summing DECIMAL strings (100.50 + 49.50).
const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

// Bucket raw Payment rows (orderAmount/tipAmount/tipCaptured/discountAmount/
// createdAt) into a dense per-day series covering the window. Zero-revenue
// days stay as explicit entries so charts render gaps properly.
//
// BUCKETING APPROACH (deliberate): rows are fetched and grouped in JS rather
// than GROUP BY'ing a date function in SQL. Sequelize stores DATETIMEs as
// UTC; extracting the SERVER-LOCAL calendar day portably needs different raw
// expressions per dialect (SQLite strftime vs Postgres date_trunc/::date)
// and each handles timezones differently. ≤90 days of Success rows for ONE
// salon is a tiny set, so JS bucketing is dialect-proof and deterministic.
//
// Money semantics (#26): `revenue` is GROSS OF TIP — orderAmount already
// carries the added tip. `tips` only sums tipAmount where tipCaptured=1, so
// an uncaptured tip temporarily sits inside serviceRevenue until its booking
// finalizes. Discounts sum COALESCE(discountAmount, 0) (legacy null = none).
const buildRevenueSeries = (rows, days, now = new Date()) => {
    const { dates } = revenueWindow(days, now);
    const allowed = new Set(dates);
    // Dense zero-filled series first; fill from the rows afterwards.
    const byDate = new Map(dates.map((date) => [date, { date, revenue: 0, tips: 0, discounts: 0, bookings: 0 }]));
    for (const r of rows) {
        const key = localDateString(new Date(r.createdAt));
        const bucket = byDate.get(key);
        if (!bucket) continue; // row outside the window (defensive; WHERE already bounds it)
        bucket.revenue += parseFloat(r.orderAmount) || 0;
        if (Number(r.tipCaptured) === 1 && r.tipAmount != null) {
            bucket.tips += parseFloat(r.tipAmount) || 0;
        }
        bucket.discounts += r.discountAmount != null ? (parseFloat(r.discountAmount) || 0) : 0;
        bucket.bookings += 1;
    }
    const series = Array.from(byDate.values()).map((b) => ({
        date: b.date,
        revenue: round2(b.revenue),
        tips: round2(b.tips),
        discounts: round2(b.discounts),
        bookings: b.bookings,
    }));
    const totals = series.reduce(
        (acc, s) => ({
            revenue: acc.revenue + s.revenue,
            tips: acc.tips + s.tips,
            discounts: acc.discounts + s.discounts,
            bookings: acc.bookings + s.bookings,
        }),
        { revenue: 0, tips: 0, discounts: 0, bookings: 0 }
    );
    // Net-of-tip figure lives ONLY here, not on the lean per-day payloads.
    totals.serviceRevenue = round2(totals.revenue - totals.tips);
    return { series, totals };
};

// GET /api/salonsdashboard/analytics/revenue?days=N — daily revenue/tips/
// discounts/bookings for the trailing N days including today.
const getRevenueAnalytics = async (req, res) => {
    const salonId = req.user.salonId;
    const days = req.query.days; // coerced + clamped by analyticsWindowSchema at the route
    const { start, end } = revenueWindow(days);
    const rows = await paymentModel.findAll({
        where: {
            salonId, // token-scoped like every dashboard controller — no :id param to point elsewhere
            paymentStatus: 'Success', // exact gateway/webhook success string; Pending/'Slot taken' excluded
            createdAt: { [Op.gte]: start, [Op.lte]: end },
        },
        attributes: ['orderAmount', 'tipAmount', 'tipCaptured', 'discountAmount', 'createdAt'],
        raw: true,
    });
    res.status(200).json({ days, ...buildRevenueSeries(rows, days) });
};

// GET /api/salonsdashboard/analytics/top-services?days=N — top 5 services by
// COMPLETED booking count within the window. Data source decision: the
// Appointments table (it carries salonId + serviceId + a DATEONLY `date`),
// filtered to status='completed' ONLY — completed is the one status that
// proves the booking actually happened end-to-end, while pending/confirmed/
// cancelled would inflate counts with bookings that never occurred. The
// window uses the booking's own `date` column (DATEONLY strings compare
// correctly as plain text), not createdAt. Counts group via fn/COUNT in SQL
// (dialect-safe); names resolve in ONE IN-query and the count-desc /
// name-asc tiebreak is applied in JS so ordering is collation-independent.
const getTopServices = async (req, res) => {
    const salonId = req.user.salonId;
    const days = req.query.days; // same schema/clamp as the revenue endpoint
    const { dates } = revenueWindow(days);
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    const rows = await appointmentModel.findAll({
        where: {
            salonId,
            status: 'completed',
            date: { [Op.between]: [startDate, endDate] },
        },
        attributes: ['serviceId', [fn('COUNT', col('serviceId')), 'bookings']],
        group: ['serviceId'],
        raw: true,
    });

    const ids = rows.map((r) => r.serviceId);
    const services = ids.length
        ? await servicesModel.findAll({
            where: { id: { [Op.in]: ids } },
            attributes: ['id', 'name'],
            raw: true,
        })
        : [];
    const nameById = new Map(services.map((s) => [s.id, s.name]));

    // onDelete CASCADE removes appointments when their service dies, so an
    // unknown id shouldn't exist — degrade gracefully regardless.
    const payload = rows
        .map((r) => ({
            serviceId: r.serviceId,
            name: nameById.get(r.serviceId) || 'Unknown',
            bookings: parseInt(r.bookings, 10),
        }))
        .sort((a, b) => (b.bookings - a.bookings) || a.name.localeCompare(b.name))
        .slice(0, 5);

    res.status(200).json(payload);
};

// GET /api/salonsdashboard/analytics — KPI summary for the salon owner's dashboard.
// Returns: totalRevenue, statusCounts, topServices (top 3), bookingsPerDay (last 7 days).
const getAnalytics = async (req, res) => {
    const salonId = req.user.salonId;
    try {
        // Total revenue from successful payments for this salon.
        const revenueRow = await paymentModel.findOne({
            where: { salonId, paymentStatus: 'Success' },
            attributes: [[fn('SUM', col('orderAmount')), 'total']],
            raw: true,
        });
        const totalRevenue = revenueRow && revenueRow.total ? parseFloat(revenueRow.total) : 0;

        // Appointment counts grouped by status.
        const statusRows = await appointmentModel.findAll({
            where: { salonId },
            attributes: ['status', [fn('COUNT', col('*')), 'count']],
            group: ['status'],
            raw: true,
        });
        const statusCounts = { pending: 0, confirmed: 0, completed: 0, cancelled: 0, declined: 0 };
        statusRows.forEach(r => { statusCounts[r.status] = parseInt(r.count, 10); });

        // Top 3 services by booking count.
        const topServiceRows = await appointmentModel.findAll({
            where: { salonId },
            attributes: ['serviceId', [fn('COUNT', col('serviceId')), 'count']],
            include: [{ model: servicesModel, as: 'service', attributes: ['name'] }],
            group: ['serviceId'],
            order: [[literal('count'), 'DESC']],
            limit: 3,
            raw: true,
        });
        const topServices = topServiceRows.map(r => ({ name: r['service.name'], count: parseInt(r.count, 10) }));

        // Bookings per day for the last 7 days (including today).
        const today = new Date();
        const sevenAgo = new Date(today.getTime() - 6 * 24 * 3600 * 1000);
        const fromDate = sevenAgo.toISOString().slice(0, 10);
        const dayRows = await appointmentModel.findAll({
            where: { salonId, date: { [Op.gte]: fromDate } },
            attributes: ['date', [fn('COUNT', col('*')), 'count']],
            group: ['date'],
            order: [['date', 'ASC']],
            raw: true,
        });
        // Fill in zero-count days for a continuous 7-day series.
        const bookingsPerDay = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today.getTime() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
            const found = dayRows.find(r => r.date === d);
            bookingsPerDay.push({ date: d, count: found ? parseInt(found.count, 10) : 0 });
        }

        res.status(200).json({ totalRevenue, statusCounts, topServices, bookingsPerDay });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/salonsdashboard/calendar?week=YYYY-MM-DD — bookings for the 7-day week containing the given date.
const getCalendar = async (req, res) => {
    const salonId = req.user.salonId;
    try {
        const weekStart = req.query.week
            ? new Date(req.query.week)
            : new Date();
        if (Number.isNaN(weekStart.getTime())) {
            return res.status(400).json({ message: 'Invalid week date' });
        }
        // Normalize to the Monday of that week.
        const dayOfWeek = (weekStart.getDay() + 6) % 7; // Mon=0 ... Sun=6
        const monday = new Date(weekStart);
        monday.setDate(weekStart.getDate() - dayOfWeek);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const fromStr = monday.toISOString().slice(0, 10);
        const toStr = sunday.toISOString().slice(0, 10);

        const appointments = await appointmentModel.findAll({
            where: { salonId, date: { [Op.between]: [fromStr, toStr] } },
            include: [
                { model: staffModel, as: 'staff', attributes: ['id', 'name'] },
                { model: servicesModel, as: 'service', attributes: ['name'] },
                { model: require('../models/userModel'), as: 'user', attributes: ['name'] },
            ],
            order: [['date', 'ASC'], ['time', 'ASC']],
        });

        res.status(200).json(appointments);
    } catch (error) {
        console.error('Error fetching calendar:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

/**
 * Cancellation reasons (#60) — why this salon is losing bookings.
 *
 * A cancellation COUNT tells a salon something is wrong; the REASON tells them
 * what. "12 cancellations" is a bad month, but "9 of them were schedule
 * conflicts at 6pm" is a staffing decision, and "9 were too-expensive" is a
 * pricing one. Those need opposite responses, and without the breakdown a
 * salon will guess — usually wrong.
 *
 * The rate (cancelled ÷ total) is included because the raw count is
 * meaningless on its own: 12 cancellations out of 400 visits is a good month,
 * out of 30 is an emergency.
 *
 * Only CUSTOMER cancellations carry a reason (see cancelAppointment), so the
 * "unspecified" bucket absorbs salon-side cancellations and every cancellation
 * recorded before this feature existed — it is explicitly reported rather than
 * hidden, because a large unspecified bucket is itself a signal (the bucket
 * shrinks over time as more customers pick a reason).
 */
const getCancellationReasons = async (req, res) => {
    try {
        const salonId = req.user.salonId;
        const days = Number(req.query.days) || 30;
        // revenueWindow returns Date objects (start/end) for DATETIME columns
        // plus the YYYY-MM-DD strings it covers. `Appointments.date` is a
        // DATEONLY/string column, so the window boundary used here has to be
        // the STRING, not `start` — and it has to be destructured by the name
        // the helper actually exposes. Reaching for a `from` that doesn't
        // exist silently yields `undefined`, which Sequelize compiles into a
        // comparison that matches nothing: an empty dashboard that looks like
        // "no cancellations" rather than the bug it is.
        const { dates } = revenueWindow(days);
        const from = dates[0];

        const rows = await appointmentModel.findAll({
            where: {
                salonId,
                status: 'cancelled',
                date: { [Op.gte]: from },
            },
            attributes: ['cancellationReason'],
            raw: true,
        });

        const totalInWindow = await appointmentModel.count({
            where: { salonId, date: { [Op.gte]: from } },
        });

        const counts = new Map();
        for (const row of rows) {
            // Null/empty → the "unspecified" bucket, reported honestly.
            const key = row.cancellationReason || 'unspecified';
            counts.set(key, (counts.get(key) || 0) + 1);
        }

        const cancelled = rows.length;
        const breakdown = [...counts.entries()]
            .map(([reason, count]) => ({
                reason,
                count,
                // Share of cancellations (not of all bookings) — "why did the
                // ones that fell through fall through?"
                shareOfCancellations: cancelled > 0 ? round2((count / cancelled) * 100) : 0,
            }))
            .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

        return res.status(200).json({
            window: { days, from },
            totalAppointments: totalInWindow,
            cancelled,
            cancellationRate: totalInWindow > 0 ? round2((cancelled / totalInWindow) * 100) : 0,
            reasons: breakdown,
            // The single most useful line in the response, computed here so
            // every client says the same thing.
            topReason: breakdown.length > 0 ? breakdown[0].reason : null,
        });
    } catch (error) {
        console.error('Error fetching cancellation reasons:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    getAnalytics,
    getCalendar,
    getRevenueAnalytics,
    getTopServices,
    getCancellationReasons,
    // pure helpers, exported for tests
    localDateString,
    revenueWindow,
    buildRevenueSeries,
};
