/**
 * Double-booking guard (#47).
 *
 * The existing flow already checks for conflicts before creating a booking —
 * but "check, then insert" is a TOCTOU race. Two customers finalizing payments
 * for the same slot milliseconds apart can BOTH pass the check and BOTH
 * insert, producing two bookings (and two charges) for one chair. The checker
 * makes this unlikely; only a database constraint makes it impossible.
 *
 * Two layers, because neither is sufficient alone:
 *
 *  1. A PARTIAL UNIQUE INDEX on (staffId, date, time) covering only bookings
 *     that actually occupy the chair (status not in cancelled/declined/no-show).
 *     Partial is essential: a cancelled slot must be re-bookable, and a plain
 *     unique index would permanently burn the slot.
 *
 *  2. A create path that translates a unique-constraint violation into a clean
 *     SLOT_TAKEN error instead of an unhandled 500. Without this, closing the
 *     race would surface to users as "Internal server error" — technically
 *     safe, but useless as a product experience.
 *
 * Layer 1 is created best-effort at boot: if pre-existing duplicates in an
 * old database make the index impossible, we log a warning and continue
 * rather than refusing to start (availability beats strictness for a salon
 * that's already taking bookings). Layer 2 works regardless.
 */
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const appointmentModel = require('../models/appointmentModel');

/**
 * Statuses that OCCUPY a slot. Anything not listed here frees the slot for
 * rebooking — a customer who cancels must not permanently burn the chair.
 */
const SLOT_HOLDING_STATUSES = Object.freeze(['pending', 'confirmed', 'completed', 'no-show']);
/** Inverse: statuses that release the slot. Used by the partial index. */
const SLOT_FREEING_STATUSES = Object.freeze(['cancelled', 'declined']);

const SLOT_TAKEN_MESSAGE = 'The selected slot was just taken by another booking';

/**
 * Create the partial unique index. Returns true when it exists afterwards.
 *
 * Dialect notes:
 *  - SQLite supports partial indexes since 3.8.0 (2013) — `WHERE` on CREATE
 *    INDEX is valid, and `IF NOT EXISTS` is too.
 *  - Postgres supports partial indexes and `IF NOT EXISTS` natively.
 *  - MySQL does NOT support partial indexes; we skip it there and rely on
 *    layer 2 (the constraint-violation handler).
 */
const createSlotUniquenessIndex = async (sequelize) => {
  const dialect = sequelize.getDialect();
  if (['mysql', 'mariadb'].includes(dialect)) {
    logger.info('bookingGuard: partial indexes unsupported on this dialect; relying on the create-path guard');
    return false;
  }
  const quoted = dialect === 'postgres' ? '"Appointments"' : '"Appointments"';
  const sql =
    `CREATE UNIQUE INDEX IF NOT EXISTS appointments_staff_slot_active `
    + `ON ${quoted} ("staffId", "date", "time") `
    + `WHERE "status" NOT IN ('cancelled', 'declined', 'no-show')`;
  try {
    await sequelize.query(sql);
    logger.info('bookingGuard: slot uniqueness index is in place');
    return true;
  } catch (err) {
    // The overwhelmingly likely cause is pre-existing duplicate rows in a
    // database that pre-dates this constraint. Warn loudly — this is exactly
    // the situation the guard was built for — but keep serving.
    logger.warn(`bookingGuard: could not create the slot uniqueness index (${err.message}). `
      + 'Duplicate active bookings may already exist; run the dedupe sweep and re-start.');
    return false;
  }
};

/**
 * Find the active booking that occupies a slot, if any.
 *
 * Uses the same half-open interval as conflict detection: [start, end) — a
 * booking ending exactly when the next starts is NOT a conflict.
 *
 * @returns {Promise<object|null>} the conflicting Appointment row, or null
 */
const findSlotConflict = async ({
  staffId, salonId, date, startTime, endTime, excludeAppointmentId = null,
}) => appointmentModel.findOne({
  where: {
    staffId,
    salonId,
    date,
    status: { [Op.in]: [...SLOT_HOLDING_STATUSES] },
    time: { [Op.lt]: endTime },
    endTime: { [Op.gt]: startTime },
    ...(excludeAppointmentId ? { id: { [Op.ne]: excludeAppointmentId } } : {}),
  },
});

/** Assert a slot is free. Returns { ok, reason, conflict }. */
const assertSlotFree = async (args) => {
  const conflict = await findSlotConflict(args);
  if (conflict) {
    return { ok: false, reason: SLOT_TAKEN_MESSAGE, conflict, code: 'SLOT_TAKEN' };
  }
  return { ok: true, conflict: null };
};

/** Is this error a database-level uniqueness violation? */
const isUniqueViolation = (err) => Boolean(err) && (
  err.name === 'SequelizeUniqueConstraintError'
  || err.parent?.code === 'SQLITE_CONSTRAINT'
  || err.parent?.code === 'SQLITE_CONSTRAINT_UNIQUE'
  || err.parent?.code === '23505' // Postgres unique_violation
);

/**
 * Create a booking, refusing to double-book even under concurrency.
 *
 * Runs the pre-check (fast path, gives a good error message), then creates. If
 * a concurrent request slipped in between the two, the database rejects the
 * insert and we convert that into the SAME SLOT_TAKEN error the pre-check
 * produces — so callers see one consistent failure mode either way.
 *
 * @returns {Promise<{ok: true, appointment}|{ok: false, code, reason}>}
 */
const createBookingSafely = async (values, slotArgs) => {
  const pre = await assertSlotFree(slotArgs);
  if (!pre.ok) return { ok: false, code: pre.code, reason: pre.reason };

  try {
    const appointment = await appointmentModel.create(values);
    return { ok: true, appointment };
  } catch (err) {
    if (isUniqueViolation(err)) {
      logger.warn('bookingGuard: concurrent booking blocked by the uniqueness index', {
        staffId: values.staffId, date: values.date, time: values.time,
      });
      return { ok: false, code: 'SLOT_TAKEN', reason: SLOT_TAKEN_MESSAGE };
    }
    throw err;
  }
};

/**
 * Report every slot that currently has more than one active booking — the
 * legacy duplicates that would block index creation. Read-only; safe to run
 * at any time, and the first thing to run when the index can't be created.
 */
const findDuplicateSlots = async () => {
  const rows = await appointmentModel.findAll({
    where: { status: { [Op.in]: [...SLOT_HOLDING_STATUSES] } },
    attributes: ['staffId', 'salonId', 'date', 'time'],
    raw: true,
  });
  const counts = new Map();
  for (const r of rows) {
    const key = `${r.staffId}|${r.date}|${r.time}`;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { staffId: r.staffId, salonId: r.salonId, date: r.date, time: r.time, count: 1 });
  }
  return [...counts.values()].filter((e) => e.count > 1);
};

module.exports = {
  SLOT_HOLDING_STATUSES,
  SLOT_FREEING_STATUSES,
  SLOT_TAKEN_MESSAGE,
  createSlotUniquenessIndex,
  findSlotConflict,
  assertSlotFree,
  createBookingSafely,
  findDuplicateSlots,
  isUniqueViolation,
};
