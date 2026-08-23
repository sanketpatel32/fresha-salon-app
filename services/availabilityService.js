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

// Human-readable weekday names, indexed by JS getDay() (0=Sun..6=Sat).
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Strict 24h HH:mm clock time (zero-padded), the only shape weeklyHours times
// are allowed in — which is what makes plain string comparison safe below.
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isHm = (v) => typeof v === 'string' && HM_RE.test(v);

/**
 * Defensive parse of the Salons.weeklyHours TEXT column.
 *
 * The column stores JSON.stringify({ "0": {open, close, closed}, ..., "6": … })
 * (keys = Sunday..Saturday) or null while the salon is still on the legacy
 * single-window model. Never throws: any garbage (null, malformed JSON, a
 * partial map, wrong-typed fields, an open day with missing/misordered
 * times) degrades to null so callers fall back to the legacy logic instead
 * of a corrupt row turning a booking read into a 500 — same contract as
 * parseGallery. Closed days may carry optional display-only open/close.
 *
 * @param {string|null} raw - raw column value
 * @returns {object|null} normalized 7-day map, or null when unset/unusable
 */
function parseWeeklyHours(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (_err) {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const out = {};
    for (let i = 0; i < 7; i++) {
        const d = parsed[String(i)];
        if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
        if (typeof d.closed !== 'boolean') return null;
        // An OPEN day must carry a sane, ordered window; CLOSED days ignore
        // their times entirely (kept only as optional display hints).
        if (!d.closed && (!isHm(d.open) || !isHm(d.close) || d.close <= d.open)) return null;
        out[String(i)] = {
            ...(typeof d.open === 'string' ? { open: d.open } : {}),
            ...(typeof d.close === 'string' ? { close: d.close } : {}),
            closed: d.closed,
        };
    }
    return out;
}

/**
 * Derive the DEFAULT weekly schedule from a salon's legacy single-window
 * columns: openingTime/closingTime applied to every day, closure taken from
 * the workingDays code array (no usable array = open every day, exactly how
 * validateSalonHours's legacy branch treats it).
 *
 * @param {object} salon - a Salons row
 * @returns {object} full 7-day map keyed "0".."6"
 */
function defaultWeeklyHours(salon) {
    const open = (salon && salon.openingTime) || '09:00';
    const close = (salon && salon.closingTime) || '20:00';
    const wd = salon && Array.isArray(salon.workingDays) ? salon.workingDays : null;
    const map = {};
    for (let i = 0; i < 7; i++) {
        map[String(i)] = {
            open,
            close,
            closed: wd && wd.length > 0 ? !wd.includes(DAY_CODES[i]) : false,
        };
    }
    return map;
}

/**
 * Effective weekly schedule for display: the stored per-day overrides merged
 * over the legacy-derived defaults, so clients ALWAYS receive a complete,
 * well-formed 7-day object even when the raw column is null (all-defaults),
 * partially filled, or corrupt (degrades to defaults via parseWeeklyHours).
 *
 * @param {object} salon - a Salons row
 * @returns {object} 7-day map of { open, close, closed }
 */
function getEffectiveWeeklyHours(salon) {
    const stored = salon ? parseWeeklyHours(salon.weeklyHours) : null;
    const def = defaultWeeklyHours(salon);
    const merged = {};
    for (let i = 0; i < 7; i++) {
        const s = stored ? stored[String(i)] : null;
        merged[String(i)] = {
            open: (s && s.open) || def[String(i)].open,
            close: (s && s.close) || def[String(i)].close,
            closed: s ? s.closed : def[String(i)].closed,
        };
    }
    return merged;
}

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

  // Per-day schedule override. Once a salon has saved weeklyHours it FULLY
  // governs both the day-closure and the window checks for that booking —
  // the legacy single-window logic below is skipped. Applied here (rather
  // than as a separate helper) so every path that already calls
  // validateSalonHours (checker, payment creation, reschedule) enforces it
  // with zero extra wiring. A null/unusable column never reaches this
  // branch, keeping pre-feature behavior byte-identical.
  const weekly = parseWeeklyHours(salon.weeklyHours);
  if (weekly) {
    const jsDay = new Date(`${dateStr}T00:00:00`).getDay();
    const day = Number.isInteger(jsDay) ? weekly[String(jsDay)] : null;
    if (day) {
      if (day.closed) {
        return { ok: false, reason: `Salon is closed on ${WEEKDAY_NAMES[jsDay]}` };
      }
      if (startTime < day.open || endTime > day.close) {
        return { ok: false, reason: 'Outside working hours' };
      }
      return { ok: true };
    }
    // Unparseable date falls through to the legacy branch, which handles it
    // just as gracefully as before this feature existed.
  }

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
  parseWeeklyHours,
  defaultWeeklyHours,
  getEffectiveWeeklyHours,
  WEEKDAY_NAMES,
  staffForService,
  conflictingStaffIds,
};
