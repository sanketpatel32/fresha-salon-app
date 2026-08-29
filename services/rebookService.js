/**
 * One-tap rebook (#55).
 *
 * The most common booking in a salon app is the same booking as last time —
 * same service, same stylist, roughly the same time of day. Making the
 * customer walk the whole flow again (find salon → pick service → pick staff
 * → hunt a date) is friction on the single highest-intent action in the
 * product.
 *
 * This module answers one question: given a booking the customer already made,
 * when can they have it again? It searches forward from today for the first
 * slot that actually works, and returns a payload the checkout can pay
 * immediately.
 *
 * Why it returns a PAYLOAD and not a booking: every booking in this app is
 * paid for through the gateway. Silently creating a "pending" appointment
 * here would either (a) hold a chair for someone who never pays, or (b)
 * create a booking with no payment behind it. Returning
 * {salonId, serviceId, staffId, date, time} means the one tap lands the
 * customer on a pre-filled checkout, and the normal paid path stays the only
 * way a booking comes into existence.
 *
 * "Works" is deliberately strict — a suggestion that fails at checkout is
 * worse than no suggestion:
 *   - the salon is open (salon-local weekly hours, via validateSalonHours)
 *   - the lead time is satisfied (validateLeadTime)
 *   - the stylist has no blockout and no conflicting booking
 *   - the service still exists and is not archived (#51)
 */
const { Op } = require('sequelize');
const appointmentModel = require('../models/appointmentModel');
const salonModel = require('../models/salonsModel');
const servicesModel = require('../models/servicesModel');
const staffModel = require('../models/staffModel');
const StaffServices = require('../models/StaffServices');
const {
  computeEndTime,
  validateSalonHours,
  validateLeadTime,
  resolveSlotStepMinutes,
  getEffectiveWeeklyHours,
  conflictingStaffIds,
} = require('./availabilityService');
const { addDays, toMinutes, fromMinutes, localDay, localTime } = require('../utils/timezone');

/** Statuses that disqualify a booking as the source of a rebook. */
const REBOOKABLE_SOURCES = ['completed', 'cancelled', 'no-show', 'declined'];

const NO_SLOT_REASON = 'No equivalent slot is available in the searched window';

/**
 * The slot grid for one calendar day, in the salon's own step.
 * Exported for tests; the interesting logic is the ordering below.
 */
const slotsForDay = (salon, dateString, durationMinutes) => {
  const weekly = getEffectiveWeeklyHours(salon);
  const jsDay = new Date(`${dateString}T00:00:00`).getDay();
  const day = weekly[String(jsDay)];
  if (!day || day.closed) return [];
  const step = resolveSlotStepMinutes(salon);
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  if (open === null || close === null || close <= open) return [];
  const slots = [];
  for (let t = open; t + durationMinutes <= close; t += step) {
    slots.push(fromMinutes(t));
  }
  return slots;
};

/**
 * Order candidate slots for a rebook.
 *
 * With `preferSameTime`, slots are sorted by distance from the ORIGINAL
 * booking's time of day: someone who books a 6pm cut after work wants another
 * 6pm cut, not the 9am opening slot that happens to be free first. Free-ness
 * is decided independently (and always wins) — this only chooses AMONG slots
 * that are already known to be free.
 */
const orderSlots = (slots, originalTime, preferSameTime) => {
  if (!preferSameTime) return slots;
  const target = toMinutes(originalTime);
  if (target === null) return slots;
  return [...slots].sort(
    (a, b) => Math.abs(toMinutes(a) - target) - Math.abs(toMinutes(b) - target)
  );
};

/**
 * Staff who can perform a service at a salon, preferred order first.
 * The original stylist leads when they still work there and still offer the
 * service; the rest follow by id for determinism.
 */
const candidateStaff = async (salonId, serviceId, preferredStaffId) => {
  const rows = await staffModel.findAll({
    where: { salonId, statusbar: 'active' },
    include: [{
      model: servicesModel,
      as: 'services',
      where: { id: serviceId },
      attributes: [],
    }],
    attributes: ['id', 'name'],
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = [];
  if (preferredStaffId && byId.has(preferredStaffId)) ordered.push(byId.get(preferredStaffId));
  for (const r of rows) {
    if (!ordered.some((o) => o.id === r.id)) ordered.push(r);
  }
  return ordered;
};

/**
 * Find the next bookable slot matching a past booking.
 *
 * @param {object} source  the Appointment row being rebooked
 * @param {object} options { horizonDays, staffId, preferSameTime, partySize, now }
 * @returns {Promise<{ok: true, suggestion}|{ok: false, code, reason}>}
 */
const findRebookSlot = async (source, options = {}) => {
  const {
    horizonDays = 14,
    staffId = null,
    preferSameTime = true,
    now = new Date(),
  } = options;

  const service = await servicesModel.findByPk(source.serviceId);
  // An archived service (#51) still exists for historical reports but must
  // never be sold again.
  if (!service || service.statusbar === 'archived') {
    return { ok: false, code: 'SERVICE_UNAVAILABLE', reason: 'This service is no longer offered' };
  }

  const salon = await salonModel.findByPk(source.salonId);
  if (!salon || salon.statusbar === 'inactive') {
    return { ok: false, code: 'SALON_UNAVAILABLE', reason: 'This salon is no longer accepting bookings' };
  }

  const staff = await candidateStaff(source.salonId, source.serviceId, staffId || source.staffId);
  if (staff.length === 0) {
    return { ok: false, code: 'NO_STAFF', reason: 'No one at this salon offers that service any more' };
  }

  // Host-LOCAL day, not UTC: see utils/timezone.localDay. The stored `date`
  // column lives in the host-local frame (validateLeadTime parses
  // `${date}T${time}` without a Z), so "today" has to be read in that same
  // frame or the loop below will scan yesterday's calendar.
  const today = localDay(now);
  const duration = Number(service.duration) || 30;

  // Search day by day. The first day with ANY free slot wins, so the customer
  // gets the earliest appointment available rather than the "best" one three
  // weeks out.
  for (let offset = 0; offset <= horizonDays; offset++) {
    const date = addDays(today, offset);
    const daySlots = slotsForDay(salon, date, duration);
    if (daySlots.length === 0) continue;

    const ordered = orderSlots(daySlots, source.time, preferSameTime);

    for (const startTime of ordered) {
      const endTime = computeEndTime(startTime, duration);

      // Never suggest a slot that has already STARTED today. A salon with no
      // lead time would otherwise happily offer 09:00 at 5pm — the slot is
      // "free" because it's in the past, which is the least useful kind of
      // free. Lead time can't catch this: a null lead time means "bookable
      // immediately", which is about the FUTURE, not about retroactive
      // bookings.
      if (offset === 0) {
        // Same frame as `today` above — host-local, both derived from `now`.
        const nowMinutes = toMinutes(localTime(now));
        if (nowMinutes !== null && toMinutes(startTime) <= nowMinutes) continue;
      }

      // Cheap checks first: these are pure functions of the salon row and
      // cost no queries, so a closed day never reaches the conflict scan.
      const hours = validateSalonHours(salon, date, startTime, endTime);
      if (!hours.ok) continue;
      const lead = validateLeadTime(salon, date, startTime, now.getTime());
      if (!lead.ok) continue;

      // Then the expensive check, once per candidate slot (not per staff).
      const busy = await conflictingStaffIds(
        staff.map((s) => s.id), source.salonId, date, startTime, endTime
      );
      const free = staff.find((s) => !busy.has(s.id));
      if (!free) continue;

      return {
        ok: true,
        suggestion: {
          salonId: source.salonId,
          serviceId: source.serviceId,
          staffId: free.id,
          staffName: free.name,
          // Same stylist as last time is worth telling the customer about —
          // it's the difference between "rebooked" and "rebooked with Priya".
          sameStaff: free.id === source.staffId,
          date,
          time: startTime,
          endTime,
          durationMinutes: duration,
          price: Number(service.price),
          serviceName: service.name,
          salonName: salon.name,
          sourceAppointmentId: source.id,
          daysOut: offset,
        },
      };
    }
  }

  return { ok: false, code: 'NO_SLOT_FOUND', reason: NO_SLOT_REASON };
};

/**
 * Is this appointment something the customer may rebook from?
 * Past/terminal bookings only — rebooking a live upcoming appointment is what
 * the reschedule endpoint (#6) is for, and the two must not overlap.
 */
const isRebookable = (appointment) =>
  Boolean(appointment) && REBOOKABLE_SOURCES.includes(appointment.status);

/**
 * Every service this customer has ever booked, with the most recent booking
 * for each — the "book again" rail on the customer dashboard. One query per
 * customer, grouped in JS to keep it dialect-portable.
 */
const recentDistinctBookings = async (userId, limit = 8) => {
  const rows = await appointmentModel.findAll({
    where: { userId },
    order: [['date', 'DESC'], ['time', 'DESC']],
    limit: 200, // a bounded scan is enough to find a customer's usual set
  });

  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.salonId}|${row.serviceId}|${row.staffId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
};

module.exports = {
  findRebookSlot,
  isRebookable,
  recentDistinctBookings,
  slotsForDay,
  orderSlots,
  candidateStaff,
  REBOOKABLE_SOURCES,
  NO_SLOT_REASON,
  // Re-exported for the controller's "does the service still exist" check.
  _models: { servicesModel, salonModel, staffModel, StaffServices, Op },
};
