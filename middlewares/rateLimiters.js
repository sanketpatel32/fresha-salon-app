/**
 * Shared rate limiters.
 *
 * strictLimiter was originally defined inline in app.js for the login mounts;
 * it lives here so credential endpoints defined in route files (e.g. the public
 * password-reset pair) can apply the exact same policy without duplicating
 * options or drifting out of sync: 5 requests / 15 min / IP.
 *
 * #53: `standardHeaders: 'draft-7'` emits the RateLimit-Limit / -Remaining /
 * -Reset trio so well-behaved clients can back off intelligently instead of
 * guessing at a window they were never told about.
 *
 * #54: `perRoleLimiter` replaces the one-size-fits-all ceiling with quotas that
 * match what each role actually does. A customer browsing salons legitimately
 * makes far more requests than an admin deleting users, and a single flat limit
 * forces a bad tradeoff: high enough for browse means far too permissive for
 * destructive admin actions.
 */
const rateLimit = require('express-rate-limit');
const { config } = require('../utils/config');

/**
 * Build a limiter with the project's standard header + message conventions.
 *
 * The resolved options are re-attached to the returned middleware. express-rate-
 * limit v7+ returns a bare function exposing only `resetKey`/`getKey`, so the
 * configured `max`/`windowMs` are otherwise unreadable — which makes a limiter
 * impossible to introspect in tests or from an ops endpoint. Attaching them
 * costs nothing at runtime and turns "what quota is this route under?" from
 * archaeology into a property read.
 */
const makeLimiter = ({ windowMs, max, message, keyGenerator }) => {
  const options = {
    windowMs,
    max,
    standardHeaders: config.rateLimit.standardHeaders ? 'draft-7' : false,
    legacyHeaders: false,
    message: { error: message },
    ...(keyGenerator ? { keyGenerator } : {}),
  };
  const limiter = rateLimit(options);
  limiter.max = max;
  limiter.windowMs = windowMs;
  limiter.options = options;
  return limiter;
};

const strictLimiter = makeLimiter({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  message: 'Too many login attempts, please try again later.',
});

/**
 * Per-role request quotas (#54), in requests per minute.
 *
 * Rationale per role:
 *  - customer: browse + search is chatty (debounced but still frequent), and a
 *    customer-facing app must never feel throttled during normal use.
 *  - salon: dashboard analytics polls; moderate headroom.
 *  - staff: a small, focused surface (today's schedule) — needs little.
 *  - admin: destructive and rare. The tightest quota by far, because an admin
 *    token is the highest-value credential in the system.
 */
const ROLE_QUOTAS = Object.freeze({
  customer: 120,
  salon: 90,
  staff: 60,
  admin: 30,
  // Unauthenticated traffic: the general app.js limiter already caps this at
  // config.rateLimit.max; this entry is the fallback when a role is unknown.
  anonymous: config.rateLimit.max,
});

const ROLE_WINDOW_MS = 60 * 1000;

/**
 * Key the limiter on the authenticated principal when we have one, falling back
 * to IP for anonymous traffic.
 *
 * Keying on the principal matters: an IP-based limit punishes everyone behind
 * a shared NAT (an office, a mobile carrier) for one person's behaviour, and
 * does nothing to stop a single user spreading requests across IPs. Keying on
 * `role:id` bounds the actual actor — while still falling back to IP so
 * unauthenticated floods are capped.
 */
const principalKey = (req) => {
  if (req.user && req.user.role) {
    const id = req.user.id ?? req.user.userId ?? req.user.salonId ?? req.user.staffId ?? 'unknown';
    return `${req.user.role}:${id}`;
  }
  // Anonymous: fall back to IP (with the proxy-aware ip already resolved by
  // app.set('trust proxy')).
  return `ip:${req.ip || 'unknown'}`;
};

/**
 * Per-role limiter. Mount AFTER authMiddleware so req.user is populated —
 * mounted earlier, every request would be treated as anonymous.
 */
const perRoleLimiter = makeLimiter({
  windowMs: ROLE_WINDOW_MS,
  // Quota depends on the resolved role, so `max` is dynamic. Built through
  // makeLimiter so `.max` stays introspectable as the function itself.
  max: (req) => {
    const role = req.user?.role;
    return (role && ROLE_QUOTAS[role]) || ROLE_QUOTAS.anonymous;
  },
  keyGenerator: principalKey,
  message: 'Too many requests for your account type, please slow down.',
});

/**
 * Tight limiter for expensive read endpoints (CSV export, analytics, reports).
 * These touch far more rows per request than a normal read, so they get their
 * own small budget rather than sharing the general one.
 */
const expensiveReadLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many export/report requests, please try again shortly.',
  keyGenerator: principalKey,
});

/** Write operations that create money movement. Very tight by design. */
const moneyWriteLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: 'Too many payment requests, please slow down.',
  keyGenerator: principalKey,
});

module.exports = {
  strictLimiter,
  perRoleLimiter,
  expensiveReadLimiter,
  moneyWriteLimiter,
  makeLimiter,
  principalKey,
  ROLE_QUOTAS,
  ROLE_WINDOW_MS,
};
