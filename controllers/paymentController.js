const {
  createOrder,
  getPaymentStatus,
  verifyWebhook,
} = require("../services/cashfreeServices");
const Payment = require("../models/paymentModel");
const userModel = require("../models/userModel");
const appointmentModel = require("../models/appointmentModel");
const salonModel = require("../models/salonsModel");
const servicesModel = require("../models/servicesModel");
const crypto = require("crypto");

/**
 * Create a Cashfree order for a booking.
 *
 * Security: the order amount is looked up from the services table on the
 * server — the client-supplied `servicePrice` is IGNORED. A client cannot
 * pay ₹1 for a ₹5000 service.
 *
 * The caller must be an authenticated customer (enforced by the route).
 */
exports.processPayment = async (req, res) => {
  const userId = req.user.userId;
  const { serviceId, salonId, dateSelect, time, staffId, duration } = req.body;

  try {
    // 1. Look up the real price from the DB — never trust the client.
    const service = await servicesModel.findByPk(serviceId);
    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }
    if (service.salonId !== salonId) {
      return res.status(400).json({ message: "Service does not belong to this salon" });
    }

    const userDetails = await userModel.findOne({ where: { id: userId } });
    if (!userDetails) {
      return res.status(404).json({ message: "User not found" });
    }

    // Use a cryptographically random order id (not a predictable timestamp).
    const orderId = "ORDER-" + crypto.randomBytes(8).toString("hex");
    const orderAmount = service.price; // from the DB, authoritative
    const orderCurrency = "INR";
    const customerID = userId.toString();
    const customerPhone = userDetails.phoneNumber;

    const protocol =
      req.secure || req.headers["x-forwarded-proto"] === "https"
        ? "https"
        : "http";
    const hostUrl = `${protocol}://${req.get("host")}`;

    // 2. Create the order in Cashfree.
    const paymentSessionId = await createOrder(
      orderId,
      orderAmount,
      orderCurrency,
      customerID,
      customerPhone,
      hostUrl
    );

    // 3. Compute the end time for the booking window.
    const [hours, minutes] = String(time).split(":").map(Number);
    const startDate = new Date();
    startDate.setHours(hours, minutes, 0);
    const endDate = new Date(startDate.getTime() + Number(duration) * 60 * 1000);
    const endTime = endDate.toTimeString().slice(0, 5);

    // 4. Persist the pending payment row. A failure here is NOT swallowed —
    //    if we can't record the order, we must not hand the session id back.
    await Payment.create({
      orderId,
      paymentSessionId,
      orderAmount,
      orderCurrency,
      paymentStatus: "Pending",
      customerID: userId,
      dateSelected: dateSelect,
      timeSelected: time,
      staffId,
      serviceId,
      salonId,
      duration,
      endTime,
    });

    res.json({ paymentSessionId, orderId });
  } catch (error) {
    console.error("Error processing payment:", error.message);
    res.status(500).json({ message: "Error processing payment" });
  }
};

/**
 * Shared logic for finalizing a successful payment into an appointment.
 * Used by both the browser-redirect handler and the webhook handler.
 *
 * Idempotent: if an appointment already exists for this orderId, it returns
 * the existing one instead of creating a duplicate.
 */
const finalizeAppointmentFromPayment = async (order) => {
  // Idempotency: don't create a second appointment for the same payment.
  const existing = await appointmentModel.findOne({ where: { orderId: order.orderId } });
  if (existing) {
    return existing;
  }

  const salon = await salonModel.findByPk(order.salonId);
  const initialStatus = salon && salon.requiresApproval ? "pending" : "confirmed";

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
 * Browser-redirect return URL. Cashfree redirects the customer's browser here
 * after they complete (or abandon) payment.
 *
 * This endpoint is public (no auth) because Cashfree issues the redirect, but
 * it CANNOT create appointments for arbitrary users — it only flips the payment
 * status it reads from Cashfree's own records, and the appointment creation is
 * idempotent. The authoritative success signal is the webhook below.
 */
exports.getPaymentStatus_ = async (req, res) => {
  const orderId = req.params.orderId;

  try {
    const orderStatus = await getPaymentStatus(orderId);

    const order = await Payment.findOne({ where: { orderId } });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    order.paymentStatus = orderStatus;
    await order.save();

    if (orderStatus === "Success") {
      try {
        await finalizeAppointmentFromPayment(order);
      } catch (error) {
        console.error("Error saving appointment:", error.message);
      }
    }

    // Return JSON instead of the old inline HTML page. The SPA handles the
    // success/failure UI, and the old page referenced a removed route.
    res.json({
      paymentStatus: order.paymentStatus,
      orderId: order.orderId,
      orderAmount: order.orderAmount,
    });
  } catch (error) {
    console.error("Error fetching payment status:", error.message);
    res.status(500).json({ message: "Error fetching payment status" });
  }
};

/**
 * Cashfree webhook — the authoritative server-to-server payment notification.
 * This is the trusted source of truth; the browser redirect above is just a UX
 * convenience. Configure this URL in your Cashfree dashboard under Webhooks.
 *
 * Route: POST /api/pay/webhook (public — Cashfree signs the payload).
 */
exports.handleWebhook = async (req, res) => {
  try {
    const signature = req.headers["webhook-id"];
    const timestamp = req.headers["webhook-timestamp"];
    const signatureV1 = req.headers["webhook-signature"];
    // req.rawBody is captured by the express.json() verify hook in app.js.
    // Fall back to re-serializing if it wasn't captured (e.g. in tests).
    const rawBody = req.rawBody
      ? req.rawBody
      : (typeof req.body === "string" || Buffer.isBuffer(req.body)
          ? req.body
          : JSON.stringify(req.body));

    const verified = verifyWebhook(rawBody, signature, timestamp, signatureV1);
    if (!verified) {
      console.warn("Webhook signature verification failed");
      return res.status(400).send("Invalid signature");
    }

    const { data } = req.body;
    const orderId = data && data.order && data.order.order_id;
    if (!orderId) {
      return res.status(400).send("Missing order id");
    }

    const order = await Payment.findOne({ where: { orderId } });
    if (!order) {
      // 200 so Cashfree doesn't keep retrying an order we don't track.
      return res.status(200).send("Order not found");
    }

    // Re-fetch the authoritative status from Cashfree, then finalize.
    const orderStatus = await getPaymentStatus(orderId);
    order.paymentStatus = orderStatus;
    await order.save();

    if (orderStatus === "Success") {
      await finalizeAppointmentFromPayment(order);
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook handler error:", error.message);
    res.status(500).send("Webhook error");
  }
};
