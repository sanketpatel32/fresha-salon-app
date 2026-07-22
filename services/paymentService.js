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

/**
 * Finalize a successful payment into an appointment.
 *
 * Idempotent: if an appointment already exists for this orderId, returns the
 * existing one instead of creating a duplicate. This protects against:
 *   - the browser-redirect handler and the webhook firing for the same order
 *   - a user refreshing the success page
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

  const salon = await salonModel.findByPk(order.salonId);
  const requiresApproval = salon && salon.requiresApproval;
  const initialStatus = requiresApproval ? 'pending' : 'confirmed';

  return appointmentModel.create({
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
