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
const { conflictingStaffIds } = require('./availabilityService');

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

  // Re-check the slot is still free. Single-staff scope; returns a Set.
  const conflicted = await conflictingStaffIds(
    [order.staffId],
    order.salonId,
    order.dateSelected,
    order.timeSelected,
    order.endTime
  );
  if (conflicted.has(order.staffId)) {
    // Do not create a clashing appointment. Mark the payment so the failure is
    // visible rather than silently dropping the booking.
    order.paymentStatus = 'Slot taken';
    await order.save();
    const err = new Error('The selected slot was just taken by another booking');
    err.code = 'SLOT_TAKEN';
    throw err;
  }

  const salon = await salonModel.findByPk(order.salonId);
  const requiresApproval = salon && salon.requiresApproval;
  const initialStatus = requiresApproval ? 'pending' : 'confirmed';

  const appointment = await appointmentModel.create({
    orderId: order.orderId,
    staffId: order.staffId,
    salonId: order.salonId,
    serviceId: order.serviceId,
    userId: order.customerID,
    date: order.dateSelected,
    time: order.timeSelected,
    endTime: order.endTime,
    status: initialStatus,
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
};
