// Regression tests for the payment-path authority fixes: staff eligibility,
// authoritative duration, archived-service refusal, the promo redemption cap,
// and the SLOT_TAKEN twin re-check. Conventions copied from tips.test.js.
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
// tips.test.js). The stub records every call so refused bookings can be
// proven to never reach the gateway.
const cashfree = require('../services/cashfreeServices');
const gatewayCalls = [];
cashfree.createOrder = async (orderId, orderAmount) => {
    gatewayCalls.push({ orderId, orderAmount });
    return 'stub-authority-session-id';
};

// Stub the booking guard BEFORE paymentService is required. WHY the order is
// load-bearing: paymentService.js line ~15 reads
//     const { createBookingSafely } = require('./bookingGuard');
// — the function is DESTRUCTURED at module load into a local binding, so
// mutating bookingGuard.createBookingSafely after paymentService has loaded
// would never reach that captured copy (verified in source; same
// module-object mutation trick tips.test.js uses for Cashfree).
// paymentController requires paymentService at ITS load too, so both modules
// must be pulled in only after the stub is in place.
//
// The stub is a pass-through to the REAL guard by default — the promo-cap
// test below needs genuine bookings — and only intervenes for the single
// orderId armed for the SLOT_TAKEN race test. For that orderId it simulates
// the race loser: the winning twin inserts the appointment right here,
// between finalize's idempotent early-return check and the guard's create,
// and then the loser's own create reports SLOT_TAKEN. (Pre-creating the
// appointment before calling finalize would only exercise the early-return
// path — the twin re-check would never run.)
const bookingGuard = require('../services/bookingGuard');
const realCreateBookingSafely = bookingGuard.createBookingSafely;
let twinRaceOrderId = null; // armed per-test
let twinGuardFired = false; // proves the guard (not the early-return) ran
bookingGuard.createBookingSafely = async (values, slotArgs) => {
    if (twinRaceOrderId !== null && values.orderId === twinRaceOrderId) {
        twinGuardFired = true;
        await Appointment.create(values); // the "other handler" wins the race
        return { ok: false, code: 'SLOT_TAKEN', reason: 'slot no longer available' };
    }
    return realCreateBookingSafely(values, slotArgs);
};

// ONLY NOW the modules that captured the stubs at their load time:
const { processPayment } = require('../controllers/paymentController');
const { finalizeAppointmentFromPayment, getAuthoritativePrice } = require('../services/paymentService');

// Minimal req/res stubs for invoking the controller directly (tips.test.js).
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

// Future slot helpers (>24h out so lead-time gates never bite).
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysFromNow = (days) => new Date(Date.now() + days * 24 * 3600 * 1000);

let customer, salonA, salonB, staffA, staffB, staffC, service60, archivedService;
// Filled from the fixtures at call time (before() has run by then).
const baseBody = (serviceId) => ({
    serviceId,
    salonId: salonA && salonA.id,
    staffId: staffA && staffA.id,
    dateSelect: ymd(daysFromNow(3)), time: '10:00', duration: 30,
});

before(async () => {
    await sequelize.sync({ force: true });

    customer = await User.create({ name: 'Auditor', email: 'audit@t.com', password: 'x', phoneNumber: '1' });
    // Open 24/7 so neither the hours gate nor lead time (unset -> 0) blocks
    // the payment fixtures.
    const mkSalon = (name, email, phone, pricing) => Salons.create({
        name, email, password: 'x', phoneNumber: phone, address: 'a', pricing,
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '00:00', closingTime: '23:59',
    });
    salonA = await mkSalon('Authority Salon', 'as@t.com', '2', 'Premium');
    salonB = await mkSalon('Rival Salon', 'rv@t.com', '9', 'Standard');

    staffA = await Staff.create({ name: 'Linked Stylist', email: 'ls@t.com', password: 'x', phoneNumber: '3', salonId: salonA.id });
    staffB = await Staff.create({ name: 'Rival Stylist', email: 'rs@t.com', password: 'x', phoneNumber: '4', salonId: salonB.id });
    staffC = await Staff.create({ name: 'Unlinked Stylist', email: 'us@t.com', password: 'x', phoneNumber: '5', salonId: salonA.id });

    service60 = await Services.create({ name: 'Authority Cut', price: 500, duration: 60, salonId: salonA.id });
    archivedService = await Services.create({ name: 'Ghost Perm', price: 700, duration: 90, salonId: salonA.id, statusbar: 'archived' });

    // Happy case: the salon's own stylist IS linked to the service
    // (required since /pay started enforcing staff-service eligibility).
    await staffA.setServices([service60]);
    // Cross-salon link ON PURPOSE: staffB can perform the service but works
    // at salonB — only the salonId filter in staffForService can reject them.
    await staffB.setServices([service60]);
    // staffC deliberately gets NO setServices call: right salon, wrong skills.

    // usageLimit 1 with usedCount 0 — the redemption-cap race fixture.
    await PromoCode.create({ code: 'CAPONE', discountType: 'flat', discountValue: 50, usageLimit: 1 });
});

after(async () => { await sequelize.close(); });

// ── 1. Staff eligibility ──────────────────────────────────────────────────

test('staff eligibility: a stylist from a DIFFERENT salon is refused with 400', async () => {
    const gwBefore = gatewayCalls.length;
    const res = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        // staffB is linked to service60 (join row above) but belongs to
        // salonB — the salonId filter must reject them anyway.
        body: { ...baseBody(service60.id), staffId: staffB.id },
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Selected staff is not available for this service');
    assert.equal(gatewayCalls.length, gwBefore, 'refused booking never reaches the gateway');
});

test('staff eligibility: right salon but NOT linked to the service -> same 400', async () => {
    const res = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        body: { ...baseBody(service60.id), staffId: staffC.id }, // staffC at salonA, never setServices
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Selected staff is not available for this service');
});

// ── 2. Authoritative duration ─────────────────────────────────────────────

test('authoritative duration: a client-sent duration of 1 cannot shrink a 60-minute booking', async () => {
    const res = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        // This is also the staff-eligibility HAPPY path: staffA is linked to
        // service60, so the request goes all the way through.
        body: { ...baseBody(service60.id), time: '10:00', duration: 1 },
    }), res);
    assert.equal(res.statusCode, 200);

    const order = await Payment.findOne({ where: { orderId: res.body.orderId } });
    assert.ok(order, 'Payment row created');
    assert.equal(order.duration, 60, 'the SERVICE row decides the duration, not the payload');
    assert.ok(
        String(order.endTime).startsWith('11:00'),
        `endTime covers the full 60 minutes from 10:00 (got ${order.endTime})`
    );

    // The client lie never reaches the money either: still the full price.
    const gw = gatewayCalls.find((c) => c.orderId === res.body.orderId);
    assert.equal(Number(gw.orderAmount), 500);
});

// ── 3. Archived service ───────────────────────────────────────────────────

test('archived service: /pay refuses with 409 and no Payment row is created', async () => {
    const payBefore = await Payment.count();
    const gwBefore = gatewayCalls.length;
    const res = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        // The archived gate fires BEFORE the staff check (staffA is not even
        // linked to archivedService), so a 409 — not a staff 400 — proves it.
        body: { ...baseBody(archivedService.id) },
    }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.message, 'This service is no longer available');
    assert.equal(await Payment.count(), payBefore, 'no Payment row created');
    assert.equal(gatewayCalls.length, gwBefore, 'no gateway order created');
});

// ── 4. Promo redemption cap ───────────────────────────────────────────────

test('promo redemption cap: two checkouts racing the check-then-act window leave usedCount at exactly 1', async () => {
    const date = ymd(daysFromNow(4));
    const orders = [];
    // Both orders resolve the promo at CREATION time while usedCount is
    // still 0 — the check-then-act window the cap fix has to survive.
    for (const time of ['10:00', '11:00']) {
        const res = mockRes();
        await processPayment(mockPayReq({
            user: { userId: customer.id },
            body: { ...baseBody(service60.id), dateSelect: date, time, promoCode: 'CAPONE' },
        }), res);
        assert.equal(res.statusCode, 200, `order at ${time} created inside the race window`);
        const row = await Payment.findOne({ where: { orderId: res.body.orderId } });
        assert.equal(Number(row.discountAmount), 50, 'the discount was locked in at order creation');
        assert.equal(row.promoCodeApplied, 'CAPONE');
        orders.push(row);
    }

    // Both payments captured at the gateway -> both finalize. Distinct slots
    // (same date, different times), so both bookings materialize.
    for (const row of orders) {
        row.paymentStatus = 'Success';
        await row.save();
        const appt = await finalizeAppointmentFromPayment(row);
        assert.ok(appt && appt.id, 'a captured payment still finalizes into a booking');
    }
    assert.equal(
        await Appointment.count({ where: { orderId: orders.map((o) => o.orderId) } }),
        2,
        'both racing bookings exist'
    );

    // The conditional increment (usedCount < usageLimit) refuses the second
    // redemption, even though the money for both already moved.
    const promo = await PromoCode.findOne({ where: { code: 'CAPONE' } });
    assert.equal(promo.usedCount, 1, 'usedCount is EXACTLY 1, never past the cap');
});

// ── 5. SLOT_TAKEN twin re-check ───────────────────────────────────────────

test('SLOT_TAKEN twin re-check: finalize returns the twin appointment and never flips the payment', async () => {
    const orderId = 'ORDER-TWIN-' + Math.random().toString(16).slice(2, 10);
    twinRaceOrderId = orderId; // arm the guard stub for THIS order only
    twinGuardFired = false;
    const pay = await Payment.create({
        orderId,
        paymentSessionId: 'session_twin_fixture',
        orderAmount: 500, orderCurrency: 'INR',
        paymentStatus: 'Success',
        customerID: customer.id,
        dateSelected: ymd(daysFromNow(5)), timeSelected: '14:00', endTime: '15:00',
        staffId: staffA.id, salonId: salonA.id, serviceId: service60.id, duration: 60,
    });

    // No appointment exists yet when finalize starts; the stub's create inside
    // the guard plants the twin, then reports SLOT_TAKEN. Without the twin
    // re-check this call would THROW (code SLOT_TAKEN) and mark the payment
    // 'Slot taken' — a fulfilled order mislabeled as a refused one.
    const appt = await finalizeAppointmentFromPayment(pay);
    assert.ok(twinGuardFired, 'the forced SLOT_TAKEN failure fired — the twin path ran, not the early-return');
    const twin = await Appointment.findOne({ where: { orderId } });
    assert.ok(twin, 'the appointment materialized during the race');
    assert.equal(appt && appt.id, twin.id, 'finalize RETURNS the existing appointment');
    assert.equal(await Appointment.count({ where: { orderId } }), 1, 'exactly one booking');

    await pay.reload();
    assert.equal(pay.paymentStatus, 'Success', 'payment is NOT mislabeled "Slot taken"');

    // Replay (redirect + webhook for the same order): the idempotent
    // early-return now serves the same appointment, still no relabeling.
    const again = await finalizeAppointmentFromPayment(pay);
    assert.equal(again.id, twin.id, 'replay returns the same booking');
    await pay.reload();
    assert.equal(pay.paymentStatus, 'Success');
    assert.equal(await Appointment.count({ where: { orderId } }), 1, 'replay creates no duplicate');
});

// ── 6. getAuthoritativePrice contract ─────────────────────────────────────

test('getAuthoritativePrice contract: null / mismatch / archived / happy', async () => {
    assert.equal(await getAuthoritativePrice(999999, salonA.id), null, 'nonexistent service -> null');

    const mismatch = await getAuthoritativePrice(service60.id, salonB.id);
    assert.deepStrictEqual(mismatch, { mismatch: true }, 'wrong salon -> { mismatch: true }');

    const archived = await getAuthoritativePrice(archivedService.id, salonA.id);
    assert.deepStrictEqual(archived, { archived: true }, 'archived -> { archived: true }');

    const happy = await getAuthoritativePrice(service60.id, salonA.id);
    assert.equal(Number(happy.price), 500, 'happy path carries the service price');
    assert.equal(happy.duration, 60, 'happy path carries the service duration');
    assert.ok(!('mismatch' in happy) && !('archived' in happy), 'no refusal keys on the happy path');
});
