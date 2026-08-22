const {
  createOrder,
  getPaymentStatus,
  verifyWebhook,
} = require("../services/cashfreeServices");
const {
  finalizeAppointmentFromPayment,
  getAuthoritativePrice,
  resolvePromo,
  round2,
} = require("../services/paymentService");
const { computeEndTime, validateSalonHours, validateLeadTime } = require("../services/availabilityService");
const Salons = require("../models/salonsModel");
const Payment = require("../models/paymentModel");
const appointmentModel = require("../models/appointmentModel");
const userModel = require("../models/userModel");
const crypto = require("crypto");

/**
 * Create a Cashfree order for a booking.
 *
 * Security: the order amount is looked up from the services table on the
 * server — the client-supplied `servicePrice` is IGNORED. A client cannot
 * pay ₹1 for a ₹5000 service.
 *
 * Promo codes: an optional `promoCode` is validated against that same
 * authoritative price; when valid, the Cashfree order and the Payment row
 * both carry the DISCOUNTED amount, with originalAmount/discountAmount
 * recorded for the ledger.
 *
 * The caller must be an authenticated customer (enforced by the route).
 */
exports.processPayment = async (req, res) => {
  const userId = req.user.userId;
  const { serviceId, salonId, dateSelect, time, staffId, duration, promoCode } = req.body;

  try {
    // 1. Look up the real price from the DB — never trust the client.
    const priceResult = await getAuthoritativePrice(serviceId, salonId);
    if (priceResult === null) {
      return res.status(404).json({ message: "Service not found" });
    }
    if (priceResult.mismatch) {
      return res.status(400).json({ message: "Service does not belong to this salon" });
    }

    // 1a. Optional promo code, validated against the AUTHORITATIVE price so
    //     min-order rules can't be gamed by client-side math. The schema has
    //     already trimmed + uppercased it; resolvePromo returns a reason that
    //     maps straight to a 400 message.
    let promoResult = null;
    if (promoCode) {
      promoResult = await resolvePromo(promoCode, salonId, priceResult.price);
      if (!promoResult.ok) {
        return res.status(400).json({ message: promoResult.reason });
      }
    }

    // Money math: originalAmount is the full authoritative price,
    // discountAmount what the promo takes off, and orderAmount — the amount
    // BOTH sent to Cashfree and persisted on the Payment row — is the
    // discounted final charge. Keeping the gateway order and our ledger on
    // the same number is non-negotiable.
    const originalAmount = priceResult.price;
    const discountAmount = promoResult ? promoResult.discountAmount : 0;
    const orderAmount = Math.max(0, round2(originalAmount - discountAmount));

    // 1b. Enforce salon working hours/days here too. A customer could otherwise
    //     skip the /appointment/check step and POST straight to /pay with an
    //     out-of-hours slot. Using the shared helper keeps the rule consistent
    //     with the checker.
    const endTime = computeEndTime(time, duration);
    const salon = await Salons.findByPk(salonId);
    const hoursCheck = validateSalonHours(salon, dateSelect, time, endTime);
    if (!hoursCheck.ok) {
      return res.status(400).json({ message: hoursCheck.reason });
    }
    // 1c. Lead-time gate — same rule the availability checker enforces, so a
    //     client that skips /appointment/check can't book at short notice.
    const leadCheck = validateLeadTime(salon, dateSelect, time);
    if (!leadCheck.ok) {
      return res.status(400).json({ message: leadCheck.reason });
    }

    const userDetails = await userModel.findOne({ where: { id: userId } });
    if (!userDetails) {
      return res.status(404).json({ message: "User not found" });
    }

    // Use a cryptographically random order id (not a predictable timestamp).
    const orderId = "ORDER-" + crypto.randomBytes(8).toString("hex");
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

    // 3. endTime was computed at step 1b above (timezone-independent string math,
    //    shared with the checker via availabilityService).

    // 4. Persist the pending payment row. A failure here is NOT swallowed —
    //    if we can't record the order, we must not hand the session id back.
    await Payment.create({
      orderId,
      paymentSessionId,
      orderAmount, // discounted final charge — matches the Cashfree order
      orderCurrency,
      originalAmount,
      discountAmount,
      promoCodeApplied: promoResult ? promoResult.promo.code : null,
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
 * Browser-redirect return URL. Cashfree redirects the customer's browser here
 * after they complete (or abandon) payment.
 *
 * This endpoint requires authentication (customer owner, the involved salon,
 * or admin) — see canAccessPayment. It CANNOT create appointments for arbitrary
 * users — it only flips the payment status it reads from Cashfree's own
 * records, and the appointment creation is idempotent. The authoritative
 * success signal is the webhook below.
 */
/**
 * Resolve whether the authenticated caller may see this payment.
 *
 * Access rules:
 *  - customer: only their own orders (Payment.customerID)
 *  - salon:    only orders booked at their salon (Payment.salonId)
 *  - admin:    all orders
 *
 * Exported for tests.
 */
exports.canAccessPayment = (order, user) => {
  if (!user || !user.role) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'customer') return Number(order.customerID) === Number(user.userId);
  if (user.role === 'salon') return Number(order.salonId) === Number(user.salonId);
  return false;
};

exports.getPaymentStatus_ = async (req, res) => {
  const orderId = req.params.orderId;

  try {
    // Load the order and authorize BEFORE contacting the gateway, so an
    // unauthorized caller cannot trigger Cashfree syncs by guessing ids.
    const order = await Payment.findOne({ where: { orderId } });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (!exports.canAccessPayment(order, req.user)) {
      return res.status(403).json({ message: "Not authorized to view this payment" });
    }

    const orderStatus = await getPaymentStatus(orderId);

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
 * List the authenticated customer's recent payments that haven't been turned
 * into a booking yet — either still Pending at the gateway, or marked Success
 * but with no Appointment row (the webhook-miss case).
 *
 * Used by the "My Appointments" page to show a "Payment received, booking
 * syncing…" banner instead of a bare empty state when a customer paid but the
 * booking hasn't materialized yet (network drop between Cashfree redirect and
 * the webhook).
 */
exports.getStuckPayments = async (req, res) => {
  try {
    const stuck = await Payment.findAll({
      where: {
        customerID: req.user.userId,
        // Surface payments that haven't become a booking: still Pending, marked
        // Success (webhook/booking not yet finalized), or "Slot taken" (the
        // TOCTOU guard refused the booking after payment was captured — the
        // customer needs to know and a refund is owed).
        paymentStatus: ['Pending', 'Success', 'Slot taken'],
      },
      order: [['createdAt', 'DESC']],
      limit: 5,
    });

    const result = await Promise.all(
      stuck.map(async (p) => {
        const appt = await appointmentModel.findOne({ where: { orderId: p.orderId } });
        return {
          orderId: p.orderId,
          paymentStatus: p.paymentStatus,
          orderAmount: p.orderAmount,
          hasBooking: !!appt,
          createdAt: p.createdAt,
        };
      })
    );

    // Only return the ones that are genuinely "stuck" (no booking yet).
    res.json(result.filter((p) => !p.hasBooking));
  } catch (error) {
    console.error("Error fetching stuck payments:", error.message);
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
