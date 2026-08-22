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
 * Whether transactional email can actually be sent (Brevo key + sender set).
 * Lets callers decide up front whether issuing an email-bound token is worth
 * it (e.g. verification tokens are only generated when a mail can go out).
 * Deliberately reads the env vars directly instead of client(), so asking
 * the question never builds or caches an SDK client.
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.SENDER_EMAIL);
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

/**
 * Send an email verification link for a new customer signup. Same
 * fire-and-forget contract as the reset mail: resolves to a no-op result when
 * Brevo isn't configured, so signup never blocks (or breaks) on email.
 * @param {object} ctx - { to, name, verifyLink }
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function sendVerificationEmail(ctx) {
  const c = client();
  if (!c) return { sent: false, reason: 'not-configured' };
  if (!ctx?.to || !ctx?.verifyLink) return { sent: false, reason: 'missing-data' };

  const subject = 'Verify Your Email';
  const textContent = [
    `Dear ${ctx.name || 'customer'},`,
    '',
    'Welcome to Fresha Salon! Please confirm your email address.',
    'The link below is valid for the next 24 hours:',
    '',
    ctx.verifyLink,
    '',
    "If you didn't create this account, you can safely ignore this email.",
    '',
    'Best regards,',
    'Fresha Team',
  ].join('\n');

  const htmlContent = `
    <p>Dear ${ctx.name || 'customer'},</p>
    <p>Welcome to Fresha Salon! Confirm your email address by clicking the link below — it is valid for the next <strong>24 hours</strong>:</p>
    <p><a href="${ctx.verifyLink}">Verify my email</a></p>
    <p>If you didn't create this account, you can safely ignore this email.</p>
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
    console.error('❌ Error sending verification email:', error.response?.body || error.message);
    return { sent: false, reason: 'send-failed' };
  }
}

/**
 * Subject/body copy per bookable status change. Kept as pure data + functions
 * so subjects are trivially assertable (and guaranteed distinct) without ever
 * sending mail.
 */
const BOOKING_STATUS_COPY = {
  confirmed: {
    subject: (s) => `Your booking at ${s} is confirmed`,
    title: 'Your booking is confirmed',
    line: 'See you soon! Here are your appointment details:',
    closing: 'Need to make a change? Please contact the salon at least 24 hours before your slot.',
  },
  declined: {
    subject: (s) => `Your booking at ${s} was declined`,
    title: 'Unfortunately, your booking was declined',
    line: 'The salon could not accept this booking request.',
    closing: 'You are not charged — please try booking another slot.',
  },
  completed: {
    subject: (s) => `Thanks for visiting ${s} — your booking is completed`,
    title: 'Your visit is complete',
    line: 'Thank you for coming in!',
    closing: 'We would love to hear about your experience — feel free to leave a review.',
  },
  'no-show': {
    subject: (s) => `Your booking at ${s} was marked no-show`,
    title: 'Your booking was marked as a no-show',
    line: 'The salon recorded that this appointment was missed.',
    closing: 'If you think this is a mistake, please contact the salon.',
  },
  cancelled: {
    subject: (s) => `Your booking at ${s} was cancelled`,
    title: 'Your booking has been cancelled',
    line: 'This appointment will not take place.',
    closing: 'You can book a new slot whenever you are ready.',
  },
};

/**
 * Friendly subject line for a booking status change. Pure — no client, no env
 * reads — so callers/tests can inspect copy without any mail being sent.
 * @param {string} status - confirmed|declined|completed|no-show|cancelled
 * @param {string} [salonName]
 * @returns {string|null} null when the status has no copy
 */
function bookingStatusSubject(status, salonName) {
  const copy = BOOKING_STATUS_COPY[status];
  return copy ? copy.subject(salonName || 'the salon') : null;
}

/**
 * Send the customer a transactional "your booking changed" email. Same
 * fire-and-forget contract as every other helper here: resolves to a no-op
 * result when Brevo isn't configured and never throws.
 * @param {string} toEmail - customer's email address
 * @param {object} ctx - { status, salonName?, serviceName?, date?, time? }
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function sendBookingStatusEmail(toEmail, ctx = {}) {
  const c = client();
  if (!c) return { sent: false, reason: 'not-configured' };

  const { status, salonName, serviceName, date, time } = ctx;
  const copy = BOOKING_STATUS_COPY[status];
  if (!toEmail || !copy) return { sent: false, reason: 'missing-data' };

  const where = salonName || 'the salon';
  const subject = copy.subject(where);
  const details = [
    ['Service', serviceName],
    ['Date', date],
    ['Time', time],
    ['Salon', salonName],
  ];
  const textContent = [
    'Dear customer,', '',
    copy.title, '',
    copy.line, '',
    ...details.map(([label, value]) => `- ${label}: ${value || '—'}`), '',
    copy.closing, '',
    'Best regards,', 'Fresha Team',
  ].join('\n');
  const htmlContent = `
    <p>Dear customer,</p>
    <p><strong>${copy.title}</strong></p>
    <p>${copy.line}</p>
    <ul>${details.map(([label, value]) => `<li><strong>${label}:</strong> ${value || '—'}</li>`).join('')}</ul>
    <p>${copy.closing}</p>
    <p>Best regards,<br>Fresha Team</p>
  `;

  try {
    await c.api.sendTransacEmail({
      sender: c.sender,
      to: [{ email: toEmail }],
      subject,
      textContent,
      htmlContent,
    });
    return { sent: true };
  } catch (error) {
    // Email failure must never break the booking flow — log and move on.
    console.error('❌ Error sending booking status email:', error.response?.body || error.message);
    return { sent: false, reason: 'send-failed' };
  }
}

module.exports = {
  isConfigured,
  sendBookingConfirmation,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendBookingStatusEmail,
  bookingStatusSubject,
};
