/**
 * Idempotency middleware (#46).
 *
 * Wraps a mutating endpoint so a retried request replays the original response
 * instead of re-executing the handler. Essential for anything that charges
 * money or creates a booking, where a network timeout leaves the client unable
 * to tell success from failure.
 *
 * Protocol (Stripe-compatible, so existing client libraries work):
 *   - Client sends `Idempotency-Key: <uuid>` (16..128 chars).
 *   - First execution: handler runs, response is captured and stored.
 *   - Retry with same key + same body: stored response replayed verbatim,
 *     with `Idempotency-Replayed: true` added so the caller can tell.
 *   - Retry with same key + DIFFERENT body: 409 — the key is bound to the
 *     original request.
 *   - Concurrent retry while the first is still in flight: 409 with
 *     `Idempotency-Status: in-flight` rather than racing into a double charge.
 *
 * Only successful (2xx) and client-error (4xx) responses are cached. A 5xx is
 * NOT stored, so a client can retry after a transient server fault and get a
 * genuine re-execution.
 */
const crypto = require('node:crypto');
const logger = require('./logger');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Canonical request fingerprint: method + path + stable-serialized body. */
const fingerprint = ({ method, path, body }) => {
  const canonicalBody = body === undefined || body === null
    ? ''
    : JSON.stringify(body, Object.keys(body).sort());
  return crypto
    .createHash('sha256')
    .update(`${String(method).toUpperCase()}|${path}|${canonicalBody}`)
    .digest('hex');
};

/** Stable scope so one user's keys can never collide with another's. */
const scopeOf = (req) => {
  if (req.user && req.user.role && req.user.id !== undefined && req.user.id !== null) {
    return `${req.user.role}:${req.user.id}`;
  }
  return 'anon';
};

const now = () => new Date();

/**
 * Delete rows past their TTL. Called opportunistically on write so the table
 * stays small without needing a separate scheduler.
 */
const prune = async (Model) => {
  try {
    const deleted = await Model.destroy({ where: { expiresAt: { [Model.sequelize.Op?.lt ?? 'lt']: now() } } });
    if (deleted > 0) logger.debug(`idempotency: pruned ${deleted} expired key(s)`);
  } catch (_err) { /* pruning is best-effort */ }
};

/**
 * Build the idempotency middleware.
 *
 * @param {object} [opts]
 * @param {number} [opts.ttlMs]       How long a stored response stays replayable.
 * @param {boolean} [opts.required]   Reject requests with no key (400) instead
 *   of passing them through untouched.
 * @param {(req:object)=>string|null} [opts.keyFrom]  Custom key extractor.
 */
const idempotency = ({ ttlMs = DEFAULT_TTL_MS, required = false, keyFrom = null } = {}) => {
  // Required lazily: requiring the model at module load forces a sequelize
  // connection in contexts (unit tests) that may not want one.
  let Model = null;
  const model = () => {
    if (!Model) Model = require('../models/idempotencyModel');
    return Model;
  };

  return async function idempotencyMiddleware(req, res, next) {
    const raw = keyFrom
      ? keyFrom(req)
      : (req.headers['idempotency-key'] || req.headers['x-idempotency-key']);

    if (!raw) {
      if (required) {
        return res.status(400).json({ error: 'Idempotency-Key header is required for this endpoint' });
      }
      return next();
    }

    const key = String(raw).trim();
    if (!KEY_RE.test(key)) {
      return res.status(400).json({
        error: 'Idempotency-Key must be 16-128 characters of [A-Za-z0-9_-]',
      });
    }

    // Body-based fingerprint: the route MUST run body parsing before us.
    const hash = fingerprint({ method: req.method, path: req.baseUrl + (req.path || ''), body: req.body });
    const scope = scopeOf(req);

    try {
      const existing = await model().findOne({ where: { scope, key } });

      if (existing) {
        if (existing.requestHash !== hash) {
          logger.warn('idempotency: key reused with a different request body', { scope, key });
          return res.status(409).json({
            error: 'Idempotency key was already used with a different request',
            code: 'IDEMPOTENCY_KEY_REUSED',
          });
        }
        if (!existing.completedAt) {
          // The original attempt is still running — let it finish rather than
          // charging twice in parallel.
          return res.status(409).json({
            error: 'A request with this idempotency key is still in progress',
            code: 'IDEMPOTENCY_IN_FLIGHT',
          });
        }
        // Replay: same status, same body, plus a marker.
        res.setHeader('Idempotency-Replayed', 'true');
        if (existing.responseBody) {
          try {
            return res.status(existing.statusCode || 200).json(JSON.parse(existing.responseBody));
          } catch (_parseErr) {
            // Corrupt stored body — fall through to a fresh execution.
            logger.error('idempotency: stored response body was not valid JSON; re-executing');
          }
        }
        return res.status(existing.statusCode || 200).end();
      }

      // Reserve the key BEFORE running the handler so a concurrent retry sees
      // the in-flight row. A unique-constraint violation here means we lost a
      // race with a parallel identical request, which is safe to treat as
      // in-flight.
      try {
        await model().create({
          scope,
          key,
          requestHash: hash,
          expiresAt: new Date(Date.now() + ttlMs),
        });
      } catch (createErr) {
        const isUniqueViolation = createErr && (
          createErr.name === 'SequelizeUniqueConstraintError' || createErr.name === 'SequelizeValidationError'
        );
        if (isUniqueViolation) {
          return res.status(409).json({
            error: 'A request with this idempotency key is still in progress',
            code: 'IDEMPOTENCY_IN_FLIGHT',
          });
        }
        throw createErr;
      }
    } catch (err) {
      // A store failure must never block the operation — degrade to
      // non-idempotent execution rather than returning errors for a healthy API.
      logger.error('idempotency: store failure, proceeding without idempotency', { error: err.message });
      return next();
    }

    // Capture the response so it can be replayed.
    const origJson = res.json.bind(res);
    res.json = function captureJson(body) {
      const statusCode = res.statusCode || 200;
      // 5xx is not cached: a transient server error should be retryable for
      // real, not replayed back forever.
      if (statusCode < 500) {
        (async () => {
          try {
            await model().update(
              {
                statusCode,
                responseBody: typeof body === 'string' ? body : JSON.stringify(body),
                completedAt: now(),
              },
              { where: { scope, key } }
            );
            prune(model());
          } catch (err) {
            logger.error('idempotency: failed to persist response', { error: err.message });
          }
        })();
      } else {
        // Release the reservation so the client can retry cleanly.
        (async () => {
          try {
            await model().destroy({ where: { scope, key } });
          } catch (_err) { /* ignore */ }
        })();
      }
      res.json = origJson;
      return origJson(body);
    };

    return next();
  };
};

/** Wipe the store — used by tests. */
const clearStore = async () => {
  const Model = require('../models/idempotencyModel');
  await Model.destroy({ where: {} });
};

module.exports = { idempotency, fingerprint, scopeOf, clearStore, DEFAULT_TTL_MS, KEY_RE };
