const express = require('express');
const router = express.Router();
const { processPayment, getPaymentStatus_, handleWebhook } = require('../controllers/paymentController');
const authMiddleware = require('../middlewares/authMiddleware');
const { validate, paymentCreateSchema } = require('../utils/validators');

// Create an order (authenticated customer).
router.post('/', authMiddleware, authMiddleware.requireRole('customer'), validate(paymentCreateSchema), processPayment);

// Cashfree webhook — the authoritative payment notification.
// Public (Cashfree calls it); the signature is verified over req.rawBody,
// which the top-level express.json() verify hook captured. Note: this route
// MUST be declared before the parameterized GET below.
router.post('/webhook', handleWebhook);

// Browser redirect after payment. Public (Cashfree issues the redirect);
// appointment creation is idempotent so it cannot be abused.
router.get('/:orderId', getPaymentStatus_);

module.exports = router;
