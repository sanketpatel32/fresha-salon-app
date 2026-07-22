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
 * @returns {Promise<Set<number>>}
 */
async function conflictingStaffIds(staffIds, salonId, dateStr, startTime, endTime) {
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
  staffForService,
  conflictingStaffIds,
};
