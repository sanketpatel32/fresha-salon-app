const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const User = require('../models/userModel');
const Appointment = require('../models/appointmentModel');
const Payment = require('../models/paymentModel');
const PromoCode = require('../models/promoCodeModel');

// Stub the Cashfree gateway BEFORE paymentController is required — the
// controller destructures createOrder at module load (same trick as
// party-size.test.js / booking-notes.test.js). The stub records every call so
// tipped orders can be proven to reach the gateway with the TIPPED amount.
const cashfree = require('../services/cashfreeServices');
const gatewayCalls = [];
cashfree.createOrder = async (orderId, orderAmount) => {
    gatewayCalls.push({ orderId, orderAmount });
    return 'stub-tip-session-id';
};
const { processPayment } = require('../controllers/paymentController');
const { finalizeAppointmentFromPayment } = require('../services/paymentService');
const { getPlatformStats } = require('../controllers/adminController');
const { validate, paymentCreateSchema } = require('../utils/validators');

// Minimal req/res stubs for invoking the controllers directly.
const mockReq = (overrides = {}) => ({ user: {}, query: {}, params: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null, headers: {} };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    r.setHeader = (name, value) => { r.headers[name] = value; return r; };
    r.send = (data) => { r.body = data; return r; };
    return r;
};
// processPayment reads req.secure / req.get('host') when building the
// Cashfree return URL.
const mockPayReq = (overrides = {}) => ({
    user: {}, query: {}, params: {}, body: {},
    headers: {}, secure: false, get: (k) => (k === 'host' ? 'localhost' : undefined),
    ...overrides,
});

// Run a schema's validation middleware against a body; returns the next(err)
// error (null when the middleware passed). Same style as party-size tests.
const runMw = (schema, body) => {
    let err = null;
    validate(schema)({ body }, {}, (e) => { if (e) err = e; });
    return err;
};

// Future slot helpers (>24h out so lead-time gates never bite).
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysFromNow = (days) => new Date(Date.now() + days * 24 * 3600 * 1000);

let customer, salonA, staffA, service500, serviceDecimal;
// Filled from the fixtures at call time (before() has run by then).
const baseBody = (serviceId) => ({
    serviceId,
    salonId: salonA && salonA.id,
    staffId: staffA && staffA.id,
    dateSelect: ymd(daysFromNow(3)), time: '10:00', duration: 30,
});

before(async () => {
    await sequelize.sync({ force: true });

    customer = await User.create({ name: 'Tipper', email: 'tip@t.com', password: 'x', phoneNumber: '1' });
    // Open 24/7 so neither the hours gate nor lead time (unset -> 0) blocks
    // the payment fixtures.
    salonA = await Salons.create({
        name: 'Tips Salon', email: 'ts@t.com', password: 'x', phoneNumber: '2', address: 'a', pricing: 'Premium',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '00:00', closingTime: '23:59',
    });
    staffA = await Staff.create({ name: 'Stylist Tips', email: 'stt@t.com', password: 'x', phoneNumber: '3', salonId: salonA.id });
    service500 = await Services.create({ name: 'Signature Cut', price: 500, duration: 60, salonId: salonA.id });
    serviceDecimal = await Services.create({ name: 'Decimal Trim', price: 33.33, duration: 45, salonId: salonA.id });

    // /pay now enforces staff-service eligibility (same source as the
    // availability checker and reschedule), so the fixture must link them.
    await staffA.setServices([service500, serviceDecimal]);

    // Promos for the discount+tip interactions.
    await PromoCode.create({ code: 'PCT10CAP40', discountType: 'percent', discountValue: 10, maxDiscountAmount: 40 }); // 500 -> min(50, 40) = 40 off
    await PromoCode.create({ code: 'FLAT100', discountType: 'flat', discountValue: 100, minOrderAmount: 300 });        // 500 -> 400
    await PromoCode.create({ code: 'MIN600PCT5', discountType: 'percent', discountValue: 5, minOrderAmount: 600 });    // price 500 can NEVER reach this on its own
});

after(async () => { await sequelize.close(); });

// ── Schema layer (middleware invoked directly) ───────────────────────────

test('paymentCreateSchema rejects negative, over-limit, and garbage tips with 400', () => {
    const base = baseBody(service500.id);
    for (const bad of [-1, -0.01, 10000.01, 20000, 'abc', {}, 'free money']) {
        const err = runMw(paymentCreateSchema, { ...base, tipAmount: bad });
        assert.ok(err, `tipAmount=${JSON.stringify(bad)} should be rejected`);
        assert.equal(err.status, 400, `tipAmount=${JSON.stringify(bad)} maps to 400`);
    }
});

test('paymentCreateSchema accepts the 0..10000 boundaries, coerces strings, and rounds to 2dp', () => {
    const base = baseBody(service500.id);
    // Bounds are enforced BEFORE rounding, so 10000.01 can't sneak under via
    // rounding while 10000 itself is allowed.
    assert.equal(runMw(paymentCreateSchema, { ...base, tipAmount: 0 }), null, '0 accepted');
    assert.equal(runMw(paymentCreateSchema, { ...base, tipAmount: 10000 }), null, '10000 accepted');

    // The SPA may send a string — coercion makes it a number...
    const coerced = paymentCreateSchema.parse({ ...base, tipAmount: '25.5' });
    assert.strictEqual(coerced.tipAmount, 25.5);
    // ...and sub-paise dust is rounded away to 2dp.
    const rounded = paymentCreateSchema.parse({ ...base, tipAmount: '49.999' });
    assert.strictEqual(rounded.tipAmount, 50);
    const dust = paymentCreateSchema.parse({ ...base, tipAmount: 7.776 });
    assert.strictEqual(dust.tipAmount, 7.78);
});

test('omitted tip stays undefined and explicit null parses as null (no-tip contract)', () => {
    const base = baseBody(service500.id);
    const bare = paymentCreateSchema.safeParse(base);
    assert.ok(bare.success);
    assert.equal(bare.data.tipAmount, undefined, 'omitting means no tip');

    const nulled = paymentCreateSchema.safeParse({ ...base, tipAmount: null });
    assert.ok(nulled.success);
    assert.equal(nulled.data.tipAmount, null, 'an explicit JSON null is also no tip');
});

// ── Charge math through processPayment ────────────────────────────────────

// Deliberately placed BEFORE any processPayment call: the ledger is still
// completely empty here (schema tests create no rows), so this proves the
// COALESCE default on a genuinely empty payments table, independent of what
// later tests capture.
test('admin stats expose totalTips defaulting to 0 on an empty ledger, existing keys untouched', async () => {
    assert.equal(await Payment.count(), 0, 'precondition: no payments yet');

    const res = mockRes();
    await getPlatformStats({ query: {}, user: { role: 'admin' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.totalTips, 0, 'empty ledger -> 0, never null');

    // Existing keys from iteration #16 are all still present.
    for (const key of ['totalSalons', 'totalCustomers', 'totalStaff', 'appointmentsByStatus',
        'revenueTotal', 'last7Days', 'serverTimestamp']) {
        assert.ok(key in res.body, `${key} still exposed`);
    }
});

test('no-discount booking + tip charges price+tip on BOTH the gateway order and the ledger', async () => {
    const payRes = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        body: { ...baseBody(service500.id), time: '10:00', tipAmount: 50 },
    }), payRes);
    assert.equal(payRes.statusCode, 200);

    const gw = gatewayCalls.find((c) => c.orderId === payRes.body.orderId);
    assert.ok(gw, 'order reached Cashfree');
    assert.equal(Number(gw.orderAmount), 550, 'gateway sees the TIPPED total');

    const order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
    assert.equal(Number(order.orderAmount), 550, 'ledger matches the gateway order');
    assert.equal(Number(order.tipAmount), 50, 'tip persisted for an auditable breakdown');
    assert.equal(Number(order.originalAmount), 500);
    assert.equal(Number(order.discountAmount), 0);
});

test('capped-percent promo + tip: the discount hits the SERVICE only, the tip rides on top', async () => {
    const payRes = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        body: { ...baseBody(service500.id), time: '11:00', promoCode: 'PCT10CAP40', tipAmount: 25.75 },
    }), payRes);
    assert.equal(payRes.statusCode, 200);

    // 10% of 500 = 50, capped at 40 -> 460 service charge + 25.75 tip.
    const gw = gatewayCalls.find((c) => c.orderId === payRes.body.orderId);
    assert.equal(Number(gw.orderAmount), 485.75, 'gateway sees discounted charge + full tip');

    const order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
    assert.equal(Number(order.orderAmount), 485.75);
    assert.equal(Number(order.originalAmount), 500);
    assert.equal(Number(order.discountAmount), 40, 'the cap applies to the service price, not the tip');
    assert.equal(Number(order.tipAmount), 25.75);
});

test('flat promo + tip behaves identically (the tip itself is never discounted)', async () => {
    const payRes = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        body: { ...baseBody(service500.id), time: '12:00', promoCode: 'FLAT100', tipAmount: 9.99 },
    }), payRes);
    assert.equal(payRes.statusCode, 200);

    const gw = gatewayCalls.find((c) => c.orderId === payRes.body.orderId);
    assert.equal(Number(gw.orderAmount), 409.99);

    const order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
    assert.equal(Number(order.orderAmount), 409.99);
    assert.equal(Number(order.tipAmount), 9.99, 'tip stored untouched by the promo');
});

test('rounding edge: decimal price + tip lands exactly on 2dp (float dust stripped)', async () => {
    const payRes = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        // 33.33 + 7.77 is 41.099999999999994 in IEEE doubles — the final
        // charge must still come out as exactly 41.1 everywhere.
        body: { ...baseBody(serviceDecimal.id), time: '13:00', duration: 45, tipAmount: 7.77 },
    }), payRes);
    assert.equal(payRes.statusCode, 200);

    const gw = gatewayCalls.find((c) => c.orderId === payRes.body.orderId);
    assert.equal(Number(gw.orderAmount), 41.1, 'no float dust reaches the gateway');

    const order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
    assert.equal(Number(order.orderAmount), 41.1, 'and none reaches the ledger either');
});

test('a big tip does NOT satisfy a promo min-order threshold', async () => {
    const callsBefore = gatewayCalls.length;
    const payRes = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        // Service is 500 < 600 minimum; a ₹200 tip must not bridge that gap.
        body: { ...baseBody(service500.id), time: '14:00', promoCode: 'MIN600PCT5', tipAmount: 200 },
    }), payRes);
    assert.equal(payRes.statusCode, 400);
    assert.equal(payRes.body.message, 'Minimum order amount not met');
    assert.equal(gatewayCalls.length, callsBefore, 'refused bookings never reach the gateway');
});

test('omitted tip → legacy path unchanged (byte-identical charge, null tip columns)', async () => {
    const payRes = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        body: { ...baseBody(service500.id), time: '15:00' }, // no tipAmount
    }), payRes);
    assert.equal(payRes.statusCode, 200);

    const gw = gatewayCalls.find((c) => c.orderId === payRes.body.orderId);
    assert.equal(Number(gw.orderAmount), 500, 'plain price, exactly like before tips existed');

    const order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
    assert.equal(Number(order.orderAmount), 500);
    assert.equal(order.tipAmount, null, 'null = no tip (legacy rows stay valid)');
    assert.equal(order.tipCaptured, 0);
});

// ── Finalize: tipCaptured bookkeeping ─────────────────────────────────────

test('finalize flips tipCaptured to 1 and replays stay idempotent', async () => {
    const payRes = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        body: { ...baseBody(service500.id), time: '16:00', tipAmount: 50 },
    }), payRes);
    const order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
    assert.equal(order.tipCaptured, 0, 'still unclaimed while pending');

    order.paymentStatus = 'Success';
    await order.save();
    const appt = await finalizeAppointmentFromPayment(order);
    assert.ok(appt && appt.id);
    await order.reload();
    assert.equal(order.tipCaptured, 1, 'flag flips once the booking materializes');

    // Replay (redirect handler + webhook firing for the same order): nothing
    // may double-apply — one appointment, one tip, one flag.
    await finalizeAppointmentFromPayment(order);
    const bookings = await Appointment.count({ where: { orderId: order.orderId } });
    assert.equal(bookings, 1, 'replay creates no duplicate booking');
    await order.reload();
    assert.equal(order.tipCaptured, 1, 'flag stays exactly 1');
});

// ── Admin stats: totalTips ────────────────────────────────────────────────

test('admin totalTips sums only captured-success rows and skips everything else', async () => {
    // Capture the earlier tipped order properly (Pending -> Success -> finalize).
    const captured = await Payment.findOne({
        where: { tipAmount: 50, paymentStatus: 'Success' },
    });
    await finalizeAppointmentFromPayment(captured); // flips tipCaptured -> contributes 50

    // Direct ledger fixtures for each exclusion rule.
    const mkRow = (overrides) => Payment.create({
        orderId: `ORDER-TIP-${Math.random().toString(16).slice(2, 10)}`,
        paymentSessionId: 'session_tip_fixture',
        orderAmount: 500, orderCurrency: 'INR',
        paymentStatus: 'Success',
        customerID: customer.id,
        dateSelected: ymd(daysFromNow(3)), timeSelected: '09:00', endTime: '10:00',
        staffId: staffA.id, salonId: salonA.id, serviceId: service500.id, duration: 60,
        ...overrides,
    });
    await mkRow({ tipAmount: 30, tipCaptured: 1 });                    // captured success -> counts
    await mkRow({ tipAmount: 20, tipCaptured: 0 });                    // success but never finalized -> excluded
    await mkRow({ tipAmount: 15, tipCaptured: 1, paymentStatus: 'Failure' }); // failed despite flag -> excluded
    await mkRow({ tipAmount: null, tipCaptured: 1 });                  // tip-less success -> adds 0
    await mkRow({ tipAmount: 10, paymentStatus: 'Slot taken' });       // TOCTOU-refused -> excluded

    const res = mockRes();
    await getPlatformStats({ query: {}, user: { role: 'admin' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.totalTips, 80, 'only Success + tipCaptured=1 tips sum up (50 + 30)');
});
