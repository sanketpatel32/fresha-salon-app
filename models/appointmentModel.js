const { DataTypes } = require('sequelize');
const sequelize = require('../utils/database'); 


const Appointment = sequelize.define('Appointment', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true,
    },
    staffId: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    salonId: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    serviceId:{
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    userId:{
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    date: {
        type: DataTypes.DATEONLY, // Store only the date (YYYY-MM-DD)
        allowNull: false,
    },
    time: {
        type: DataTypes.TIME, // Store the time (HH:mm:ss)
        allowNull: false,
    },
    endTime: {
        type: DataTypes.TIME, // Store the end time (HH:mm:ss)
        allowNull: false,
    },
    staffReview: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    userReview: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'confirmed',
        validate: {
            isIn: [['pending', 'confirmed', 'declined', 'completed', 'cancelled', 'no-show']]
        }
    },
    rating: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1, max: 5 }
    },
    // Salon owner's public reply to the customer's review. Nullable — only
    // filled once the owner answers via PUT /api/appointment/:id/reply.
    salonReply: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // Customer's free-text note attached at booking time ("please use
    // hypoallergenic dye", "running 5 min late"). Nullable — most bookings
    // carry none; an empty-string clear stores NULL. Visible to the booking's
    // salon in its appointment views. Backfilled at boot via ensureColumns.
    customerNote: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // Number of people this booking covers (bridal parties, friends).
    // AVAILABILITY DECISION: party size does NOT consume extra staff slots —
    // one professional serves the whole group — so conflict detection
    // (conflictingStaffIds) deliberately ignores it and no extra duration is
    // added. Bounds are enforced here as defense-in-depth; the zod schemas
    // reject out-of-range values with a 400 before any DB write.
    partySize: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: { min: 1, max: 20 }
    },
    orderId: {
        type: DataTypes.STRING,
        allowNull: true, // nullable for legacy rows created before this column existed
        unique: true, // DB-level guard against duplicate appointment creation on payment replay
    },
    // Loyalty idempotency stamp (#27): set the moment completion points are
    // CLAIMED for this booking, before the balance is touched. Null = nothing
    // awarded yet. Any re-entry into the award path (a replayed request, a
    // future second caller) sees the stamp and bails, so a booking earns
    // exactly once. Backfilled at boot via ensureColumns (nullable — legacy
    // bookings completed before loyalty existed stay legitimately unstamped).
    pointsAwardedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    // Reminder idempotency stamp (#29): set when the ~24h-before reminder
    // email has been CLAIMED for this booking (stamped BEFORE the send, so a
    // crash between the two can only SKIP a reminder, never double-send).
    // Null = not reminded yet; the sweep's WHERE clause filters stamped rows
    // out, so replays/restarts are naturally idempotent. Nullable DATETIME,
    // backfilled at boot via ensureColumns like pointsAwardedAt.
    reminderSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    // ── Cancellation reasons (#60) ────────────────────────────────────
    // Why the booking was cancelled. The vocabulary is the point: free text
    // alone produces a hundred one-off answers nobody can aggregate, so the
    // enum lives in validators.CANCELLATION_REASONS and `cancellationNote`
    // carries the "other" detail. Nullable — every pre-#60 cancellation and
    // every salon-side cancellation legitimately has no reason recorded.
    cancellationReason: {
        type: DataTypes.STRING(32),
        allowNull: true,
    },
    cancellationNote: {
        type: DataTypes.STRING(200),
        allowNull: true,
    },
    // When the cancellation happened. Separate from `updatedAt` because an
    // appointment can be edited for plenty of other reasons afterwards.
    cancelledAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    // ── Recurring series link (#61) ───────────────────────────────────
    // Set on occurrences materialized from a RecurringSeries. Nullable — the
    // overwhelming majority of bookings are one-offs. `occurrenceIndex` is
    // 1-based (1 = the first visit of the series) so "3rd visit" reads the
    // way a human counts. No FK: a series can be cancelled while its past
    // visits must survive for the salon's history.
    seriesId: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    occurrenceIndex: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1 },
    },
    // Optimistic concurrency token (#48). Bumped on every mutation; clients
    // that read a booking can send `If-Match: W/"<id>-<version>"` on the next
    // write so a stale edit is rejected with 412 instead of silently
    // overwriting someone else's change. Starts at 0 — the ensureColumns
    // backfill uses NOT NULL DEFAULT 0 so legacy rows stay valid, and reads of
    // a never-updated booking expose a stable W/"12-0".
    version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
    },
});

module.exports = Appointment;