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

// Stub the Cashfree gateway BEFORE paymentController is required — the
// controller destructures createOrder at module load (same trick as
// booking-config.test.js / booking-notes.test.js) so the booking-creation
// flow can be exercised end to end without touching the network.
const cashfree = require('../services/cashfreeServices');
cashfree.createOrder = async () => 'stub-party-session-id';
const { processPayment } = require('../controllers/paymentController');
const { finalizeAppointmentFromPayment } = require('../services/paymentService');

const {
    rescheduleAppointment,
    getAllAppointmentsByUserId,
    getScheduledAppointmentsBySalonId,
    exportAppointmentsCsv,
} = require('../controllers/appointmentController');
const { getAllAppointments } = require('../controllers/adminController');
const { validate, paymentCreateSchema, rescheduleSchema } = require('../utils/validators');

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
// error (null when the middleware passed). Same style as booking-notes tests.
const runMw = (schema, body) => {
    let err = null;
    validate(schema)({ body }, {}, (e) => { if (e) err = e; });
    return err;
};

// Future slot helpers (>24h out so reschedule/cancel windows never bite).
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysFromNow = (days) => new Date(Date.now() + days * 24 * 3600 * 1000);

let customer, salonA, staffA, serviceA;

before(async () => {
    await sequelize.sync({ force: true });

    customer = await User.create({ name: 'Party Host', email: 'party@t.com', password: 'x', phoneNumber: '1' });
    // Open 24/7 so neither the hours gate nor lead time (unset -> 0) blocks
    // the payment/reschedule fixtures.
    salonA = await Salons.create({
        name: 'Groups Salon', email: 'gs@t.com', password: 'x', phoneNumber: '2', address: 'a', pricing: 'Premium',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '00:00', closingTime: '23:59',
    });
    staffA = await Staff.create({ name: 'Stylist Groups', email: 'stg@t.com', password: 'x', phoneNumber: '3', salonId: salonA.id });
    serviceA = await Services.create({ name: 'Bridal Package', price: 500, duration: 60, salonId: salonA.id });
});

after(async () => { await sequelize.close(); });

// ── Schema layer (middleware invoked directly) ───────────────────────────

test('paymentCreateSchema rejects 0, negative, over-20, and garbage party sizes with 400', () => {
    const base = {
        serviceId: 1, salonId: 1, staffId: 1,
        dateSelect: ymd(daysFromNow(3)), time: '10:00', duration: 30,
    };
    for (const bad of [0, -1, -4, 21, 100, 'abc', '', 2.5]) {
        const err = runMw(paymentCreateSchema, { ...base, partySize: bad });
        assert.ok(err, `partySize=${JSON.stringify(bad)} should be rejected`);
        assert.equal(err.status, 400, `partySize=${JSON.stringify(bad)} maps to 400`);
    }
});

test('paymentCreateSchema accepts the 1..20 boundaries and coerces numeric strings', () => {
    const parsedLow = paymentCreateSchema.safeParse({
        serviceId: 1, salonId: 1, staffId: 1,
        dateSelect: ymd(daysFromNow(3)), time: '10:00', duration: 30, partySize: 1,
    });
    assert.ok(parsedLow.success);
    assert.equal(parsedLow.data.partySize, 1);

    const parsedHigh = paymentCreateSchema.parse({
        serviceId: 1, salonId: 1, staffId: 1,
        dateSelect: ymd(daysFromNow(3)), time: '10:00', duration: 30, partySize: 20,
    });
    assert.equal(parsedHigh.partySize, 20, 'boundary 20 is accepted');

    // The SPA may send the size as a string — coercion makes it a number.
    const coerced = paymentCreateSchema.parse({
        serviceId: 1, salonId: 1, staffId: 1,
        dateSelect: ymd(daysFromNow(3)), time: '10:00', duration: 30, partySize: '4',
    });
    assert.strictEqual(coerced.partySize, 4);
});

test('paymentCreateSchema defaults an omitted partySize to 1', () => {
    const parsed = paymentCreateSchema.parse({
        serviceId: 1, salonId: 1, staffId: 1,
        dateSelect: ymd(daysFromNow(3)), time: '10:00', duration: 30,
    });
    assert.equal(parsed.partySize, 1, 'middleware installs the default');
});

test('rescheduleSchema bounds partySize identically; omitted stays undefined', () => {
    const base = { dateSelect: ymd(daysFromNow(3)), time: '10:00' };
    for (const bad of [0, -2, 21, 'nope']) {
        const err = runMw(rescheduleSchema, { ...base, partySize: bad });
        assert.ok(err, `reschedule partySize=${JSON.stringify(bad)} should be rejected`);
        assert.equal(err.status, 400);
    }
    assert.equal(runMw(rescheduleSchema, { ...base, partySize: 20 }), null, '20 accepted');
    assert.equal(runMw(rescheduleSchema, { ...base, partySize: '5' }), null, 'numeric string coerced');

    const bare = rescheduleSchema.safeParse(base);
    assert.ok(bare.success);
    assert.equal(bare.data.partySize, undefined, 'omitting means "leave headcount alone"');
});

// ── Booking creation flow (payment -> appointment) ───────────────────────

test('booking created WITHOUT partySize ends up with partySize 1 end-to-end', async () => {
    const payReq = mockPayReq({
        user: { userId: customer.id },
        body: {
            serviceId: serviceA.id, salonId: salonA.id, staffId: staffA.id,
            dateSelect: ymd(daysFromNow(3)), time: '10:00', duration: 30,
            // no partySize
        },
    });
    const payRes = mockRes();
    await processPayment(payReq, payRes);
    assert.equal(payRes.statusCode, 200);
    assert.ok(payRes.body.orderId, 'order id returned');

    // The default already rides on the Payment carrier row...
    const order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
    assert.ok(order);
    assert.equal(order.partySize, 1, 'omitted -> Payment stores the default 1');

    // ...and lands on the materialized booking.
    order.paymentStatus = 'Success';
    await order.save();
    const appointment = await finalizeAppointmentFromPayment(order);
    assert.ok(appointment && appointment.id);
    assert.equal(appointment.partySize, 1, 'solo bookings default to 1 through the whole chain');
});

test('explicit party sizes persist through payment -> Payment -> Appointment', async () => {
    for (const [size, hour] of [[2, '11:00'], [20, '12:00']]) {
        const payReq = mockPayReq({
            user: { userId: customer.id },
            body: {
                serviceId: serviceA.id, salonId: salonA.id, staffId: staffA.id,
                dateSelect: ymd(daysFromNow(4)), time: hour, duration: 30,
                partySize: size,
            },
        });
        const payRes = mockRes();
        await processPayment(payReq, payRes);
        assert.equal(payRes.statusCode, 200, `size ${size} books successfully`);

        const order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
        assert.equal(order.partySize, size, `size ${size} carried on the Payment row`);

        order.paymentStatus = 'Success';
        await order.save();
        const appointment = await finalizeAppointmentFromPayment(order);
        assert.equal(appointment.partySize, size, `size ${size} persisted onto the Appointment`);
    }
});

// ── Reschedule ───────────────────────────────────────────────────────────

test('reschedule updates partySize; omitting it leaves the current headcount untouched', async () => {
    const appt = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: ymd(daysFromNow(6)), time: '12:00', endTime: '12:30', status: 'confirmed',
        partySize: 8,
    });

    // Move + shrink the party in one call.
    const moveRes = mockRes();
    await rescheduleAppointment(mockReq({
        params: { appointmentId: String(appt.id) },
        user: { userId: customer.id },
        body: { dateSelect: ymd(daysFromNow(7)), time: '13:00', partySize: 3 },
    }), moveRes);
    assert.equal(moveRes.statusCode, 200);
    await appt.reload();
    assert.equal(appt.partySize, 3, 'headcount adjusted with the move');

    // Reschedule again WITHOUT partySize -> stays 3 (no silent reset).
    const keepRes = mockRes();
    await rescheduleAppointment(mockReq({
        params: { appointmentId: String(appt.id) },
        user: { userId: customer.id },
        body: { dateSelect: ymd(daysFromNow(8)), time: '14:00' },
    }), keepRes);
    assert.equal(keepRes.statusCode, 200);
    await appt.reload();
    assert.equal(appt.date, ymd(daysFromNow(8)));
    assert.equal(appt.partySize, 3, 'omitted partySize leaves the booking unchanged');
});

// ── Visibility: listings + CSV export ────────────────────────────────────

test('partySize flows in the customer, salon, and admin listings', async () => {
    const bigDay = ymd(daysFromNow(9));
    const group = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: bigDay, time: '10:00', endTime: '10:30', status: 'confirmed',
        partySize: 12,
    });

    // Customer's own listing (legacy bare-array shape, whole-row selects).
    const custRes = mockRes();
    await getAllAppointmentsByUserId(mockReq({ user: { userId: customer.id } }), custRes);
    assert.equal(custRes.statusCode, 200);
    assert.equal(custRes.body.find((a) => a.id === group.id).partySize, 12);

    // Salon scheduled-appointments listing.
    const salonRes = mockRes();
    await getScheduledAppointmentsBySalonId(mockReq({ user: { salonId: salonA.id } }), salonRes);
    assert.equal(salonRes.statusCode, 200);
    assert.equal(salonRes.body.find((a) => a.id === group.id).partySize, 12);

    // Admin getall (upcoming appointments only — the fixture is future).
    const adminRes = mockRes();
    await getAllAppointments(mockReq({ user: { role: 'admin' } }), adminRes);
    assert.equal(adminRes.statusCode, 200);
    assert.equal(adminRes.body.find((a) => a.id === group.id).partySize, 12);
});

test('CSV export includes a PartySize column after Status with correct values', async () => {
    const soloDay = ymd(daysFromNow(10));
    const groupDay = ymd(daysFromNow(11));
    const solo = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: soloDay, time: '09:00', endTime: '09:30', status: 'confirmed',
        // no partySize -> model default 1
    });
    const group = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: groupDay, time: '15:00', endTime: '15:30', status: 'confirmed',
        partySize: 12,
    });

    const res = mockRes();
    await exportAppointmentsCsv(mockReq({ user: { salonId: salonA.id }, query: {} }), res);
    assert.equal(res.statusCode, 200);

    const lines = res.body.split('\r\n').filter((l) => l !== '');
    const header = lines[0].split(',');
    assert.equal(header.indexOf('PartySize'), header.indexOf('Status') + 1, 'PartySize sits right after Status');

    const rowFor = (appt) => lines.slice(1).find((l) => l.startsWith(`${appt.id},`)).split(',');
    assert.equal(rowFor(solo)[header.indexOf('PartySize')], '1', 'solo booking exports as 1');
    assert.equal(rowFor(group)[header.indexOf('PartySize')], '12', 'group booking exports its real size');
});
