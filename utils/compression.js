/**
 * Response compression — gzip and brotli, implemented on node:zlib.
 *
 * Why not the `compression` npm package? This project keeps its dependency
 * footprint deliberately small, and gzip is ~40 lines on top of the standard
 * library. We get exactly the behaviour we want (JSON/HTML-only, size
 * threshold, no-transform respect) with no new install.
 *
 * How it works: `res.write`/`res.end` are wrapped to buffer the outgoing body.
 * When the response finishes, the buffer is compressed ONCE and sent as a
 * single chunk with `Content-Encoding` set. Buffering is safe here because this
 * API only ever emits small JSON/text payloads — it is not a streaming proxy.
 *
 * Skipped when any of these hold (the response is then passed through byte-for-byte):
 *   - the client sent no `Accept-Encoding` with gzip/br/identity
 *   - the status has no body (204, 304) or the request was HEAD
 *   - `Cache-Control: no-transform` is set (RFC 7231 forbids transforming it)
 *   - the `x-no-compression` request header is present (escape hatch)
 *   - the content type isn't compressible, or the body is under `threshold`
 */
const zlib = require('node:zlib');

const DEFAULT_THRESHOLD = 1024; // bytes — below this, gzip costs more than it saves

/** Content types worth compressing (binary formats are already compressed). */
const COMPRESSIBLE_RE = /^(?:text\/|application\/(?:json|javascript|xml|xhtml|ld\+json|graphql)|image\/(?:svg\+xml|bmp)|font\/)/i;

const isCompressibleType = (contentType) => {
  if (!contentType) return false;
  // Strip parameters: "application/json; charset=utf-8" -> "application/json"
  const base = String(contentType).split(';')[0].trim();
  return COMPRESSIBLE_RE.test(base);
};

/**
 * Pick the best encoding the client accepts, honouring the shared
 * `Accept-Encoding` preference order. Returns null when nothing applies.
 */
const negotiate = (acceptEncoding, { enableBrotli = true } = {}) => {
  if (!acceptEncoding || typeof acceptEncoding !== 'string') return null;
  const supported = [];
  for (const part of acceptEncoding.split(',')) {
    const [token, ...params] = part.trim().toLowerCase().split(';');
    if (!token) continue;
    // q=0 means "never send this".
    let q = 1;
    for (const p of params) {
      const [k, v] = p.split('=').map((s) => s.trim());
      if (k === 'q' && v !== undefined) {
        const parsed = Number(v);
        if (Number.isFinite(parsed)) q = parsed;
      }
    }
    if (q <= 0) continue;
    supported.push({ token, q });
  }
  // Prefer brotli (smaller) over gzip (more compatible) over nothing.
  if (enableBrotli && typeof zlib.brotliCompress === 'function' && supported.some((s) => s.token === 'br')) return 'br';
  if (supported.some((s) => s.token === 'gzip')) return 'gzip';
  return null;
};

/** Compress with the chosen codec. Returns a promise of the Buffer. */
const compress = (buf, encoding, level) =>
  new Promise((resolve, reject) => {
    const done = (err, out) => (err ? reject(err) : resolve(out));
    if (encoding === 'br') {
      zlib.brotliCompress(buf, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: Math.min(11, Math.max(0, level)) },
      }, done);
    } else {
      zlib.gzip(buf, { level }, done);
    }
  });

/**
 * Build the compression middleware.
 *
 * @param {object} [opts]
 * @param {number} [opts.threshold]  Minimum body size to compress (bytes).
 * @param {number} [opts.level]      Compression level 0..9 (gzip) / 0..11 (br).
 * @param {boolean} [opts.enableBrotli] Offer brotli when the client asks for it.
 */
const compression = ({
  threshold = DEFAULT_THRESHOLD,
  level = 6,
  enableBrotli = true,
} = {}) => (req, res, next) => {
  // Escape hatch for debugging / upstream proxies that mangle encodings.
  if (req.headers['x-no-compression']) return next();

  const encoding = negotiate(req.headers['accept-encoding'], { enableBrotli });
  if (!encoding) return next();

  // Ensure Vary reflects that our response depends on Accept-Encoding,
  // otherwise a shared cache may serve a gzipped body to a client that can't
  // decode it. Existing Vary values are preserved.
  const existingVary = res.getHeader('Vary');
  const varyValues = String(existingVary || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (!varyValues.includes('accept-encoding')) varyValues.push('Accept-Encoding');
  res.setHeader('Vary', varyValues.join(', '));

  const chunks = [];
  let bufferedBytes = 0;
  let aborted = false;

  const collect = (chunk) => {
    if (chunk == null || aborted) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buf);
    bufferedBytes += buf.length;
  };

  const origWrite = res.write;
  const origEnd = res.end;

  // If the response has already been written by an earlier middleware we can't
  // retro-compress it; fall through untouched.
  if (res.headersSent) return next();

  res.write = function wrappedWrite(chunk, encodingArg, callback) {
    if (aborted) return true;
    collect(chunk);
    // Report backpressure as "all good" since nothing hit the socket yet.
    return true;
  };

  res.end = function wrappedEnd(chunk, encodingArg, callback) {
    if (aborted) return res;
    if (chunk != null) collect(chunk);

    // Release the patched methods so any later call behaves normally.
    res.write = origWrite;
    res.end = origEnd;

    const finalize = () => {
      // Run any callback the caller passed to end().
      if (typeof encodingArg === 'function') encodingArg();
      else if (typeof callback === 'function') callback();
    };

    const sendRaw = () => {
      const body = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, bufferedBytes);
      if (body.length > 0) origWrite.call(res, body);
      origEnd.call(res);
      return finalize();
    };

    // HEAD and bodyless statuses carry no payload to compress.
    if (req.method === 'HEAD' || [204, 304].includes(res.statusCode)) {
      return sendRaw();
    }

    // Respect an explicit no-transform directive.
    const cacheControl = String(res.getHeader('Cache-Control') || '').toLowerCase();
    if (cacheControl.includes('no-transform')) return sendRaw();

    // If the app is streaming (headers already flushed) we've lost our chance.
    if (res.headersSent) return sendRaw();

    if (bufferedBytes < threshold || !isCompressibleType(res.getHeader('Content-Type'))) {
      return sendRaw();
    }

    const body = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, bufferedBytes);
    compress(body, encoding, level)
      .then((compressed) => {
        // Only use the compressed form when it actually helps. Some tiny or
        // already-random payloads grow under gzip.
        if (!compressed || compressed.length >= body.length) return sendRaw();
        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Content-Length', String(compressed.length));
        origWrite.call(res, compressed);
        origEnd.call(res);
        return finalize();
      })
      .catch((err) => {
        // A compression failure must never lose the response — send it plain.
        res.write = origWrite;
        res.end = origEnd;
        try {
          if (!res.headersSent) {
            res.setHeader('Content-Length', String(body.length));
          }
          origWrite.call(res, body);
          origEnd.call(res);
        } catch (_ignored) { /* socket already gone */ }
        finalize();
        return undefined;
      });
    return res;
  };

  return next();
};

module.exports = { compression, negotiate, isCompressibleType, DEFAULT_THRESHOLD };
