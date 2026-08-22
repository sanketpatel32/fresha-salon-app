/**
 * Email domain service — thin wrapper around Brevo for transactional email.
 *
 * Lazy-initialized: the Brevo client is only constructed on first send AND only
 * when BREVO_API_KEY + SENDER_EMAIL are set, so a missing key never affects app
 * boot or request handling. All public methods resolve to no-ops (returning
 * { sent: false, reason }) when email is unconfigured, so callers can always
 * fire-and-forget.
 */
require('dotenv').config();

let _client = null;
function client() {
  if (_client) return _client;
  if (!process.env.BREVO_API_KEY || !process.env.SENDER_EMAIL) return null;
  const Sib = require('sib-api-v3-sdk');
  const c = Sib.ApiClient.instance;
  c.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;
  _client = {
    api: new Sib.TransactionalEmailsApi(),
    sender: { email: process.env.SENDER_EMAIL, name: 'Fresha Salon' },
  };
  return _client;
}

/**
 * Send a booking confirmation email for a finalized payment/order.
 * @param {object} ctx - { order, customer, staff, service, salon } plain objects
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function sendBookingConfirmation(ctx) {
  const c = client();
  if (!c) return { sent: false, reason: 'not-configured' };

  const { order, customer, staff, service, salon } = ctx;
  if (!order || !customer) return { sent: false, reason: 'missing-data' };

  const subject = 'Your Appointment Details';
  const textContent = [
    `Dear ${customer.name},`,
    '',
    'Thank you for booking with us! Here are your appointment details:',
    '',
    `- Appointment Date: ${order.dateSelected}`,
    `- Appointment Time: ${order.timeSelected} - ${order.endTime}`,
    `- Service: ${service?.name || '—'}`,
    `- Staff: ${staff?.name || '—'}${staff?.phoneNumber ? ` (${staff.phoneNumber})` : ''}`,
    `- Salon: ${salon?.name || '—'}`,
    `- Amount Paid: ₹${order.orderAmount}`,
    '',
    'We look forward to serving you!',
    '',
    'Best regards,',
    'Fresha Team',
  ].join('\n');

  const htmlContent = `
    <p>Dear ${customer.name},</p>
    <p>Thank you for booking with us! Here are your appointment details:</p>
    <ul>
      <li><strong>Appointment Date:</strong> ${order.dateSelected}</li>
      <li><strong>Appointment Time:</strong> ${order.timeSelected} - ${order.endTime}</li>
      <li><strong>Service:</strong> ${service?.name || '—'}</li>
      <li><strong>Staff:</strong> ${staff?.name || '—'}${staff?.phoneNumber ? ` (${staff.phoneNumber})` : ''}</li>
      <li><strong>Salon:</strong> ${salon?.name || '—'}</li>
      <li><strong>Amount Paid:</strong> ₹${order.orderAmount}</li>
    </ul>
    <p>We look forward to serving you!</p>
    <p>Best regards,<br>Fresha Team</p>
  `;

  try {
    await c.api.sendTransacEmail({
      sender: c.sender,
      to: [{ email: customer.email }],
      subject,
      textContent,
      htmlContent,
    });
    return { sent: true };
  } catch (error) {
    // Email failure must never break the booking flow — log and move on.
    console.error('❌ Error sending booking email:', error.response?.body || error.message);
    return { sent: false, reason: 'send-failed' };
  }
}

/**
 * Send a password reset link. Fire-and-forget like booking confirmations:
 * resolves to { sent: false, reason: 'not-configured' } when Brevo isn't set
 * up, so the auth flow never breaks (or reveals anything) because of email.
 * @param {object} ctx - { to, name, resetLink }
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function sendPasswordResetEmail(ctx) {
  const c = client();
  if (!c) return { sent: false, reason: 'not-configured' };
  if (!ctx?.to || !ctx?.resetLink) return { sent: false, reason: 'missing-data' };

  const subject = 'Reset Your Password';
  const textContent = [
    `Dear ${ctx.name || 'customer'},`,
    '',
    'We received a request to reset your password.',
    'The link below is valid for the next 60 minutes:',
    '',
    ctx.resetLink,
    '',
    "If you didn't request this, you can safely ignore this email —",
    'your password will stay unchanged.',
    '',
    'Best regards,',
    'Fresha Team',
  ].join('\n');

  const htmlContent = `
    <p>Dear ${ctx.name || 'customer'},</p>
    <p>We received a request to reset your password. Click the link below — it is valid for the next <strong>60 minutes</strong>:</p>
    <p><a href="${ctx.resetLink}">Reset my password</a></p>
    <p>If you didn't request this, you can safely ignore this email — your password will stay unchanged.</p>
    <p>Best regards,<br>Fresha Team</p>
  `;

  try {
    await c.api.sendTransacEmail({
      sender: c.sender,
      to: [{ email: ctx.to }],
      subject,
      textContent,
      htmlContent,
    });
    return { sent: true };
  } catch (error) {
    // Email failure must never break the auth flow — log and move on.
    console.error('❌ Error sending password reset email:', error.response?.body || error.message);
    return { sent: false, reason: 'send-failed' };
  }
}

module.exports = { sendBookingConfirmation, sendPasswordResetEmail };
