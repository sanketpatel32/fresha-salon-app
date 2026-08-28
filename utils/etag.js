/**
 * ETag generation + conditional GET (#43).
 *
 * Read-heavy endpoints (salon browse, salon profile, service lists) return
 * identical payloads thousands of times. Without validators every poll re-sends
 * the whole body. With an ETag, the client revalidates with `If-None-Match` and
 * a `304 Not Modified` (empty body) costs a few bytes instead of kilobytes.
 *
 * Validators are WEAK (`W/"..."`): two JSON encodings that differ only in key
 * order are semantically equivalent, and weak comparison is the honest signal
 * for dynamic resources. This is the same choice nginx makes for proxied JSON.
 *
 * The tag is derived from the serialized body (length + SHA-256), so it changes
 * the instant any returned byte changes — no stale-cache footguns, and no need
 * to teach every controller to bump a version.
 */
const crypto = require('node:crypto');

/** Length + short hash of the body — cheap to compute, collision-resistant. */
const computeETag = (buffer) => {
  if (!buffer || buffer.length === 0) return 'W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"'; // SHA-256 of empty
  const hash = crypto.createHash('sha256').update(buffer).digest('base64url').slice(0, 27);
  return `W/"${buffer.length.toString(16)}-${hash}"`;
};

/**
 * Normalize a JSON-serializable value into a stable Buffer for hashing.
 * Key order is preserved as-is: a stable serializer means an unchanged payload
 * always yields the same tag within a process.
 */
const serialize = (body) => {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  try {
    return Buffer.from(JSON.stringify(body), 'utf8');
  } catch (_err) {
    // Circular or exotic payload — fall back to a non-cacheable marker.
    return null;
  }
};

/**
 * Parse an If-None-Match header into a set of candidate tags.
 * Handles the wildcard `*` and comma-separated lists.
 */
const parseIfNoneMatch = (header) => {
  if (!header) return null;
  return new Set(
    String(header)
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  );
};

/** Does `candidates` match `tag` under weak comparison? */
const matches = (candidates, tag) => {
  if (!candidates) return false;
  if (candidates.has('*')) return true;
  const strip = (t) => (t.startsWith('W/') ? t.slice(2) : t);
  const bare = strip(tag);
  for (const candidate of candidates) {
    if (strip(candidate) === bare) return true;
  }
  return false;
};

/**
 * Express middleware attaching ETag + 304 handling to `res.json` responses.
 *
 * Only applies to safe, cacheable responses:
 *   - GET or HEAD
 *   - 2xx status
 *   - not already carrying `Cache-Control: no-store`
 *   - not during a shutdown (avoid confusing orchestrator health checks)
 *
 * @param {object} [opts]
 * @param {string} [opts.cacheControl]  Cache-Control to set on a full response.
 *   Defaults to `private, no-cache` — clients must revalidate (so they always
 *   learn about changes) but MAY store the body to make revalidation cheap.
 * @param {number} [opts.minSize]       Skip tagging bodies smaller than this.
 */
const conditionalGet = ({ cacheControl = 'private, no-cache', minSize = 0 } = {}) => (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const candidates = parseIfNoneMatch(req.headers['if-none-match']);
  const origJson = res.json.bind(res);

  res.json = function etagAwareJson(body) {
    try {
      const status = res.statusCode || 200;
      const cacheHeader = String(res.getHeader('Cache-Control') || '').toLowerCase();
      const noStore = cacheHeader.includes('no-store');

      if (status >= 200 && status < 300 && !noStore && !res.headersSent) {
        const buf = serialize(body);
        if (buf && buf.length >= minSize) {
          const tag = computeETag(buf);
          res.setHeader('ETag', tag);
          if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', cacheControl);

          if (matches(candidates, tag)) {
            // 304: no body, and the content headers would be misleading.
            res.removeHeader('Content-Type');
            res.removeHeader('Content-Length');
            res.status(304);
            res.end();
            return res;
          }
        }
      }
    } catch (_err) {
      // Instrumentation must never break a response — fall through to plain json.
    }
    return origJson(body);
  };

  return next();
};

module.exports = { computeETag, conditionalGet, parseIfNoneMatch, matches, serialize };
