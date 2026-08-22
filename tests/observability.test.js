const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations');
const {
    makeRequestId,
    requestIdMiddleware,
    requestLogger,
    deepHealth,
    UUID_RE,
} = require('../utils/observability');
const logger = require('../utils/logger');

// ---- Minimal req/res stubs (same style as pagination.test.js) ----

const mockReq = (headers = {}, originalUrl = '/api/test') => ({ headers, method: 'GET', originalUrl });

const mockRes = () => {
    const r = { headers: {}, listeners: {} };
    r.setHeader = (name, value) => { r.headers[name] = value; return r; };
    r.on = (event, cb) => { r.listeners[event] = cb; return r; };
    return r;
};

// Spy on the logger module itself (observability calls logger.info via
// property lookup, so patching works regardless of LOG_LEVEL filtering).
let capturedLogs = [];

// ---------- makeRequestId ----------

test('makeRequestId returns a valid UUID v4-format string', () => {
    const id = makeRequestId();
    assert.match(id, UUID_RE);
});

test('makeRequestId generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, makeRequestId));
    assert.equal(ids.size, 100);
});

// ---------- requestIdMiddleware ----------

test('middleware: generates a fresh UUID when no header present', () => {
    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;
    requestIdMiddleware(req, res, () => { nextCalled = true; });
    assert.match(req.id, UUID_RE);
    assert.equal(nextCalled, true);
    assert.equal(res.headers['X-Request-Id'], req.id);
});

test('middleware: reuses a VALID incoming UUID for trace continuity', () => {
    const incoming = makeRequestId();
    const req = mockReq({ 'x-request-id': incoming });
    const res = mockRes();
    requestIdMiddleware(req, res, () => {});
    assert.equal(req.id, incoming);
    assert.equal(res.headers['X-Request-Id'], incoming);
});

test('middleware: rejects MALFORMED incoming id and generates a new one', () => {
    for (const bad of ['not-a-uuid', '12345', '../../../etc/passwd', `${makeRequestId()}-extra`, '']) {
        const req = mockReq({ 'x-request-id': bad });
        const res = mockRes();
        requestIdMiddleware(req, res, () => {});
        assert.match(req.id, UUID_RE);
        assert.notEqual(req.id, bad);
        assert.equal(res.headers['X-Request-Id'], req.id);
    }
});

// ---------- requestLogger ----------

test('requestLogger logs exactly once on finish with all fields', () => {
    const original = logger.info;
    logger.info = (...args) => {
        capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    try {
        const before_ = capturedLogs.length;
        const req = mockReq({}, '/api/appointment/getall?page=2');
        req.id = makeRequestId(); // as if requestIdMiddleware ran first
        const res = mockRes();
        let nextCalled = false;
        requestLogger(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
        // Nothing logged until the response actually finishes.
        assert.equal(capturedLogs.length, before_);
        res.statusCode = 200;
        res.listeners.finish(); // simulate Express firing 'finish'
        assert.equal(capturedLogs.length, before_ + 1);
        const line = capturedLogs[before_];
        assert.ok(line.includes('GET'), 'has method');
        assert.ok(line.includes('/api/appointment/getall?page=2'), 'has originalUrl');
        assert.ok(line.includes('200'), 'has statusCode');
        assert.ok(/\d+ms/.test(line), 'has durationMs');
        assert.ok(line.includes(req.id), 'has requestId');
    } finally {
        logger.info = original;
    }
});

test('requestLogger survives a throwing res.on (never throws into next)', () => {
    const req = mockReq();
    const res = { on: () => { throw new Error('boom'); } };
    let nextCalled = false;
    requestLogger(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
});

// ---------- deepHealth ----------

test('deepHealth reports db up with full shape while connection is open', async () => {
    const h = await deepHealth();
    assert.deepEqual(Object.keys(h).sort(), ['db', 'memoryRssMb', 'nodeVersion', 'ok', 'timestamp', 'uptimeSeconds'].sort());
    assert.equal(h.db, 'up');
    assert.equal(h.ok, true);
    assert.ok(Number.isFinite(h.uptimeSeconds) && h.uptimeSeconds >= 0);
    assert.ok(h.memoryRssMb > 0);
    assert.ok(/^v\d+\./.test(h.nodeVersion));
    assert.ok(!Number.isNaN(Date.parse(h.timestamp)));
});

// Last test on purpose: closing the pool forces authenticate() to fail so we
// can assert graceful degradation without stubbing internals.
test('deepHealth reports db down gracefully after sequelize.close()', async () => {
    await sequelize.close();
    const h = await deepHealth();
    assert.equal(h.db, 'down');
    assert.equal(h.ok, false); // ok mirrors db up — no fake healthy here
    assert.ok(Number.isFinite(h.uptimeSeconds));
    assert.ok(h.memoryRssMb > 0);
    assert.ok(typeof h.nodeVersion === 'string');
    assert.ok(!Number.isNaN(Date.parse(h.timestamp)));
});
