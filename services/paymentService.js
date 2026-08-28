/**
 * Payment domain service — owns the payment -> appointment lifecycle.
 *
 * Extracted from paymentController so the controller stays thin (parse
 * request -> call service -> shape response) and the business rule
 * ("a successful payment creates exactly one appointment, idempotently")
 * is testable in isolation.
 */
const Payment = require('../models/paymentModel');
const appointmentModel = require('../models/appointmentModel');
const salonModel = require('../models/salonsModel');
const PromoCode = require('../models/promoCodeModel');
const { conflictingStaffIds } = require('./availabilityService');
const { createBookingSafely } = require('./bookingGuard');

/**
 * Round to 2 decimal places (currency-safe: epsilon nudges avoid the classic
 * 4.675 -> 4.67 float artifact).
 */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Pure discount math for a validated promo against an order amount.
 * percent → value% of amount, capped by maxDiscountAmount when set;
 * flat    → value straight off. Returns the discount rounded to paise.
 */
const computeDiscount = (promo, amount) => {
  let discount;
  if (promo.discountType === 'percent') {
    discount = (Number(amount) * Number(promo.discountValue)) / 100;
  } else {
    discount = Number(promo.discountValue);
  }
  if (promo.discountType === 'percent' &&
      promo.maxDiscountAmount != null && Number(promo.maxDiscountAmount) > 0) {
    discount = Math.min(discount, Number(promo.maxDiscountAmount));
  }
  return round2(discount);
};

// The exact client-facing reasons resolvePromo can return — the controller
// maps them to 400s verbatim, so tests can assert on these strings.
const PROMO_REASONS = {
  invalid: 'Invalid promo code',
  expired: 'Promo code expired',
  minOrder: 'Minimum order amount not met',
  limitReached: 'Promo code usage limit reached',
};

/**
 * Resolve + validate a promo code for a booking.
 *
 * Checks (in order): exists & active → within [validFrom..validUntil]
 * (inclusive when set) → salon scope (null matches any salon) → min order
 * amount → usage limit. Wrong-salon codes report as "Invalid" so callers
 * can't probe which codes exist at other salons.
 *
 * @returns {Promise<{ok:true, discountAmount:number, promo:object}
 *                 |{ok:false, reason:string}>}
 */
const resolvePromo = async (rawCode, salonId, amount) => {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { ok: false, reason: PROMO_REASONS.invalid };

  const promo = await PromoCode.findOne({ where: { code } });
  if (!promo || !promo.isActive) return { ok: false, reason: PROMO_REASONS.invalid };

  const now = new Date();
  if ((promo.validFrom && now < new Date(promo.validFrom)) ||
      (promo.validUntil && now > new Date(promo.validUntil))) {
    return { ok: false, reason: PROMO_REASONS.expired };
  }

  if (promo.salonId != null && Number(promo.salonId) !== Number(salonId)) {
    return { ok: false, reason: PROMO_REASONS.invalid };
  }

  if (Number(amount) < Number(promo.minOrderAmount || 0)) {
    return { ok: false, reason: PROMO_REASONS.minOrder };
  }

  if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) {
    return { ok: false, reason: PROMO_REASONS.limitReached };
  }

  return { ok: true, discountAmount: computeDiscount(promo, amount), promo };
};

/**
 * Finalize a successful payment into an appointment.
 *
 * Idempotent: if an appointment already exists for this orderId, returns the
 * existing one instead of creating a duplicate. This protects against:
 *   - the browser-redirect handler and the webhook firing for the same order
 *   - a user refreshing the success page
 *
 * TOCTOU guard: between the customer's availability check and payment, another
 * customer could have taken the same staff slot. Before creating the row we
 * re-run the conflict query; if the staff is now busy we refuse the booking and
 * flip the payment to a distinct "Slot taken" status so the redirect handler can
 * tell the customer (and an operator can arrange a refund). The money is still
 * captured by Cashfree — refund handling is a separate flow.
 *
 * @param {object} order - a Payment row (must have orderId, salonId, etc.)
 * @returns {Promise<object>} the appointment (existing or newly created)
 */
const finalizeAppointmentFromPayment = async (order) => {
  const existing = await appointmentModel.findOne({
    where: { orderId: order.orderId },
  });
  if (existing) {
    return existing;
  }

  // AVAILABILITY DECISION (group bookings): partySize deliberately plays no
  // part here — one professional serves the whole party, so a booking for 20
  // occupies exactly the same single staff slot as a solo booking and needs
  // no conflict-logic changes.
  const salon = await salonModel.findByPk(order.salonId);
  const requiresApproval = salon && salon.requiresApproval;
  const initialStatus = requiresApproval ? 'pending' : 'confirmed';

  // #47: create through the double-booking guard rather than a bare create.
  // It re-checks the slot AND converts a database uniqueness violation (from
  // the partial unique index, when two payments finalize for the same slot in
  // the same instant) into one consistent SLOT_TAKEN failure. Previously the
  // check-then-insert gap could produce two bookings for one chair.
  const result = await createBookingSafely(
    {
      orderId: order.orderId,
      staffId: order.staffId,
      salonId: order.salonId,
      serviceId: order.serviceId,
      userId: order.customerID,
      date: order.dateSelected,
      time: order.timeSelected,
      endTime: order.endTime,
      status: initialStatus,
      // The customer's free-text note was captured at order creation and
      // carried on the Payment row; it lands on the booking here. Null-safe
      // for legacy rows that predate notes.
      customerNote: order.customerNote || null,
      // Same for the group size: `|| 1` covers legacy Payment rows that
      // predate party bookings (the model default also guards this).
      partySize: order.partySize || 1,
    },
    {
      staffId: order.staffId,
      salonId: order.salonId,
      date: order.dateSelected,
      startTime: order.timeSelected,
      endTime: order.endTime,
    }
  );

  if (!result.ok) {
    // Do not create a clashing appointment. Mark the payment so the failure is
    // visible rather than silently dropping the booking.
    order.paymentStatus = 'Slot taken';
    await order.save();
    const err = new Error(result.reason);
    err.code = result.code;
    throw err;
  }
  const appointment = result.appointment;

  // Tip bookkeeping: mark any tip on this order as captured now that the
  // booking exists. Admin tip totals only count Success rows with this flag
  // set, so a tipped order that never finalizes can't inflate them. The
  // idempotent early-return above means redirect + webhook replays for the
  // same order never reach this twice. Failures are swallowed like the promo
  // counter below: a missed flag under-reports one stat but must never undo
  // an already-captured booking.
  if (order.tipCaptured !== 1) {
    try {
      order.tipCaptured = 1;
      await order.save();
    } catch (err) {
      console.error('Tip capture flag update failed:', err.message);
    }
  }

  // Redeem the promo exactly once per booking. Only the success path reaches
  // here — the idempotent early-return above prevents replays (redirect +
  // webhook firing for the same order) from double-counting. Atomic SQL
  // increment, and failures are swallowed: a broken promo counter must never
  // undo an already-captured booking.
  if (order.promoCodeApplied) {
    try {
      await PromoCode.increment('usedCount', {
        by: 1,
        where: { code: order.promoCodeApplied },
      });
    } catch (err) {
      console.error('Promo usage increment failed:', err.message);
    }
  }

  // Fire-and-forget in-app notification to the salon about the new booking.
  // Runs after the appointment row exists; notify() swallows its own errors.
  setImmediate(async () => {
    try {
      const service = await require('../models/servicesModel').findByPk(order.serviceId);
      const { notify } = require('./notificationService');
      await notify({
        recipientRole: 'salon',
        recipientId: order.salonId,
        type: 'booking.new',
        title: 'New booking',
        body: `${service ? service.name : 'Service'} on ${order.dateSelected} at ${order.timeSelected}`,
        appointmentId: appointment.id,
      });
    } catch (err) {
      require('../utils/logger').error('New-booking notification failed:', err.message);
    }
  });

  // Fire-and-forget a booking confirmation email. Loaded lazily and no-ops when
  // Brevo isn't configured, so this can never break the booking itself. Not
  // awaited — the customer's appointment is already saved.
  setImmediate(async () => {
    try {
      const { sendBookingConfirmation } = require('./emailService');
      const [customer, staff, service] = await Promise.all([
        require('../models/userModel').findByPk(order.customerID),
        require('../models/staffModel').findByPk(order.staffId),
        require('../models/servicesModel').findByPk(order.serviceId),
      ]);
      await sendBookingConfirmation({
        order: order.toJSON ? order.toJSON() : order,
        customer,
        staff,
        service,
        salon,
      });
    } catch (err) {
      console.error('Booking confirmation email failed:', err.message);
    }
  });

  return appointment;
};

/**
 * Look up the authoritative price for a service, validating it belongs to
 * the claimed salon. Returns null if the service doesn't exist or the salon
 * ownership is wrong.
 */
const getAuthoritativePrice = async (serviceId, salonId) => {
  const servicesModel = require('../models/servicesModel');
  const service = await servicesModel.findByPk(serviceId);
  if (!service) return null;
  if (service.salonId !== salonId) return { mismatch: true };
  return { price: service.price };
};

module.exports = {
  finalizeAppointmentFromPayment,
  getAuthoritativePrice,
  round2,
  computeDiscount,
  resolvePromo,
  PROMO_REASONS,
};
