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

module.exports = { sendBookingConfirmation };
