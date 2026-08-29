/**
 * Recurring booking series (#61).
 *
 * A customer who gets a haircut every six weeks shouldn't have to re-enter
 * the same booking eight times a year. This service manages the standing
 * order and materializes each visit as it comes due.
 *
 * ── Why occurrences are materialized late, not up front ──────────────────
 * Creating all N appointments at series-creation time would commit a price,
 * a stylist and a chair that may not exist six months from now — and would
 * hold inventory for visits the customer might cancel. Instead the series
 * stores the pattern, and a sweep creates each visit a bounded number of days
 * ahead of it.
 *
 * ── Why occurrences are created PENDING ──────────────────────────────────
 * Every booking in this app is paid for through the gateway. A recurring
 * series is a REQUEST for a standing appointment, not a purchased right to a
 * chair: occurrences land as `pending` so the salon confirms each one (and
 * collects in person), exactly like any other pending booking. Creating paid
 * bookings on a timer — charging someone without them pressing anything —
 * would be indefensible.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────
 * The sweep asks "how many occurrences are DUE by date, and how many EXIST?"
 * rather than advancing a mutable next-date cursor. A cursor is lost work on
 * crash (or double-advance on replay); counting against durable rows makes
 * the sweep safe to run any number of times, concurrently or not.
 */
const { Op } = require('sequelize');
const RecurringSeries = require('../models/recurringSeriesModel');
const appointmentModel = require('../models/appointmentModel');
const salonModel = require('../models/salonsModel');
const servicesModel = require('../models/servicesModel');
const staffModel = require('../models/staffModel');
const {
  computeEndTime,
  validateSalonHours,
  conflictingStaffIds,
} = require('./availabilityService');
const { addDays, localDay } = require('../utils/timezone');
const logger = require('../utils/logger');

/** Days ahead of an occurrence that the sweep starts creating it. */
const DEFAULT_HORIZON_DAYS = 14;

/** Frequency → days between occurrences. */
const FREQUENCY_DAYS = Object.freeze({ weekly: 7, biweekly: 14, monthly: 30 });

/**
 * The calendar date of occurrence `index` (1-based).
 * Monthly is 30 days rather than a calendar-month step, deliberately: a
 * calendar month is not a fixed length, and "the 31st of every month" is a
 * bug waiting to happen. 30 days is what a customer means by "monthly" for a
 * haircut, and it's unambiguous across month boundaries.
 */
const occurrenceDate = (series, index) =>
  addDays(String(series.startDate).slice(0, 10), FREQUENCY_DAYS[series.frequency] * (index - 1));

/** How many occurrences SHOULD exist by `today + horizonDays`. */
const dueCount = (series, today, horizonDays = DEFAULT_HORIZON_DAYS) => {
  const limit = addDays(today, horizonDays);
  let n = 0;
  for (let i = 1; i <= series.occurrences; i++) {
    if (occurrenceDate(series, i) <= limit) n = i;
    else break;
  }
  return n;
};

/**
 * Create a series. Validates that the salon, service and staff exist and are
 * actually bookable — a series that can never materialize is worse than no
 * series, because it fails silently months later.
 *
 * @returns {Promise<{ok: true, series}|{ok: false, code, reason, status}>}
 */
const createSeries = async ({
  userId, salonId, serviceId, staffId, startDate, time, frequency, occurrences, partySize = 1,
}) => {
  const salon = await salonModel.findByPk(salonId);
  if (!salon || salon.statusbar === 'inactive') {
    return { ok: false, status: 404, code: 'SALON_NOT_FOUND', reason: 'Salon not found' };
  }
  const service = await servicesModel.findOne({ where: { id: serviceId, salonId } });
  if (!service || service.statusbar === 'archived') {
    return { ok: false, status: 404, code: 'SERVICE_NOT_FOUND', reason: 'Service not found at this salon' };
  }
  const staff = await staffModel.findOne({ where: { id: staffId, salonId, statusbar: 'active' } });
  if (!staff) {
    return { ok: false, status: 404, code: 'STAFF_NOT_FOUND', reason: 'Staff member not found at this salon' };
  }

  // The FIRST occurrence must be bookable or the series is a lie. Later ones
  // are re-validated at materialization time (hours/staff may change).
  const firstEnd = computeEndTime(time, Number(service.duration));
  const hours = validateSalonHours(salon, startDate, time, firstEnd);
  if (!hours.ok) {
    return { ok: false, status: 400, code: 'FIRST_SLOT_INVALID', reason: hours.reason };
  }

  const series = await RecurringSeries.create({
    userId, salonId, serviceId, staffId, startDate, time,
    frequency, occurrences, partySize, status: 'active', occurrencesCreated: 0,
  });
  return { ok: true, series };
};

/**
 * Materialize every due occurrence across all active series.
 *
 * Each occurrence is created only if the slot is genuinely free and inside
 * working hours; a clash is SKIPPED (and counted) rather than erroring,
 * because one bad occurrence must not stop the whole sweep or cancel the
 * customer's series.
 *
 * @param {object} [options] { today, horizonDays, now }
 * @returns {Promise<{scanned, created, skipped}>}
 */
const materializeDueSeries = async (options = {}) => {
  const {
    // Host-LOCAL day, not `toISOString()`'s UTC day — see utils/timezone.
    // localDay. Occurrence dates are compared as YYYY-MM-DD strings against
    // the stored `date` column, which lives in the same host-local frame; a
    // UTC day here silently shifts the whole horizon by one for a host that
    // isn't on UTC, materializing visits a day early (or late).
    today = localDay(),
    horizonDays = DEFAULT_HORIZON_DAYS,
  } = options;

  const active = await RecurringSeries.findAll({ where: { status: 'active' } });
  const stats = { scanned: active.length, created: 0, skipped: 0 };

  for (const series of active) {
    const due = dueCount(series, today, horizonDays);
    for (let index = series.occurrencesCreated + 1; index <= due; index++) {
      // Guard against double-materialization even if two sweeps overlap:
      // the (seriesId, occurrenceIndex) pair is the real idempotency key.
      const exists = await appointmentModel.findOne({
        where: { seriesId: series.id, occurrenceIndex: index },
      });
      if (exists) { stats.skipped += 1; continue; }

      const date = occurrenceDate(series, index);
      const service = await servicesModel.findByPk(series.serviceId);
      const salon = await salonModel.findByPk(series.salonId);
      if (!service || !salon || service.statusbar === 'archived') {
        stats.skipped += 1;
        continue;
      }

      const endTime = computeEndTime(series.time, Number(service.duration));
      const hours = validateSalonHours(salon, date, series.time, endTime);
      if (!hours.ok) { stats.skipped += 1; continue; }

      const busy = await conflictingStaffIds([series.staffId], series.salonId, date, series.time, endTime);
      if (busy.has(series.staffId)) { stats.skipped += 1; continue; }

      try {
        await appointmentModel.create({
          staffId: series.staffId,
          salonId: series.salonId,
          serviceId: series.serviceId,
          userId: series.userId,
          date,
          time: series.time,
          endTime,
          // PENDING: the salon confirms each occurrence (see module docstring).
          status: 'pending',
          partySize: series.partySize,
          seriesId: series.id,
          occurrenceIndex: index,
        });
        stats.created += 1;
      } catch (err) {
        // A unique-constraint hit here means a concurrent sweep won the race
        // — that's success from the customer's point of view, not a failure.
        stats.skipped += 1;
        logger.warn(`recurring: occurrence ${index} of series ${series.id} skipped (${err.message})`);
      }
    }

    // Advance the counter to everything actually materialized, so a skipped
    // occurrence is retried on the next sweep rather than being burned.
    const materialized = await appointmentModel.count({ where: { seriesId: series.id } });
    if (materialized !== series.occurrencesCreated) {
      series.occurrencesCreated = materialized;
      await series.save();
    }
  }

  return stats;
};

/** A customer's series, newest first, with progress. */
const listSeries = async (userId) => {
  const rows = await RecurringSeries.findAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
  });
  return rows.map((s) => ({
    id: s.id,
    salonId: s.salonId,
    serviceId: s.serviceId,
    staffId: s.staffId,
    startDate: s.startDate,
    time: s.time,
    frequency: s.frequency,
    occurrences: s.occurrences,
    occurrencesCreated: s.occurrencesCreated,
    partySize: s.partySize,
    status: s.status,
    // The next date that hasn't been materialized yet — what the customer
    // actually wants to see ("your next one is the 12th").
    nextOccurrenceDate: s.occurrencesCreated < s.occurrences
      ? occurrenceDate(s, s.occurrencesCreated + 1)
      : null,
  }));
};

/**
 * Pause or cancel a series. Cancelling is terminal and does NOT touch
 * appointments that already exist — those are real bookings with their own
 * cancellation rules, and silently deleting them would strand both the
 * customer and the salon.
 */
const setSeriesStatus = async (seriesId, userId, status) => {
  const series = await RecurringSeries.findOne({ where: { id: seriesId, userId } });
  if (!series) return { ok: false, status: 404, code: 'SERIES_NOT_FOUND', reason: 'Series not found' };
  if (series.status === 'cancelled') {
    return { ok: false, status: 409, code: 'SERIES_CANCELLED', reason: 'A cancelled series cannot be changed' };
  }
  series.status = status;
  await series.save();
  return { ok: true, series };
};

module.exports = {
  createSeries,
  materializeDueSeries,
  listSeries,
  setSeriesStatus,
  occurrenceDate,
  dueCount,
  FREQUENCY_DAYS,
  DEFAULT_HORIZON_DAYS,
  _Op: Op,
};
