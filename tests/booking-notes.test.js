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
// booking-config.test.js) so the booking-creation flow can be exercised
// end to end without touching the network.
const cashfree = require('../services/cashfreeServices');
cashfree.createOrder = async () => 'stub-notes-session-id';
const { processPayment } = require('../controllers/paymentController');
const { finalizeAppointmentFromPayment } = require('../services/paymentService');

const {
    rescheduleAppointment,
    getAllAppointmentsByUserId,
    getScheduledAppointmentsBySalonId,
} = require('../controllers/appointmentController');
const { getAllAppointments } = require('../controllers/adminController');
const { validate, paymentCreateSchema, rescheduleSchema } = require('../utils/validators');

// Minimal req/res stubs for invoking the controllers directly.
const mockReq = (overrides = {}) => ({ user: {}, query: {}, params: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
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
// error (null when the middleware passed). Same style as booking-config tests.
const runMw = (schema, body) => {
    let err = null;
    validate(schema)({ body }, {}, (e) => { if (e) err = e; });
    return err;
};

// Future slot helpers (>24h out so reschedule/cancel windows never bite).
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const daysFromNow = (days) => new Date(Date.now() + days * 24 * 3600 * 1000);

let customer, salonA, staffA, serviceA;

before(async () => {
    await sequelize.sync({ force: true });

    customer = await User.create({ name: 'Notey Customer', email: 'note@t.com', password: 'x', phoneNumber: '1' });
    // Open 24/7 so neither the hours gate nor lead time (unset -> 0) blocks
    // the payment/reschedule fixtures.
    salonA = await Salons.create({
        name: 'Notes Salon', email: 'ns@t.com', password: 'x', phoneNumber: '2', address: 'a', pricing: 'Moderate',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '00:00', closingTime: '23:59',
    });
    staffA = await Staff.create({ name: 'Stylist Notes', email: 'stn@t.com', password: 'x', phoneNumber: '3', salonId: salonA.id });
    serviceA = await Services.create({ name: 'Cut & Note', price: 400, duration: 30, salonId: salonA.id });
});

after(async () => { await sequelize.close(); });

test('paymentCreateSchema rejects notes over 500 chars and trims valid ones', () => {
    // 501 characters -> rejected at the middleware layer.
    const tooLong = runMw(paymentCreateSchema, {
        serviceId: 1, salonId: 1, staffId: 1, dateSelect: ymd(daysFromNow(3)),
        time: '10:00', duration: 30, customerNote: 'a'.repeat(501),
    });
    assert.ok(tooLong, 'over-limit note should be rejected');
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.message, /500/);

    // Exactly 500 chars after trimming is allowed; whitespace is stripped.
    const okBody = {
        serviceId: 1, salonId: 1, staffId: 1, dateSelect: ymd(daysFromNow(3)),
        time: '10:00', duration: 30, customerNote: `  ${'b'.repeat(500)}  `,
    };
    const err = runMw(paymentCreateSchema, okBody);
    assert.equal(err, null);
    // Re-parse to inspect the transformed output the middleware would install.
    const parsed = paymentCreateSchema.parse(okBody);
    assert.equal(parsed.customerNote, 'b'.repeat(500));
    assert.equal(parsed.customerNote.length, 500);

    // Omitted note stays absent (optional).
    const bare = paymentCreateSchema.safeParse({
        serviceId: 1, salonId: 1, staffId: 1, dateSelect: ymd(daysFromNow(3)), time: '10:00', duration: 30,
    });
    assert.equal(bare.success, true);
    assert.equal(bare.data.customerNote, undefined);
});

test('rescheduleSchema accepts up to 500 chars, an empty string (clear), and null', () => {
    const tooLong = runMw(rescheduleSchema, {
        dateSelect: ymd(daysFromNow(3)), time: '10:00', customerNote: 'c'.repeat(501),
    });
    assert.ok(tooLong, 'over-limit note should be rejected');
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.message, /500/);

    // Empty string is a legal CLEAR signal; whitespace-only collapses to ''.
    const cleared = rescheduleSchema.parse({
        dateSelect: ymd(daysFromNow(3)), time: '10:00', customerNote: '   ',
    });
    assert.equal(cleared.customerNote, '');

    // Explicit null is accepted (clears too); omitted stays undefined.
    const nulled = rescheduleSchema.safeParse({
        dateSelect: ymd(daysFromNow(3)), time: '10:00', customerNote: null,
    });
    assert.equal(nulled.success, true);
    const bare = rescheduleSchema.safeParse({ dateSelect: ymd(daysFromNow(3)), time: '10:00' });
    assert.equal(bare.data.customerNote, undefined);
});

test('customer note persists through the full booking creation flow (payment -> appointment)', async () => {
    // Step 1: create the order WITH a note. In production the route's
    // paymentCreateSchema has already trimmed the value by the time the
    // controller runs — mirror that here.
    const payReq = mockPayReq({
        user: { userId: customer.id },
        body: {
            serviceId: serviceA.id, salonId: salonA.id, staffId: staffA.id,
            dateSelect: ymd(daysFromNow(3)), time: '10:00', duration: 30,
            customerNote: 'please use hypoallergenic dye',
        },
    });
    const payRes = mockRes();
    await processPayment(payReq, payRes);
    assert.equal(payRes.statusCode, 200);
    assert.ok(payRes.body.orderId, 'order id returned');

    // The note rides on the Payment row until the gateway confirms.
    const order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
    assert.ok(order);
    assert.equal(order.customerNote, 'please use hypoallergenic dye');

    // Step 2: successful payment finalizes into a booking carrying the note.
    order.paymentStatus = 'Success';
    await order.save();
    const appointment = await finalizeAppointmentFromPayment(order);
    assert.ok(appointment && appointment.id);
    assert.equal(appointment.customerNote, 'please use hypoallergenic dye');

    // Idempotent replay (redirect + webhook) returns the SAME appointment —
    // the note is not duplicated or clobbered.
    const replay = await finalizeAppointmentFromPayment(order);
    assert.equal(replay.id, appointment.id);
});

test('booking WITHOUT a note keeps customerNote null through the same flow', async () => {
    const payReq = mockPayReq({
        user: { userId: customer.id },
        body: {
            serviceId: serviceA.id, salonId: salonA.id, staffId: staffA.id,
            dateSelect: ymd(daysFromNow(4)), time: '11:00', duration: 30,
            // no customerNote
        },
    });
    const payRes = mockRes();
    await processPayment(payReq, payRes);
    assert.equal(payRes.statusCode, 200);

    const order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
    assert.equal(order.customerNote, null); // absent -> stored as NULL

    order.paymentStatus = 'Success';
    await order.save();
    const appointment = await finalizeAppointmentFromPayment(order);
    assert.equal(appointment.customerNote, null);
});

test('reschedule updates the note on the booking', async () => {
    const day = ymd(daysFromNow(5));
    const appt = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: day, time: '12:00', endTime: '12:30', status: 'confirmed',
    });

    const req = mockReq({
        params: { appointmentId: String(appt.id) },
        user: { userId: customer.id },
        body: { dateSelect: ymd(daysFromNow(5)), time: '13:00', customerNote: 'running 5 min late' },
    });
    const res = mockRes();
    await rescheduleAppointment(req, res);
    assert.equal(res.statusCode, 200);

    await appt.reload();
    assert.equal(appt.time, '13:00');
    assert.equal(appt.customerNote, 'running 5 min late');
});

test('reschedule with an empty string CLEARS the note to null; omitting it leaves it untouched', async () => {
    const appt = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: ymd(daysFromNow(6)), time: '09:00', endTime: '09:30', status: 'confirmed',
        customerNote: 'gate code 1234',
    });

    // Empty string -> stored as NULL.
    const clearRes = mockRes();
    await rescheduleAppointment(mockReq({
        params: { appointmentId: String(appt.id) },
        user: { userId: customer.id },
        body: { dateSelect: ymd(daysFromNow(6)), time: '10:00', customerNote: '' },
    }), clearRes);
    assert.equal(clearRes.statusCode, 200);
    await appt.reload();
    assert.equal(appt.customerNote, null);

    // Omitted -> the (now cleared) note is left exactly as-is.
    const keepRes = mockRes();
    await rescheduleAppointment(mockReq({
        params: { appointmentId: String(appt.id) },
        user: { userId: customer.id },
        body: { dateSelect: ymd(daysFromNow(7)), time: '10:00' },
    }), keepRes);
    assert.equal(keepRes.statusCode, 200);
    await appt.reload();
    assert.equal(appt.customerNote, null);
});

test('note appears in the customer listing, salon listing, and admin getall; absent note reads null', async () => {
    const notedDay = ymd(daysFromNow(8));
    const plainDay = ymd(daysFromNow(9));
    const noted = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: notedDay, time: '10:00', endTime: '10:30', status: 'confirmed',
        customerNote: 'allergic to ammonia',
    });
    const plain = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: plainDay, time: '10:00', endTime: '10:30', status: 'confirmed',
    });

    // Customer's own listing (legacy bare-array shape, whole-row selects).
    const custRes = mockRes();
    await getAllAppointmentsByUserId(mockReq({ user: { userId: customer.id } }), custRes);
    assert.equal(custRes.statusCode, 200);
    const custRows = custRes.body.filter((a) => [noted.id, plain.id].includes(a.id));
    assert.equal(custRows.length, 2);
    assert.equal(custRows.find((a) => a.id === noted.id).customerNote, 'allergic to ammonia');
    assert.equal(custRows.find((a) => a.id === plain.id).customerNote, null);

    // Salon scheduled-appointments listing.
    const salonRes = mockRes();
    await getScheduledAppointmentsBySalonId(mockReq({ user: { salonId: salonA.id } }), salonRes);
    assert.equal(salonRes.statusCode, 200);
    const salonRows = salonRes.body.filter((a) => [noted.id, plain.id].includes(a.id));
    assert.equal(salonRows.length, 2);
    assert.equal(salonRows.find((a) => a.id === noted.id).customerNote, 'allergic to ammonia');
    assert.equal(salonRows.find((a) => a.id === plain.id).customerNote, null);

    // Admin getall (upcoming appointments only — both fixtures are future).
    const adminRes = mockRes();
    await getAllAppointments(mockReq({ user: { role: 'admin' } }), adminRes);
    assert.equal(adminRes.statusCode, 200);
    const adminRows = adminRes.body.filter((a) => [noted.id, plain.id].includes(a.id));
    assert.equal(adminRows.length, 2);
    assert.equal(adminRows.find((a) => a.id === noted.id).customerNote, 'allergic to ammonia');
    assert.equal(adminRows.find((a) => a.id === plain.id).customerNote, null);
});
