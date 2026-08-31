const appointmentModel = require('../models/appointmentModel');
const staffModel = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Salons = require('../models/salonsModel');
const userModel = require('../models/userModel');
const Payment = require('../models/paymentModel');
const StaffBlockout = require('../models/staffBlockoutModel');
const { Op } = require('sequelize');
const { canTransition, canCancel, canReschedule } = require('../utils/statusRules');
const { paginateQuery, buildMeta } = require('../utils/pagination');
const { toCsv } = require('../utils/csv');
const sequelize = require('../utils/database');
const { notify } = require('../services/notificationService');
const { findNextWaitlistEntry } = require('../services/waitlistService');
const { sendBookingStatusEmail } = require('../services/emailService');
const { awardForCompletedAppointment } = require('../services/loyaltyService');
const {
  computeEndTime,
  validateSalonHours,
  validateLeadTime,
  resolveSlotStepMinutes,
  getEffectiveWeeklyHours,
  staffForService,
  conflictingStaffIds,
} = require('../services/availabilityService');
// #55 / #56 / #61 — rebook suggestions, pre-payment quotes, recurring series.
const { findRebookSlot, isRebookable } = require('../services/rebookService');
const { buildQuote } = require('../services/quoteService');
const { createSeries, listSeries, setSeriesStatus } = require('../services/recurringService');

/**
 * Recompute and persist the denormalized avgRating + reviewCount for a salon.
 * Called after a customer review is written/edited so the browse endpoint's
 * rating filter/sort stays correct without a live aggregation on every request.
 */
const refreshSalonRatingCache = async (salonId) => {
    if (!salonId) return;
    const rows = await appointmentModel.findAll({
        where: { salonId, rating: { [Op.ne]: null } },
        attributes: [
            [sequelize.fn('AVG', sequelize.col('rating')), 'avgRating'],
            [sequelize.fn('COUNT', sequelize.col('rating')), 'reviewCount'],
        ],
        raw: true,
    });
    const agg = rows[0];
    await Salons.update(
        {
            avgRating: agg && agg.avgRating ? parseFloat(agg.avgRating).toFixed(2) : null,
            reviewCount: agg && agg.reviewCount ? parseInt(agg.reviewCount, 10) : 0,
        },
        { where: { id: salonId } }
    );
};

const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Checks staff availability for a given service, date, and time.
// Enforces salon working hours/days AND staff conflicts. The conflict
// detection logic lives in services/availabilityService.js and is shared with
// the payment finalization path so the rule cannot drift between them.
const appointmentChecker = async (req, res) => {
    try {
        const { dateSelect, time, salonId, serviceId, duration } = req.body;

        const startTime = time;
        const endTime = computeEndTime(time, duration);

        // Salon-hours gate. The model stores openingTime/closingTime/workingDays;
        // before this change they were display-only and never consulted.
        const salon = await Salons.findByPk(salonId);
        if (!salon) {
            return res.status(404).json({ message: 'Salon not found' });
        }
        const hoursCheck = validateSalonHours(salon, dateSelect, startTime, endTime);
        if (!hoursCheck.ok) {
            return res.status(400).json({ message: hoursCheck.reason });
        }
        // Lead-time gate: the slot must start at least the salon's configured
        // number of minutes from now (same rule the payment path enforces).
        const leadCheck = validateLeadTime(salon, dateSelect, startTime);
        if (!leadCheck.ok) {
            return res.status(400).json({ message: leadCheck.reason });
        }

        // Staff who provide this service in this salon.
        const eligibleStaff = await staffForService(salonId, serviceId);
        const staffIds = eligibleStaff.map((s) => s.id);

        // Filter out staff with a blockout or existing booking that overlaps.
        const conflicted = await conflictingStaffIds(staffIds, salonId, dateSelect, startTime, endTime);
        const freeStaff = eligibleStaff.filter((s) => !conflicted.has(s.id));

        // There is no server-side slot generation — clients pick times
        // directly — so the configured slot grid is exposed informationally:
        // frontends align their time pickers to it.
        res.status(200).json({
            availableStaff: freeStaff,
            slotStepMinutes: resolveSlotStepMinutes(salon),
            // Informational: the effective per-day schedule (stored overrides
            // merged over legacy defaults) so clients can grey out closed
            // days / off-hours before submitting. Additive only.
            weeklyHours: getEffectiveWeeklyHours(salon),
        });
    } catch (error) {
        console.error('Error in appointmentChecker:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

const getAllAppointmentsByUserId = async (req, res) => {
    // Always scope to the authenticated customer — never trust a query param.
    const userId = req.user.userId;

    try {
        // Backward compat: no page/limit params -> legacy bare-array response.
        // (The frontend also sends an unrelated userId param; only page/limit
        // opt into the paginated envelope.)
        const { requested, page, limit, offset } = paginateQuery(req);

        // ── History filters (#57) ──────────────────────────────────────
        // status / date range / salon, all optional and ANDed together.
        // Applied by ADDING to the where clause rather than replacing it, so
        // the userId scope above can never be dropped by a future edit — the
        // single most important property of a customer listing.
        const where = { userId };
        if (req.query.status) where.status = req.query.status;
        if (req.query.salonId) where.salonId = req.query.salonId;
        // date is DATEONLY, so a plain string comparison against YYYY-MM-DD
        // is an exact, index-friendly range — no timezone conversion needed
        // (the column is a wall-clock calendar date, same as the filter).
        if (req.query.from || req.query.to) {
            where.date = {};
            if (req.query.from) where.date[Op.gte] = req.query.from;
            if (req.query.to) where.date[Op.lte] = req.query.to;
        }

        const findOpts = {
            where,
            include: [
                {
                    model: staffModel,
                    as: 'staff',
                    attributes: ['name', 'phoneNumber'],
                },
                {
                    model: Services,
                    as: 'service',
                    attributes: ['name'],
                },
                {
                    model: Salons,
                    as: 'salon',
                    attributes: ['name'],
                },
            ],
            ...(requested ? { order: [['date', 'DESC'], ['time', 'DESC']] } : {}),
        };

        if (!requested) {
            const appointments = await appointmentModel.findAll(findOpts);
            return res.status(200).json(appointments);
        }

        const { rows, count } = await appointmentModel.findAndCountAll({
            ...findOpts,
            limit,
            offset,
            distinct: true, // guard the count against join row multiplication
        });

        return res.status(200).json({ data: rows, ...buildMeta(page, limit, count) });
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// The authenticated customer's NEXT appointments (status pending|confirmed,
// start datetime strictly in the future), soonest first, capped at 5.
// Bare-array response for drop-in frontend consumption. Scoped strictly to
// req.user.userId like every customer listing — never a query param.
const getUpcomingAppointments = async (req, res) => {
    const userId = req.user.userId;

    try {
        // date/time are separate DATEONLY/TIME columns, so "start > now" is
        // expressed as two SQL branches over the LOCAL calendar frame (same
        // frame every other consumer parses these fields in):
        //   date > today   OR   (date = today AND time > current-time-of-day)
        // This filters exactly in SQL, so LIMIT 5 applies AFTER the cutoff
        // rather than truncating before it. String comparison is safe: both
        // columns hold zero-padded HH:mm[:ss]-style values.
        const pad = (n) => String(n).padStart(2, '0');
        const now = new Date();
        const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        const rows = await appointmentModel.findAll({
            where: {
                userId,
                status: { [Op.in]: ['pending', 'confirmed'] },
                [Op.or]: [
                    { date: { [Op.gt]: today } },
                    { date: today, time: { [Op.gt]: nowTime } },
                ],
            },
            include: [
                {
                    model: staffModel,
                    as: 'staff',
                    attributes: ['name', 'phoneNumber'],
                },
                {
                    model: Services,
                    as: 'service',
                    attributes: ['name'],
                },
                {
                    model: Salons,
                    as: 'salon',
                    attributes: ['name'],
                },
            ],
            order: [['date', 'ASC'], ['time', 'ASC']],
            limit: 5,
        });

        return res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching upcoming appointments:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

const getScheduledAppointmentsBySalonId = async (req, res) => {
    const salonId = req.user.salonId;
    try {
        const { requested, page, limit, offset } = paginateQuery(req);

        const findOpts = {
            where: { salonId },
            include: [
                {
                    model: staffModel,
                    as: 'staff',
                    attributes: ['name', 'phoneNumber'],
                },
                {
                    model: Services,
                    as: 'service',
                    attributes: ['name'],
                },
                {
                    model: Salons,
                    as: 'salon',
                    attributes: ['name'],
                },
                {
                    model: userModel,
                    as: 'user',
                    attributes: ['name', 'phoneNumber'],
                },
            ],
            ...(requested ? { order: [['date', 'DESC'], ['time', 'DESC']] } : {}),
        };

        if (!requested) {
            const appointments = await appointmentModel.findAll(findOpts);
            return res.status(200).json(appointments);
        }

        const { rows, count } = await appointmentModel.findAndCountAll({
            ...findOpts,
            limit,
            offset,
            distinct: true,
        });

        return res.status(200).json({ data: rows, ...buildMeta(page, limit, count) });
    } catch (error) {
        console.error('Error fetching scheduled appointments:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Export ALL of the salon's own appointments as RFC-4180 CSV. Mirrors
// getScheduledAppointmentsBySalonId's related-data includes, but with no
// pagination cap and ascending chronological order (spreadsheet-friendly).
// Note: no Amount column — the appointments table stores no price; prices live
// on services (mutable over time) and payments (null orderId on legacy rows),
// so no reliably historical amount is available on these rows.
const exportAppointmentsCsv = async (req, res) => {
    const salonId = req.user.salonId;
    try {
        // Query validation (csvExportSchema) runs at the route level; from/to
        // arrive as validated YYYY-MM-DD strings or undefined.
        const { from, to } = req.query;

        const where = { salonId };
        if (from !== undefined || to !== undefined) {
            where.date = {
                ...(from !== undefined ? { [Op.gte]: from } : {}),
                ...(to !== undefined ? { [Op.lte]: to } : {}),
            };
        }

        const appointments = await appointmentModel.findAll({
            where,
            order: [['date', 'ASC'], ['time', 'ASC']],
            include: [
                {
                    model: staffModel,
                    as: 'staff',
                    attributes: ['name'],
                },
                {
                    model: Services,
                    as: 'service',
                    attributes: ['name'],
                },
                {
                    model: userModel,
                    as: 'user',
                    attributes: ['name'],
                },
            ],
        });

        const rows = appointments.map((a) => ({
            id: a.id,
            date: a.date,
            time: a.time,
            endTime: a.endTime,
            status: a.status,
            partySize: a.partySize,
            service: a.service ? a.service.name : '',
            staff: a.staff ? a.staff.name : '',
            customer: a.user ? a.user.name : '',
        }));

        const csv = toCsv(rows, [
            { key: 'id', label: 'AppointmentID' },
            { key: 'date', label: 'Date' },
            { key: 'time', label: 'Time' },
            { key: 'endTime', label: 'EndTime' },
            { key: 'status', label: 'Status' },
            // Group bookings: how many people this booking covers (1 for solo).
            { key: 'partySize', label: 'PartySize' },
            { key: 'service', label: 'Service' },
            { key: 'staff', label: 'Staff' },
            { key: 'customer', label: 'Customer' },
        ]);

        const stamp = new Date().toISOString().slice(0, 10).split('-').join('');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="appointments-${salonId}-${stamp}.csv"`);
        return res.status(200).send(csv);
    } catch (error) {
        console.error('Error exporting appointments CSV:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Sends appointment details to the customer via email (Brevo).
// Delegates to services/emailService.js, which lazily initializes Brevo and
// no-ops when keys are absent. Kept as an endpoint for manual re-send; the
// payment success path also fires a confirmation automatically.
const mailAppointment = async (req, res) => {
    const { orderId } = req.body;
    if (!orderId || typeof orderId !== 'string') {
        return res.status(400).json({ message: "orderId is required" });
    }

    try {
        const order = await Payment.findOne({
            where: { orderId },
            include: [
                { model: staffModel, as: 'staff', attributes: ['name', 'phoneNumber'] },
                { model: Services, as: 'service', attributes: ['name'] },
                { model: Salons, as: 'salon', attributes: ['name'] },
            ],
        });
        if (!order) return res.status(404).json({ message: "Order not found" });
        // Ownership — same access rule as viewing the payment: without this,
        // any authenticated customer who learns an orderId can email-bomb
        // another customer's mailbox via repeated re-sends.
        const { canAccessPayment } = require('./paymentController');
        if (!canAccessPayment(order, req.user)) {
            return res.status(403).json({ message: "Not authorized to email this booking" });
        }

        const customer = await userModel.findOne({ where: { id: order.customerID } });
        if (!customer) return res.status(404).json({ message: "Customer not found" });

        const { sendBookingConfirmation } = require('../services/emailService');
        const result = await sendBookingConfirmation({
            order: order.toJSON(),
            customer: customer.toJSON(),
            staff: order.staff,
            service: order.service,
            salon: order.salon,
        });
        if (result.sent) {
            res.status(200).json({ message: "Email sent successfully" });
        } else if (result.reason === 'not-configured') {
            res.status(200).json({ message: "Email not configured — skipping" });
        } else {
            res.status(500).json({ error: "Failed to send email" });
        }
    } catch (error) {
        console.error("❌ Error sending email:", error.response?.body || error.message);
        res.status(500).json({ error: "Failed to send email" });
    }
};

// Update user review (and optional 1-5 rating) for an appointment
const updateCustomerReview = async (req, res) => {
    const { appointmentId } = req.params;
    const { review, rating } = req.body;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: "Appointment not found" });
        }
        // Ownership: only the booking customer may review their own appointment.
        if (appointment.userId !== req.user.userId) {
            return res.status(403).json({ message: "Not authorized to review this appointment" });
        }
        // Integrity: a review is only meaningful for an appointment that actually
        // took place. Allowing reviews on pending/cancelled/declined rows pollutes
        // the salon's denormalized avgRating/reviewCount with phantom ratings.
        if (appointment.status !== 'completed') {
            return res.status(400).json({ message: "You can only review appointments that have been completed" });
        }
        appointment.userReview = review;
        if (rating !== undefined && rating !== null) {
            const r = parseInt(rating, 10);
            if (Number.isNaN(r) || r < 1 || r > 5) {
                return res.status(400).json({ message: "rating must be an integer between 1 and 5" });
            }
            appointment.rating = r;
        }
        await appointment.save();
        // Keep the salon's denormalized rating cache in sync.
        await refreshSalonRatingCache(appointment.salonId);
        res.status(200).json({ message: "Review submitted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

// Update staff review for an appointment
const updateStaffReview = async (req, res) => {
    const { appointmentId } = req.params;
    const { review } = req.body;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: "Appointment not found" });
        }
        // Authorization: caller must be either the salon owner of this salon,
        // or the staff member assigned to this appointment.
        if (req.user.salonId !== undefined && appointment.salonId !== req.user.salonId) {
            return res.status(403).json({ message: "Not authorized: appointment belongs to a different salon" });
        }
        if (req.user.staffId !== undefined && appointment.staffId !== req.user.staffId) {
            return res.status(403).json({ message: "Not authorized: this appointment is not assigned to you" });
        }
        appointment.staffReview = review;
        await appointment.save();
        res.status(200).json({ message: "Staff review submitted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

// Salon owner replies publicly to the customer's review on an appointment.
// Upsert semantics: calling again overwrites (edits) an existing reply.
const replyToReview = async (req, res) => {
    const { appointmentId } = req.params;
    const { reply } = req.body;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: "Appointment not found" });
        }
        // Ownership: only the salon that owns this booking may reply.
        if (appointment.salonId !== req.user.salonId) {
            return res.status(403).json({ message: "Not authorized: appointment belongs to a different salon" });
        }
        // A reply needs something to reply to — the customer's review fields
        // are userReview (text) and rating (1-5 stars); both null means the
        // customer hasn't reviewed yet.
        if (appointment.userReview === null && appointment.rating === null) {
            return res.status(400).json({ message: "Cannot reply before the customer has submitted a review" });
        }
        appointment.salonReply = reply;
        await appointment.save();
        res.status(200).json({ message: "Reply saved successfully", salonReply: appointment.salonReply });
    } catch (error) {
        console.error('Error replying to review:', error);
        res.status(500).json({ message: "Server error" });
    }
};

// Customer cancels their own appointment (must be >24h before start).
const cancelAppointment = async (req, res) => {
    const { appointmentId } = req.params;
    const userId = req.user.userId;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }
        // Ownership: only the booking customer may cancel.
        if (appointment.userId !== userId) {
            return res.status(403).json({ message: 'Not authorized to cancel this appointment' });
        }

        // Build the start Date from date + time fields (SQLite returns DATEONLY string + TIME string).
        const startAt = new Date(`${appointment.date}T${appointment.time}`);
        // Give a specific, actionable reason rather than a combined vague one.
        if (!canTransition(appointment.status, 'cancelled')) {
            return res.status(400).json({ message: `This appointment is already ${appointment.status} and can't be cancelled.` });
        }
        const msUntilStart = startAt.getTime() - Date.now();
        if (msUntilStart <= 24 * 3600 * 1000) {
            return res.status(400).json({ message: "It's too late to cancel — cancellations close 24 hours before the appointment." });
        }

        appointment.status = 'cancelled';
        // ── Cancellation reason (#60) ──────────────────────────────────
        // Optional and validated upstream (cancelAppointmentSchema). Recorded
        // on the row so the salon can aggregate WHY bookings are lost — the
        // difference between "our prices are too high" and "our 6pm stylist
        // quit" is the difference between a pricing decision and a hiring one.
        // Deliberately NOT sent in the cancellation notification: the salon
        // sees the aggregate in analytics rather than a raw complaint against
        // an individual customer.
        // `req.body || {}`: the reason is optional and the route supplies a
        // validated body, but this handler is also called directly by tests and
        // internal callers that pass no body at all. Reading `req.body.reason`
        // unguarded turned "cancel without a reason" — the common case — into
        // a 500 on a path that used to work, which is exactly the kind of
        // regression an optional field must never cause.
        const { reason = null, reasonNote = null } = req.body || {};
        appointment.cancellationReason = reason || null;
        appointment.cancellationNote = reasonNote || null;
        appointment.cancelledAt = new Date();
        await appointment.save();
        // Fire-and-forget: the other party (the salon — this endpoint is
        // customer-only) learns the booking was cancelled. Never awaited.
        notify({
            recipientRole: 'salon',
            recipientId: appointment.salonId,
            type: 'booking.cancelled',
            title: 'Booking cancelled',
            body: `${appointment.date} at ${appointment.time}`,
            appointmentId: appointment.id,
        }).catch(() => { }); // notify never rejects; belt-and-braces for lint
        // Fire-and-forget: the customer gets an emailed cancellation record of
        // their own action. Never awaited — see sendCustomerStatusEmail.
        sendCustomerStatusEmail(appointment.id, 'cancelled').catch(() => { });
        // Fire-and-forget (#30): a cancelled booking frees capacity for this
        // salon+date — alert the oldest matching waiter whose party fits.
        // findNextWaitlistEntry never throws (notificationService contract),
        // so a broken waitlist can't touch this successful cancellation.
        findNextWaitlistEntry(appointment.salonId, appointment.date, appointment.partySize)
            .catch(() => { }); // belt-and-braces: never reject into the cancel flow
        res.status(200).json({ message: 'Appointment cancelled successfully', appointment });
    } catch (error) {
        console.error('Error cancelling appointment:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Customer reschedules their own appointment (must be >24h before start).
// Keeps the same staff by default; an optional staffId may reassign to any
// staff member of the same salon who provides the same service.
const rescheduleAppointment = async (req, res) => {
    const { appointmentId } = req.params;
    const { dateSelect, time, staffId, customerNote, partySize } = req.body;
    const userId = req.user.userId;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }
        // Ownership: only the booking customer may reschedule.
        if (appointment.userId !== userId) {
            return res.status(403).json({ message: 'Not authorized to reschedule this appointment' });
        }

        // Same rules as cancellation (shared pure helper): cancellable status
        // AND start strictly more than 24h away. Give a specific reason.
        if (!canReschedule(appointment)) {
            if (!canTransition(appointment.status, 'cancelled')) {
                return res.status(400).json({ message: `This appointment is already ${appointment.status} and can't be rescheduled.` });
            }
            return res.status(400).json({ message: "It's too late to reschedule — changes close 24 hours before the appointment." });
        }

        const service = await Services.findByPk(appointment.serviceId);
        if (!service) {
            return res.status(404).json({ message: 'Service not found' });
        }

        // Staff resolution: keep the current staff unless a replacement is
        // requested. A replacement must belong to the same salon AND provide
        // this service (same eligibility source as the availability checker).
        let effectiveStaffId = appointment.staffId;
        if (staffId !== undefined) {
            const eligible = await staffForService(appointment.salonId, appointment.serviceId);
            const match = eligible.find((s) => s.id === staffId);
            if (!match) {
                return res.status(400).json({ message: 'Selected staff is not available for this service' });
            }
            effectiveStaffId = match.id;
        }

        const endTime = computeEndTime(time, service.duration);

        // Salon-hours gate, identical to the payment finalization path.
        const salon = await Salons.findByPk(appointment.salonId);
        if (!salon) {
            return res.status(404).json({ message: 'Salon not found' });
        }
        const hoursCheck = validateSalonHours(salon, dateSelect, time, endTime);
        if (!hoursCheck.ok) {
            return res.status(400).json({ message: hoursCheck.reason });
        }
        // The new slot is a booking too — apply the salon's lead time.
        const leadCheck = validateLeadTime(salon, dateSelect, time);
        if (!leadCheck.ok) {
            return res.status(400).json({ message: leadCheck.reason });
        }

        // Conflict-check the NEW slot (blockouts + other bookings). The
        // appointment being moved is excluded so it can't collide with itself.
        const conflicted = await conflictingStaffIds(
            [effectiveStaffId], appointment.salonId, dateSelect, time, endTime, appointment.id
        );
        if (conflicted.has(effectiveStaffId)) {
            return res.status(409).json({ message: 'New slot is not available' });
        }

        // Remember the old slot for the notification before overwriting.
        const oldDate = appointment.date;
        const oldTime = appointment.time;
        appointment.date = dateSelect;
        appointment.time = time;
        appointment.endTime = endTime;
        appointment.staffId = effectiveStaffId;
        // Optional note update: the schema already trimmed it. An empty
        // string (or explicit null) CLEARS the note — stored as null; any
        // other value overwrites it. Omitted → existing note stays untouched.
        if (customerNote !== undefined) {
            appointment.customerNote = customerNote || null;
        }
        // Optional headcount update for group bookings: provided → overwrite
        // (the schema has already bounded it to 1..20); omitted → the current
        // size stays, mirroring how staffId and customerNote behave here.
        // Party size never affects conflict checking — one professional
        // serves the whole group.
        if (partySize !== undefined) {
            appointment.partySize = partySize;
        }
        try {
            await appointment.save();
        } catch (err) {
            // The conflict pre-check above is check-then-act: two customers
            // rescheduling into the SAME exact slot both pass it, and the
            // partial unique index rejects the second save. Surface that as
            // the same 409 the pre-check produces instead of a raw 500.
            if (err && err.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ message: 'New slot is not available' });
            }
            throw err;
        }

        // Fire-and-forget: the salon learns the booking moved (this endpoint
        // is customer-only). Never awaited — mirrors cancelAppointment.
        notify({
            recipientRole: 'salon',
            recipientId: appointment.salonId,
            type: 'booking.rescheduled',
            title: 'Booking rescheduled',
            body: `${oldDate} at ${oldTime} -> ${appointment.date} at ${appointment.time}`,
            appointmentId: appointment.id,
        }).catch(() => { }); // notify never rejects; belt-and-braces for lint

        res.status(200).json({ message: 'Appointment rescheduled successfully', appointment });
    } catch (error) {
        console.error('Error rescheduling appointment:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Fire-and-forget transactional email to the CUSTOMER about a booking status
// change (confirmed/declined/completed/no-show/cancelled). One query fetches
// email + salon/service names alongside the row; every failure path is
// swallowed (and never rethrown) so a mail problem can't touch an already-
// successful response — same contract as notify(). Callers must not await it.
const sendCustomerStatusEmail = async (appointmentId, status) => {
    try {
        const row = await appointmentModel.findByPk(appointmentId, {
            include: [
                { model: userModel, as: 'user', attributes: ['email'] },
                { model: Salons, as: 'salon', attributes: ['name'] },
                { model: Services, as: 'service', attributes: ['name'] },
            ],
        });
        const toEmail = row?.user?.email;
        if (!toEmail) return;
        await sendBookingStatusEmail(toEmail, {
            status,
            salonName: row.salon?.name,
            serviceName: row.service?.name,
            date: row.date,
            time: row.time,
        });
    } catch (error) {
        console.error('❌ Error sending booking status email:', error.response?.body || error.message);
    }
};

// Staff or salon owner updates an appointment's status
// (accept pending -> confirmed, decline pending -> declined, complete confirmed -> completed,
// mark a past confirmed booking confirmed -> no-show — salon role only).
const updateAppointmentStatus = async (req, res) => {
    const { appointmentId } = req.params;
    const { status: newStatus } = req.body;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        // Authorization: caller must be either the salon owner of this salon, or a staff member of this salon.
        const salonId = req.user.salonId;
        const staffId = req.user.staffId;
        if (salonId === undefined && staffId === undefined) {
            return res.status(403).json({ message: 'Not authorized' });
        }
        if (salonId !== undefined && appointment.salonId !== salonId) {
            return res.status(403).json({ message: 'Not authorized: appointment belongs to a different salon' });
        }
        if (staffId !== undefined) {
            // Staff may only act on appointments assigned to themselves.
            if (appointment.staffId !== staffId) {
                return res.status(403).json({ message: 'Not authorized: this appointment is not assigned to you' });
            }
        }

        // No-show is a salon-only judgement call: staff (and customers) can
        // never set it, regardless of who the appointment belongs to.
        if (newStatus === 'no-show' && req.user.role !== 'salon') {
            return res.status(403).json({ message: 'Only the salon can mark an appointment as no-show' });
        }

        if (!canTransition(appointment.status, newStatus)) {
            return res.status(400).json({ message: `Cannot move appointment from '${appointment.status}' to '${newStatus}'` });
        }

        // A future booking can't have been skipped yet — no-show requires the
        // start time to already be behind us. Same local-time parsing of the
        // DATEONLY+TIME fields as cancelAppointment.
        if (newStatus === 'no-show') {
            const startAt = new Date(`${appointment.date}T${appointment.time}`);
            if (startAt.getTime() >= Date.now()) {
                return res.status(400).json({ message: 'Cannot mark a future appointment as no-show' });
            }
        }

        appointment.status = newStatus;
        await appointment.save();

        // Loyalty (#27): a completed booking earns its customer a flat 10
        // points (Appointments store no price — see the CSV note above — so
        // there is no amount to scale by; per booking regardless of partySize).
        // The helper stamps pointsAwardedAt first, so replays can't double-
        // credit, and never throws — a broken ledger can't undo this
        // successful transition.
        if (newStatus === 'completed') {
            await awardForCompletedAppointment(appointment);
        }

        // Fire-and-forget: tell the customer their booking moved. Only the
        // statuses a customer cares about get a notification; notify() runs
        // after the DB write above succeeded and never throws into this flow.
        const STATUS_NOTIFICATIONS = {
            confirmed: { type: 'booking.confirmed', title: 'Booking confirmed' },
            declined: { type: 'booking.declined', title: 'Booking declined' },
            completed: { type: 'booking.completed', title: 'Booking completed' },
            'no-show': { type: 'booking.no-show', title: 'Booking marked no-show' },
        };
        const notice = STATUS_NOTIFICATIONS[newStatus];
        if (notice) {
            notify({
                recipientRole: 'customer',
                recipientId: appointment.userId,
                type: notice.type,
                title: notice.title,
                body: `${appointment.date} at ${appointment.time}`,
                appointmentId: appointment.id,
            }).catch(() => { });
        }

        // Fire-and-forget: the same news by EMAIL to the customer. Never
        // awaited — mirrors notify() above; a mail failure can't delay or
        // break this response (sendCustomerStatusEmail swallows everything).
        sendCustomerStatusEmail(appointment.id, newStatus).catch(() => { });

        res.status(200).json({ message: `Appointment ${newStatus}`, appointment });
    } catch (error) {
        console.error('Error updating appointment status:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// ── One-tap rebook (#55) ──────────────────────────────────────────────
// POST /appointment/:appointmentId/rebook
//
// Returns the next genuinely-bookable slot for the SAME service, ready to
// hand straight to the checkout — it does NOT create a booking (see the
// module docstring in services/rebookService.js: bookings are paid for, and
// this endpoint takes no money).
const rebookFromAppointment = async (req, res) => {
    const { appointmentId } = req.params;
    const userId = req.user.userId;
    const { horizonDays, staffId, preferSameTime, partySize } = req.body;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }
        if (appointment.userId !== userId) {
            return res.status(403).json({ message: 'Not authorized to rebook this appointment' });
        }
        // Rebooking a LIVE appointment is what the reschedule endpoint is for;
        // the two must never overlap or a customer could "rebook" their way
        // out of the 24-hour cancellation rule.
        if (!isRebookable(appointment)) {
            return res.status(409).json({
                message: `This appointment is ${appointment.status} — use reschedule to move a live booking.`,
                code: 'NOT_REBOOKABLE',
            });
        }

        const result = await findRebookSlot(appointment, {
            horizonDays, staffId, preferSameTime, partySize, now: new Date(),
        });
        if (!result.ok) {
            return res.status(404).json({ message: result.reason, code: result.code });
        }
        return res.status(200).json({ message: 'Slot found', ...result.suggestion });
    } catch (error) {
        console.error('Error in rebookFromAppointment:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// ── Price quote (#56) ─────────────────────────────────────────────────
// POST /appointment/quote
//
// A pre-payment total. Every number comes from the same code path /pay uses
// (getAuthoritativePrice + resolvePromo), so the quote can never disagree
// with the charge — see services/quoteService.js.
const getQuote = async (req, res) => {
    try {
        const result = await buildQuote({ ...req.body });
        if (!result.ok) {
            return res.status(result.status || 400).json({ message: result.reason, code: result.code });
        }
        return res.status(200).json(result.quote);
    } catch (error) {
        console.error('Error in getQuote:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// ── Recurring booking series (#61) ────────────────────────────────────
// The series stores intent; occurrences are materialized by the sweep as
// pending appointments. See services/recurringService.js for why.
const createBookingSeries = async (req, res) => {
    const userId = req.user.userId;
    try {
        const result = await createSeries({ userId, ...req.body });
        if (!result.ok) {
            return res.status(result.status || 400).json({ message: result.reason, code: result.code });
        }
        const s = result.series;
        return res.status(201).json({
            message: 'Series created',
            series: {
                id: s.id, salonId: s.salonId, serviceId: s.serviceId, staffId: s.staffId,
                startDate: s.startDate, time: s.time, frequency: s.frequency,
                occurrences: s.occurrences, partySize: s.partySize, status: s.status,
            },
        });
    } catch (error) {
        console.error('Error in createBookingSeries:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

const getMySeries = async (req, res) => {
    try {
        return res.status(200).json(await listSeries(req.user.userId));
    } catch (error) {
        console.error('Error in getMySeries:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

const updateBookingSeries = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const result = await setSeriesStatus(id, req.user.userId, status);
        if (!result.ok) {
            return res.status(result.status).json({ message: result.reason, code: result.code });
        }
        return res.status(200).json({
            message: `Series ${status}`,
            series: {
                id: result.series.id, status: result.series.status,
                occurrencesCreated: result.series.occurrencesCreated,
            },
        });
    } catch (error) {
        console.error('Error in updateBookingSeries:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    appointmentChecker,
    getAllAppointmentsByUserId,
    rebookFromAppointment,
    getQuote,
    createBookingSeries,
    getMySeries,
    updateBookingSeries,
    getUpcomingAppointments,
    getScheduledAppointmentsBySalonId,
    exportAppointmentsCsv,
    mailAppointment,
    updateCustomerReview,
    updateStaffReview,
    replyToReview,
    cancelAppointment,
    rescheduleAppointment,
    updateAppointmentStatus,
};