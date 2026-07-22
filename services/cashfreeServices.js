const { Cashfree } = require("cashfree-pg");
const dotenv = require("dotenv");
dotenv.config();

// Credentials come from the environment — never committed to source.
// The environment is selected from NODE_ENV so prod talks to PRODUCTION
// automatically once the live keys are configured.
Cashfree.XClientId = process.env.CASHFREE_APP_ID;
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY;
Cashfree.XEnvironment =
  process.env.NODE_ENV === "production"
    ? Cashfree.Environment.PRODUCTION
    : Cashfree.Environment.SANDBOX;

exports.createOrder = async (
  orderId,
  orderAmount,
  orderCurrency = "INR",
  customerID,
  customerPhone,
  hostUrl = "https://fresha-salon-app.onrender.com"
) => {
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
        return_url: `${hostUrl}/api/pay/${orderId}`,
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
