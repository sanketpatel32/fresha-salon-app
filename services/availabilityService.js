/**
 * Availability domain service — the single source of truth for whether a
 * booking slot is valid and conflict-free.
 *
 * Used by:
 *   - appointmentController.appointmentChecker  (the "Check availability" button)
 *   - services/paymentService.finalizeAppointmentFromPayment  (the TOCTOU re-check)
 *
 * Centralizing the rules here means a change to availability logic (e.g.
 * adding staff weekly schedules) only touches one file.
 */
const appointmentModel = require('../models/appointmentModel');
const salonModel = require('../models/salonsModel');
const staffModel = require('../models/staffModel');
const Services = require('../models/servicesModel');
const StaffBlockout = require('../models/staffBlockoutModel');
const { Op } = require('sequelize');

// Map JS getDay() (0=Sun..6=Sat) onto the short codes stored in Salons.workingDays.
const DAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Compute the end time ("HH:MM") of a slot given a start time and a duration
 * in minutes. Timezone-independent string math — does not cross midnight, and
 * deliberately so: a booking that runs past midnight is out of scope for this app.
 *
 * @param {string} startTime  - "HH:MM"
 * @param {number} durationMin - service duration in minutes
 * @returns {string} endTime - "HH:MM"
 */
function computeEndTime(startTime, durationMin) {
  const [hours, minutes] = String(startTime).split(':').map(Number);
  const total = hours * 60 + minutes + parseInt(durationMin, 10);
  const endHours = Math.floor(total / 60) % 24;
  const endMinutes = total % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
}

/**
 * Validate that a requested slot falls within a salon's working hours and days.
 * Returns { ok: true } or { ok: false, reason }.
 *
 * A salon with no workingDays set is treated as open every day (the model's
 * default is Mon-Sat, so this only relaxes for legacy/null rows).
 *
 * @param {object} salon   - a Salons row (needs workingDays, openingTime, closingTime)
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {string} startTime - "HH:MM"
 * @param {string} endTime   - "HH:MM"
 */
function validateSalonHours(salon, dateStr, startTime, endTime) {
  if (!salon) return { ok: false, reason: 'Salon not found' };

  // Working-days check. workingDays is stored as JSON: ["mon","tue",...].
  const workingDays = Array.isArray(salon.workingDays) ? salon.workingDays : null;
  if (workingDays && workingDays.length > 0) {
    const jsDay = new Date(`${dateStr}T00:00:00`).getDay();
    const code = DAY_CODES[jsDay];
    if (!workingDays.includes(code)) {
      return { ok: false, reason: 'The salon is closed on this day' };
    }
  }

  // Working-hours check. Both bounds must be satisfied: the slot must start at
  // or after opening AND end at or before closing.
  const open = salon.openingTime;
  const close = salon.closingTime;
  if (open && close) {
    if (startTime < open) {
      return { ok: false, reason: `This salon opens at ${open}` };
    }
    if (endTime > close) {
      return { ok: false, reason: `This salon closes at ${close}` };
    }
  }

  return { ok: true };
}

// Fallback slot grid (minutes) when a salon hasn't configured slotStepMinutes.
const DEFAULT_SLOT_STEP_MINUTES = 30;

/**
 * Resolve a salon's slot-grid step. null/undefined/garbage falls back to the
 * 30-minute default, so callers never have to branch on the raw column.
 *
 * @param {object|null} salon - a Salons row (needs slotStepMinutes)
 * @returns {number}
 */
function resolveSlotStepMinutes(salon) {
  const step = parseInt(salon && salon.slotStepMinutes, 10);
  return Number.isFinite(step) && step > 0 ? step : DEFAULT_SLOT_STEP_MINUTES;
}

/**
 * Validate that a requested booking start respects the salon's lead time:
 * start must be at least bookingLeadTimeMinutes away from `now`. A null/0
 * lead time means the salon is bookable immediately.
 * Returns { ok: true } or { ok: false, reason }.
 *
 * Called next to validateSalonHours on every path where a booking happens
 * (availability checker, payment creation, reschedule), so the rule cannot
 * be bypassed by skipping the checker step.
 *
 * @param {object} salon   - a Salons row (needs bookingLeadTimeMinutes)
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {string} startTime - "HH:MM"
 * @param {number} [now]   - epoch ms to measure the lead time from
 *   (defaults to Date.now(); tests pass a fixed clock)
 */
function validateLeadTime(salon, dateStr, startTime, now = Date.now()) {
  if (!salon || !dateStr || !startTime) {
    return { ok: false, reason: 'Invalid booking date or time' };
  }
  const leadMinutes = parseInt(salon.bookingLeadTimeMinutes, 10);
  // null / NaN / 0 / negative → bookable immediately.
  if (!Number.isFinite(leadMinutes) || leadMinutes <= 0) return { ok: true };

  const startAt = new Date(`${dateStr}T${startTime}`);
  if (Number.isNaN(startAt.getTime())) {
    return { ok: false, reason: 'Invalid booking date or time' };
  }
  if (startAt.getTime() - now >= leadMinutes * 60 * 1000) return { ok: true };
  return {
    ok: false,
    reason: `This salon requires bookings at least ${leadMinutes} minutes in advance`,
  };
}

/**
 * Find staff in a salon who provide a given service. Returns the staff rows
 * (id, name, phoneNumber) — NOT yet filtered for availability.
 */
async function staffForService(salonId, serviceId) {
  return staffModel.findAll({
    include: [
      {
        model: Services,
        as: 'services',
        where: { id: serviceId },
        attributes: [],
      },
    ],
    where: { salonId },
    attributes: ['id', 'name', 'phoneNumber'],
  });
}

/**
 * Return the set of staff ids (from the given list) who are NOT free for the
 * requested slot, due to either a blockout or an existing non-cancelled/
 * non-declined appointment that overlaps [startTime, endTime).
 *
 * @param {number|null} [excludeAppointmentId] - appointment id to ignore when
 *   scanning existing bookings. The reschedule flow passes its own appointment
 *   so a booking never conflicts with itself in its current/old slot.
 * @returns {Promise<Set<number>>}
 */
async function conflictingStaffIds(staffIds, salonId, dateStr, startTime, endTime, excludeAppointmentId = null) {
  if (!staffIds.length) return new Set();

  const blocked = await StaffBlockout.findAll({
    where: {
      staffId: staffIds,
      date: dateStr,
      startTime: { [Op.lt]: endTime },
      endTime: { [Op.gt]: startTime },
    },
    attributes: ['staffId'],
  });

  const booked = await appointmentModel.findAll({
    where: {
      staffId: staffIds,
      salonId,
      date: dateStr,
      status: { [Op.notIn]: ['cancelled', 'declined'] },
      ...(excludeAppointmentId ? { id: { [Op.ne]: excludeAppointmentId } } : {}),
      time: { [Op.lt]: endTime },
      endTime: { [Op.gt]: startTime },
    },
    attributes: ['staffId'],
  });

  return new Set([
    ...blocked.map((b) => b.staffId),
    ...booked.map((a) => a.staffId),
  ]);
}

module.exports = {
  computeEndTime,
  validateSalonHours,
  validateLeadTime,
  resolveSlotStepMinutes,
  DEFAULT_SLOT_STEP_MINUTES,
  staffForService,
  conflictingStaffIds,
};
