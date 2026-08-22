/**
 * Shared rate limiters.
 *
 * strictLimiter was originally defined inline in app.js for the login mounts;
 * it now lives here so credential endpoints defined in route files (e.g. the
 * public password-reset pair) can apply the exact same policy without
 * duplicating options or drifting out of sync: 5 requests / 15 min / IP.
 */
const rateLimit = require('express-rate-limit');

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

module.exports = { strictLimiter };
