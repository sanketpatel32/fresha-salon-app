const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const User = require('../models/userModel');

// Stub the Cashfree gateway BEFORE paymentController is required — the
// controller destructures createOrder at module load, so the stub must be in
// place by then. This keeps "allowed beyond threshold" tests off the network:
// a lead-time PASS reaches createOrder, a BLOCK returns 400 before it.
const cashfree = require('../services/cashfreeServices');
// The real createOrder resolves to response.data.payment_session_id (a bare
// string) — match that shape exactly, since processPayment persists it.
cashfree.createOrder = async () => 'stub-session-id';
const { processPayment } = require('../controllers/paymentController');

const { appointmentChecker } = require('../controllers/appointmentController');
const {
    validateLeadTime,
    resolveSlotStepMinutes,
    DEFAULT_SLOT_STEP_MINUTES,
} = require('../services/availabilityService');
const { getBookingConfig, updateBookingConfig } = require('../controllers/salonBookingConfigController');
const { validate, bookingConfigSchema } = require('../utils/validators');

// Minimal req/res stubs for invoking the controllers directly.
const mockReq = (overrides = {}) => ({ user: {}, query: {}, params: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};
// processPayment reads req.secure / req.headers['x-forwarded-proto'] /
// req.get('host') when building the Cashfree return URL.
const mockPayReq = (overrides = {}) => ({
    user: {}, query: {}, params: {}, body: {},
    headers: {}, secure: false, get: (k) => (k === 'host' ? 'localhost' : undefined),
    ...overrides,
});

// Run bookingConfigSchema validation middleware against a body; returns the
// next(err) error (null when the middleware passed) plus pass/fail.
const runMw = (body) => {
    let err = null;
    let ok = false;
    validate(bookingConfigSchema)({ body }, {}, (e) => { if (e) err = e; else ok = true; });
    return { err, ok };
};

// Local-time YYYY-MM-DD / HH:MM formatters — validateLeadTime parses
// `${dateStr}T${time}` as LOCAL time (same as new Date('YYYY-MM-DDTHH:MM')).
const pad = (n) => String(n).padStart(2, '0');
const dateAt = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const timeAt = (ms) => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Fixtures: hours pinned to 24/7 so the working-hours gate can never fire
// before the lead-time gate — lead-time outcomes stay deterministic.
let salonA, salonB, serviceA, serviceB, staffA1, staffB1, customer;

before(async () => {
    await sequelize.sync({ force: true });

    salonA = await Salons.create({
        name: 'LeadSalonA', email: 'la@t.com', password: 'x', phoneNumber: '1', address: 'a', pricing: 'Moderate',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
        openingTime: '00:00', closingTime: '23:59',
        bookingLeadTimeMinutes: 120, // 2h notice required
        slotStepMinutes: 20,
    });
    salonB = await Salons.create({
        name: 'LeadSalonB', email: 'lb@t.com', password: 'x', phoneNumber: '2', address: 'b', pricing: 'Premium',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
        openingTime: '00:00', closingTime: '23:59',
        bookingLeadTimeMinutes: null, // bookable immediately
        slotStepMinutes: null, // default 30 grid
    });

    serviceA = await Services.create({ name: 'Cut A', price: 100, duration: 30, salonId: salonA.id });
    serviceB = await Services.create({ name: 'Cut B', price: 200, duration: 30, salonId: salonB.id });
    staffA1 = await Staff.create({ name: 'SA1', email: 'sa1@t.com', password: 'x', phoneNumber: '3', salonId: salonA.id });
    staffB1 = await Staff.create({ name: 'SB1', email: 'sb1@t.com', password: 'x', phoneNumber: '4', salonId: salonB.id });
    await staffA1.setServices([serviceA]);
    await staffB1.setServices([serviceB]);

    customer = await User.create({
        name: 'Cust', email: 'cust@t.com', password: 'x', phoneNumber: '5550001111',
    });
});

after(async () => { await sequelize.close(); });

// ── Payment-path enforcement (processPayment → validateLeadTime) ─────────

test('lead time BLOCKS the payment path when the slot is too soon', async () => {
    const now = Date.now();
    const res = mockRes();
    await processPayment(mockReq({
        user: { userId: customer.id },
        body: {
            serviceId: serviceA.id, salonId: salonA.id, duration: 30,
            dateSelect: dateAt(now + 30 * 60 * 1000), // 30 min ahead < 120 min lead
            time: timeAt(now + 30 * 60 * 1000),
            staffId: staffA1.id,
        },
    }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /at least 120 minutes in advance/i);
});

test('lead time ALLOWS the payment path beyond the threshold (gateway stubbed)', async () => {
    const now = Date.now();
    const res = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        body: {
            serviceId: serviceA.id, salonId: salonA.id, duration: 30,
            dateSelect: dateAt(now + 3 * 60 * 60 * 1000), // 3h ahead > 120 min lead
            time: timeAt(now + 3 * 60 * 60 * 1000),
            staffId: staffA1.id,
        },
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.paymentSessionId, 'stub-session-id');
    assert.match(res.body.orderId, /^ORDER-/);
});

test('validateLeadTime boundary: exactly at the threshold passes, one minute sooner fails', () => {
    // Round to the next whole minute first: validateLeadTime re-parses the
    // HH:MM string (second precision), so an unrounded target could land
    // up to 59s below the threshold and flake.
    const now = Date.now();
    const atThreshold = Math.ceil(now / 60000) * 60000 + 120 * 60 * 1000;
    assert.deepEqual(
        validateLeadTime(salonA, dateAt(atThreshold), timeAt(atThreshold), now),
        { ok: true }
    );
    const justUnder = atThreshold - 60 * 1000;
    const blocked = validateLeadTime(salonA, dateAt(justUnder), timeAt(justUnder), now);
    assert.equal(blocked.ok, false);
    assert.match(blocked.reason, /at least 120 minutes in advance/i);
});

test('null lead time means bookable immediately (payment path + helper)', async () => {
    // Helper level.
    assert.deepEqual(validateLeadTime(salonB, dateAt(Date.now()), timeAt(Date.now())), { ok: true });

    // Controller level: a slot minutes from now sails through to the stubbed gateway.
    const now = Date.now();
    const res = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        body: {
            serviceId: serviceB.id, salonId: salonB.id, duration: 30,
            dateSelect: dateAt(now + 5 * 60 * 1000),
            time: timeAt(now + 5 * 60 * 1000),
            staffId: staffB1.id,
        },
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.paymentSessionId, 'stub-session-id');
});

// ── Slot step ─────────────────────────────────────────────────────────────

test('slot step falls back to the default 30 when null/garbage', () => {
    assert.equal(DEFAULT_SLOT_STEP_MINUTES, 30);
    assert.equal(resolveSlotStepMinutes(salonB), 30); // null column
    assert.equal(resolveSlotStepMinutes(null), 30); // missing salon row
    assert.equal(resolveSlotStepMinutes({ slotStepMinutes: null }), 30);
    assert.equal(resolveSlotStepMinutes({ slotStepMinutes: 'not-a-number' }), 30);
    assert.equal(resolveSlotStepMinutes({ slotStepMinutes: 0 }), 30);
    assert.equal(resolveSlotStepMinutes({ slotStepMinutes: 15 }), 15); // configured wins
});

test('availability check response includes informational slotStepMinutes', async () => {
    // Configured salon exposes its own grid…
    const resA = mockRes();
    await appointmentChecker(mockReq({
        body: {
            dateSelect: dateAt(Date.now() + 6 * 60 * 60 * 1000), // well past the 120 min lead
            time: timeAt(Date.now() + 6 * 60 * 60 * 1000),
            salonId: salonA.id, serviceId: serviceA.id, duration: 30,
        },
    }), resA);
    assert.equal(resA.statusCode, 200);
    assert.equal(resA.body.slotStepMinutes, 20);
    assert.equal(resA.body.availableStaff.length, 1);

    // …the unset salon exposes the effective default of 30.
    const resB = mockRes();
    await appointmentChecker(mockReq({
        body: {
            dateSelect: dateAt(Date.now() + 6 * 60 * 60 * 1000),
            time: timeAt(Date.now() + 6 * 60 * 60 * 1000),
            salonId: salonB.id, serviceId: serviceB.id, duration: 30,
        },
    }), resB);
    assert.equal(resB.statusCode, 200);
    assert.equal(resB.body.slotStepMinutes, 30);
});

// ── Config endpoints (GET/PUT round trip, scoped to own salon) ────────────

test('PUT then GET booking-config round-trips for the owning salon', async () => {
    const putRes = mockRes();
    await updateBookingConfig(mockReq({
        user: { role: 'salon', salonId: salonA.id },
        body: { bookingLeadTimeMinutes: 90, slotStepMinutes: '15' }, // string like over-the-wire JSON
    }), putRes);
    assert.equal(putRes.statusCode, 200);
    assert.equal(putRes.body.bookingLeadTimeMinutes, 90);
    assert.equal(putRes.body.slotStepMinutes, 15);

    const getRes = mockRes();
    await getBookingConfig(mockReq({ user: { role: 'salon', salonId: salonA.id } }), getRes);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.salonId, salonA.id);
    assert.equal(getRes.body.bookingLeadTimeMinutes, 90);
    assert.equal(getRes.body.slotStepMinutes, 15);

    // The change is really persisted on the row (and enforced afterwards).
    await salonA.reload();
    assert.equal(salonA.bookingLeadTimeMinutes, 90);
    assert.equal(salonA.slotStepMinutes, 15);
});

test("one salon's config write never touches another salon's policy", async () => {
    const putRes = mockRes();
    await updateBookingConfig(mockReq({
        user: { role: 'salon', salonId: salonB.id }, // B writes its OWN config
        body: { bookingLeadTimeMinutes: 45, slotStepMinutes: null },
    }), putRes);
    assert.equal(putRes.statusCode, 200);
    assert.equal(putRes.body.slotStepMinutes, null); // null stored as null…
    assert.equal(putRes.body.effectiveSlotStepMinutes, 30); // …and labelled with the default

    // A's policy from the earlier round-trip is untouched; B's reads back as written.
    const getA = mockRes();
    await getBookingConfig(mockReq({ user: { role: 'salon', salonId: salonA.id } }), getA);
    assert.equal(getA.body.bookingLeadTimeMinutes, 90);

    const getB = mockRes();
    await getBookingConfig(mockReq({ user: { role: 'salon', salonId: salonB.id } }), getB);
    assert.equal(getB.body.bookingLeadTimeMinutes, 45);
    assert.equal(getB.body.slotStepMinutes, null);
});

// ── bookingConfigSchema middleware (tested directly, like gallery/promos) ─

test('bookingConfigSchema accepts valid configs incl. 0 lead and null step', () => {
    assert.ok(runMw({ bookingLeadTimeMinutes: 0, slotStepMinutes: null }).ok);
    assert.ok(runMw({ bookingLeadTimeMinutes: 10080, slotStepMinutes: 60 }).ok); // max = 7 days
    const coerced = { body: { bookingLeadTimeMinutes: '120', slotStepMinutes: '30' } };
    let passed = false;
    validate(bookingConfigSchema)(coerced, {}, () => { passed = true; });
    assert.ok(passed);
    assert.deepEqual(coerced.body, { bookingLeadTimeMinutes: 120, slotStepMinutes: 30 });
});

test('bookingConfigSchema rejects out-of-range lead times with 400', () => {
    for (const [bad, msg] of [
        [-1, /cannot be negative/i],
        [10081, /exceed 7 days/i],
        [10.5, /whole number/i],
        ['abc', /invalid|number/i],
    ]) {
        const { err, ok } = runMw({ bookingLeadTimeMinutes: bad, slotStepMinutes: 30 });
        assert.equal(ok, false, `expected rejection for lead=${bad}`);
        assert.equal(err.status, 400);
        assert.match(err.message, msg);
    }
});

test('bookingConfigSchema rejects bad slot steps and missing fields with 400', () => {
    for (const [body, msg] of [
        [{ bookingLeadTimeMinutes: 60, slotStepMinutes: 25 }, /must be one of/i],
        [{ bookingLeadTimeMinutes: 60, slotStepMinutes: 7.5 }, /must be one of|whole/i],
        [{ bookingLeadTimeMinutes: 60 }, /expected number/i], // missing step
        [{ slotStepMinutes: 30 }, /expected number/i], // missing lead
    ]) {
        const { err, ok } = runMw(body);
        assert.equal(ok, false, `expected rejection for ${JSON.stringify(body)}`);
        assert.equal(err.status, 400);
        assert.match(err.message, msg);
    }
});
