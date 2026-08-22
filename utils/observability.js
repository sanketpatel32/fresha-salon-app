/**
 * Observability helpers: per-request correlation ids, access logging,
 * and a deep health probe.
 *
 * - Every response carries X-Request-Id so a client-reported id can be
 *   traced to exactly one server log line (and vice versa).
 * - Incoming X-Request-Id headers are reused when they look like a UUID so
 *   upstream gateways can stitch end-to-end traces; anything malformed is
 *   replaced with a fresh id rather than trusted.
 * - Nothing here may ever throw into the request path — logging and health
 *   reporting must degrade silently, never take the API down with them.
 */
const crypto = require('crypto');
const logger = require('./logger');
const sequelize = require('./database');

// Canonical 8-4-4-4-12 hex layout (any variant). Used both to validate
// incoming trace ids and asserted by tests for generated ones.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fresh RFC-4122 v4 id (crypto.randomUUID is built into Node ≥14.17). */
const makeRequestId = () => crypto.randomUUID();

/**
 * Assigns req.id (reusing a well-formed incoming X-Request-Id for trace
 * continuity) and echoes it back on every response.
 */
function requestIdMiddleware(req, res, next) {
  const incoming = req.headers ? req.headers['x-request-id'] : undefined;
  if (typeof incoming === 'string' && UUID_RE.test(incoming)) {
    req.id = incoming;
  } else {
    req.id = makeRequestId();
  }
  res.setHeader('X-Request-Id', req.id);
  next();
}

/**
 * Access log: emits ONE logger line per request when the response finishes,
 * with method/url/status/duration/requestId. Wrapped defensively — a broken
 * logger must never break the request itself.
 */
function requestLogger(req, res, next) {
  try {
    const startMs = Date.now();
    res.on('finish', () => {
      try {
        const durationMs = Date.now() - startMs;
        logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`, {
          requestId: req.id,
          statusCode: res.statusCode,
          durationMs,
        });
      } catch (_err) { /* never let logging break the response */ }
    });
  } catch (_err) { /* ditto if even attaching the listener fails */ }
  next();
}

/**
 * Deep health: verifies DB connectivity via authenticate() plus runtime
 * vitals. `ok` mirrors DB status only — callers decide the HTTP code
 * (200 ok / 503 degraded) so the shape stays useful either way.
 */
async function deepHealth() {
  let db = 'up';
  try {
    await sequelize.authenticate();
  } catch (_err) {
    db = 'down';
  }
  return {
    ok: db === 'up',
    db, // 'up' | 'down'
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1)),
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { makeRequestId, requestIdMiddleware, requestLogger, deepHealth, UUID_RE };
