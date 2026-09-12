const { Cashfree } = require("cashfree-pg");
const crypto = require("node:crypto");
const { config } = require("../utils/config");

// Credentials come from the environment — never committed to source.
// The environment is selected from NODE_ENV so prod talks to PRODUCTION
// automatically once the live keys are configured.
Cashfree.XClientId = config.payments.cashfreeAppId;
Cashfree.XClientSecret = config.payments.cashfreeSecretKey;
Cashfree.XEnvironment =
  process.env.NODE_ENV === "production"
    ? Cashfree.Environment.PRODUCTION
    : Cashfree.Environment.SANDBOX;

// ── Demo ("fake") payments ─────────────────────────────────────────────
// When no Cashfree credentials are configured (or PAYMENTS_MODE=demo), there
// is no gateway to talk to. Instead of failing the whole booking flow, orders
// get a demo session id: the checkout UI simulates the payment and the status
// endpoint auto-settles it — see paymentController.getPaymentStatus_. Demo
// session ids are recognizable by prefix so no gateway call is ever made for
// them, and a real (keyed) deployment never produces them.
const DEMO_SESSION_PREFIX = "demo-";

/** True when the app is running payments in simulated demo mode. */
exports.isDemoPayments = () => config.payments.demo;

/** True when a paymentSessionId was minted locally by demo mode. */
exports.isDemoSession = (sessionId) =>
  typeof sessionId === "string" && sessionId.startsWith(DEMO_SESSION_PREFIX);

exports.createOrder = async (
  orderId,
  orderAmount,
  orderCurrency = "INR",
  customerID,
  customerPhone,
  hostUrl = "https://fresha-salon-app.onrender.com"
) => {
  // Demo mode: mint a local session id. No network call — no credentials
  // exist (or demo was forced). The checkout UI detects the prefix and runs
  // the simulated payment instead of the Cashfree drop-in.
  if (config.payments.demo) {
    return DEMO_SESSION_PREFIX + crypto.randomBytes(10).toString("hex");
  }

  try {

    const expiryDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const formattedExpiryDate = expiryDate.toISOString();

    const request = {
      order_amount: Number(orderAmount),
      order_currency: orderCurrency,
      order_id: orderId,

      customer_details: {
        customer_id: String(customerID),
        customer_phone: String(customerPhone),
      },

      order_meta: {
        // Send the customer back into the SPA (not the raw JSON endpoint) so
        // they land on a proper confirmation page. The order id is passed as a
        // query param; the PaymentStatus page reads it and calls the JSON API.
        return_url: `${hostUrl}/payment-status?orderId=${orderId}`,
      },
      order_expiry_time: formattedExpiryDate,
    };

    const response = await Cashfree.PGCreateOrder("2023-08-01", request);

    return response.data.payment_session_id;
  } catch (error) {
    console.error("Error creating order:", error.message);
    throw error;
  }
};

exports.getPaymentStatus = async (orderId) => {
  try {

    const response = await Cashfree.PGOrderFetchPayments("2023-08-01", orderId);

    const transactions = response.data;
    let orderStatus;

    if (transactions.some((t) => t.payment_status === "SUCCESS")) {
      orderStatus = "Success";
    } else if (transactions.some((t) => t.payment_status === "PENDING")) {
      orderStatus = "Pending";
    } else {
      orderStatus = "Failure";
    }

    return orderStatus;

  } catch (error) {
    console.error("Error fetching order status:", error.message);
    throw error;
  }
};

/**
 * Verify a Cashfree webhook signature. This is the server-to-server source of
 * truth for payment success — more trustworthy than the browser redirect,
 * because it's Cashfree calling your server directly with a signed payload.
 *
 * @param {object} body    - the raw webhook body
 * @param {string} signature - the `Webhook-Id` header (or your CF signature header)
 * @param {string} timestamp - the `Webhook-Timestamp` header
 * @param {string} signatureV1 - the `Webhook-Signature` header
 * @returns {object|null} parsed webhook payload if valid, null otherwise
 */
exports.verifyWebhook = (body, signature, timestamp, signatureV1) => {
  try {
    const verificationResponse = Cashfree.PGVerifyWebhookSignature(
      signature,
      body,
      signatureV1,
      timestamp,
      process.env.CASHFREE_SECRET_KEY
    );
    return verificationResponse;
  } catch (error) {
    console.error("Webhook signature verification failed:", error.message);
    return null;
  }
};
