'use strict';

// Shared pagination plumbing for list endpoints.
//
// Contract (backward compatible):
//   - When NEITHER ?page nor ?limit is supplied, the endpoint keeps its legacy
//     response shape (a bare JSON array) — existing frontend code keeps working.
//   - When EITHER param is supplied, the endpoint responds with an envelope:
//     { data: [...], page, limit, total, totalPages }.

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

/**
 * Coerce a single raw query value into a bounded positive integer.
 * Garbage (non-numeric strings) falls back to `fallback`; numbers outside
 * [min, max] are clamped rather than rejected.
 */
const coerceIntParam = (value, fallback, min, max) => {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback; // garbage -> default
    return Math.min(Math.max(Math.trunc(n), min), max);
};

/**
 * Read pagination options from req.query.
 * Returns { requested, page, limit, offset }:
 *   requested — true when the caller supplied page and/or limit
 *               (i.e. they opted into the envelope response shape).
 *   page      — 1-based page number (default 1, min 1).
 *   limit     — page size (default 10, clamped to [1, 50]).
 *   offset    — precomputed for Sequelize findAndCountAll.
 */
const paginateQuery = (req) => {
    const q = req.query || {};
    const requested = q.page !== undefined || q.limit !== undefined;
    // Note: detection is on page/limit ONLY — endpoints like customer
    // /getAll receive unrelated params (e.g. userId) and must stay legacy.
    const page = coerceIntParam(q.page, DEFAULT_PAGE, DEFAULT_PAGE, Number.MAX_SAFE_INTEGER);
    const limit = coerceIntParam(q.limit, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
    return { requested, page, limit, offset: (page - 1) * limit };
};

/** Build the envelope meta block for a paginated response. */
const buildMeta = (page, limit, total) => ({
    page,
    limit,
    total,
    totalPages: Math.ceil(total / Math.max(limit, 1)),
});

module.exports = { paginateQuery, buildMeta, DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT };
