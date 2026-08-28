/**
 * Optimistic concurrency control (#48) — version column + If-Match.
 *
 * The problem: two actors edit the same booking at once and the second write
 * silently wins, discarding the first. For an appointment that means a salon
 * confirming a booking while the customer cancels it, with no trace.
 *
 * The mechanism (HTTP-standard, RFC 9110):
 *   - Every mutable row carries an integer `version`.
 *   - Reads expose it as an ETag: `W/"<id>-<version>"`.
 *   - A mutating request may send `If-Match: W/"12-3"`.
 *   - If the row's version has moved on, the request is rejected with
 *     412 Precondition Failed and the caller re-reads and retries.
 *
 * Why optimistic rather than pessimistic (row locking)? Booking edits are
 * short, human-driven and rarely collide — paying for a lock on every edit
 * would cost far more than the occasional 412. SQLite also makes `SELECT ...
 * FOR UPDATE` awkward, so this is the portable choice.
 *
 * The version check and the increment are deliberately separate from any
 * business logic so controllers stay readable: `assertVersion` validates,
 * `bumpVersion` commits.
 */

const BUILD_ETAG = (id, version) => `W/"${id}-${version}"`;
// Accepts BOTH forms: the weak tag we emit (`W/"12-3"`) and the strong tag a
// client may echo back after stripping the weak prefix (`"12-3"`). The `W/`
// prefix is a single optional unit — making the slash optional on its own
// would also accept the never-valid `W"12-3"`.
const ETAG_RE = /^(?:W\/)?"(-?\d+)-(\d+)"$/;

/**
 * Build the ETag for a versioned row.
 * Versions start at 0 (the ensureColumns backfill default), so a freshly
 * created row is `W/"12-0"` — stable and predictable for clients.
 */
const etagFor = (entity) => {
  if (!entity) return null;
  const id = entity.id ?? entity.get?.('id');
  const version = entity.version ?? entity.get?.('version') ?? 0;
  if (id === undefined || id === null) return null;
  return BUILD_ETAG(id, version);
};

/** Parse an If-Match header value into { id, version } or null. */
const parseIfMatch = (header) => {
  if (!header) return null;
  // A client may send a list of entity tags; require exactly one — we compare
  // against a single known row, and `*` means "any existing representation",
  // which is satisfied by any row that still exists.
  const trimmed = String(header).trim();
  if (trimmed === '*') return { any: true };
  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 1) return null;
  const m = ETAG_RE.exec(parts[0]);
  if (!m) return null;
  return { id: Number(m[1]), version: Number(m[2]) };
};

/**
 * Validate an If-Match header against the row being mutated.
 *
 * @returns {{ok: boolean, status?: number, code?: string, reason?: string}}
 *   ok:true  — no header (unconditional write) or the version matches.
 *   ok:false — 412 when the version moved on, 400 when the header is malformed,
 *              404/409 when it names a different row entirely.
 */
const assertVersion = (req, entity) => {
  const raw = req.headers?.['if-match'];
  if (!raw) return { ok: true, conditional: false };

  const parsed = parseIfMatch(raw);
  if (!parsed) {
    return {
      ok: false, status: 400, code: 'INVALID_IF_MATCH',
      reason: 'If-Match must be a single entity tag like W/"12-3"',
    };
  }
  if (parsed.any) return { ok: true, conditional: false };

  const id = entity?.id ?? entity?.get?.('id');
  const version = entity?.version ?? entity?.get?.('version') ?? 0;

  if (Number(parsed.id) !== Number(id)) {
    return {
      ok: false, status: 409, code: 'IF_MATCH_RESOURCE_MISMATCH',
      reason: 'If-Match refers to a different resource',
    };
  }
  if (Number(parsed.version) !== Number(version)) {
    return {
      ok: false, status: 412, code: 'VERSION_CONFLICT',
      reason: 'This record changed since you last read it. Refresh and retry.',
    };
  }
  return { ok: true, conditional: true };
};

/**
 * Increment the version on a row and persist it.
 * Returns the row (with the new version) so callers can emit a fresh ETag.
 */
const bumpVersion = async (entity) => {
  if (!entity) return null;
  const current = Number(entity.version ?? entity.get?.('version') ?? 0);
  if (typeof entity.increment === 'function') {
    // Model-level increment emits `version = version + 1`, which is atomic in
    // SQL — no read-modify-write race even without a surrounding transaction.
    await entity.increment('version', { by: 1 });
    await entity.reload();
    return entity;
  }
  entity.version = current + 1;
  await entity.save();
  return entity;
};

/**
 * Express helper: run `handler` only if the version precondition holds.
 * Wraps the repetitive 412 plumbing so a controller stays one line longer.
 *
 * Usage:
 *   const guard = assertVersion(req, appointment);
 *   if (!guard.ok) return res.status(guard.status).json({ error: guard.reason });
 */
const versionGuard = (req, entity, res) => {
  const check = assertVersion(req, entity);
  if (check.ok) return null;
  res.setHeader('ETag', etagFor(entity) || '');
  res.status(check.status).json({ error: check.reason, code: check.code });
  return check;
};

/** Attach the current ETag to a response for a versioned row. */
const attachETag = (res, entity) => {
  const tag = etagFor(entity);
  if (tag) res.setHeader('ETag', tag);
  return tag;
};

module.exports = {
  etagFor,
  parseIfMatch,
  assertVersion,
  bumpVersion,
  versionGuard,
  attachETag,
  BUILD_ETAG,
};
