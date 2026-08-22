const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const { canTransition } = require('../utils/statusRules');
const Appointment = require('../models/appointmentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Notification = require('../models/notificationModel');
const { updateAppointmentStatus } = require('../controllers/appointmentController');
const { getMyTodaySchedule } = require('../controllers/staffController');

// Minimal req/res stubs for invoking the controllers directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// The notify() hook is fire-and-forget; poll briefly until the row shows up.
const waitFor = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await fn();
        if (result) return result;
        await new Promise((r) => setTimeout(r, 25));
    }
    return await fn();
};

// Local-time helpers: DATEONLY/TIME columns round-trip as plain strings and
// the controller parses them as LOCAL time, so fixtures use local getters too.
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let customer, otherCustomer, salonA, staffA, staffB, serviceA;
let todayStr;
let apptPast, apptFuture, apptPendingPast, apptCustomerAttempt, apptStaffAttempt;

before(async () => {
    await sequelize.sync({ force: true });
    customer = await User.create({ name: 'Cust', email: 'c@t.com', password: 'x', phoneNumber: '1' });
    otherCustomer = await User.create({ name: 'Other', email: 'o@t.com', password: 'x', phoneNumber: '2' });
    // Open all week so fixtures never land on a closed day regardless of run time.
    salonA = await Salons.create({
        name: 'SalonA', email: 'sa@t.com', password: 'x', phoneNumber: '3', address: 'a', pricing: 'Moderate',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '08:00', closingTime: '20:00',
    });
    // Both staff share ONE salon: only staffId scoping (not salon scoping) can
    // keep staffB's bookings out of staffA's today list.
    staffA = await Staff.create({ name: 'StylistA', email: 'sta@t.com', password: 'x', phoneNumber: '5', salonId: salonA.id });
    staffB = await Staff.create({ name: 'StylistB', email: 'stb@t.com', password: 'x', phoneNumber: '6', salonId: salonA.id });
    serviceA = await Services.create({ name: 'Cut', price: 100, duration: 30, salonId: salonA.id });

    const day = (offsetDays) => new Date(Date.now() + offsetDays * 24 * 3600 * 1000);
    todayStr = ymd(new Date());
    const yesterday = ymd(day(-1)); // whole day already behind us at any run time
    const tomorrow = ymd(day(1));   // whole day still ahead

    const mkAppt = (attrs) => Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id, ...attrs,
    });

    // --- no-show fixtures ---
    apptPast = await mkAppt({ date: yesterday, time: '10:00', endTime: '10:30', status: 'confirmed' });
    apptFuture = await mkAppt({ date: tomorrow, time: '10:00', endTime: '10:30', status: 'confirmed' });
    apptPendingPast = await mkAppt({ date: yesterday, time: '12:00', endTime: '12:30', status: 'pending' });
    apptCustomerAttempt = await mkAppt({ date: yesterday, time: '13:00', endTime: '13:30', status: 'confirmed' });
    apptStaffAttempt = await mkAppt({ date: yesterday, time: '14:00', endTime: '14:30', status: 'confirmed' });

    // --- today-schedule fixtures ---
    // Two same-day rows created out of chronological order prove ORDER BY time,
    // yesterday/tomorrow rows prove date scoping, staffB's row proves staff scoping.
    await mkAppt({ date: todayStr, time: '09:00', endTime: '09:30', status: 'confirmed' });
    await mkAppt({ date: todayStr, time: '13:00', endTime: '13:30', status: 'confirmed' });
    await mkAppt({ date: todayStr, time: '11:00', endTime: '11:30', status: 'confirmed' }); // inserted last
    await mkAppt({ date: yesterday, time: '15:00', endTime: '15:30', status: 'completed' });
    await mkAppt({ date: tomorrow, time: '09:00', endTime: '09:30', status: 'confirmed' });
    await mkAppt({ staffId: staffB.id, date: todayStr, time: '10:00', endTime: '10:30', status: 'confirmed' });
});

after(async () => { await sequelize.close(); });

// ---------- transition-map units (pure, no DB) ----------

test('canTransition: confirmed -> no-show allowed, pending -> no-show rejected', () => {
    assert.equal(canTransition('confirmed', 'no-show'), true);
    assert.equal(canTransition('pending', 'no-show'), false);
});

test('canTransition: no-show is terminal (nothing may follow it)', () => {
    assert.equal(canTransition('no-show', 'completed'), false);
    assert.equal(canTransition('no-show', 'cancelled'), false);
    assert.equal(canTransition('no-show', 'confirmed'), false);
    assert.equal(canTransition('no-show', 'declined'), false);
    assert.equal(canTransition('no-show', 'no-show'), false);
});

// ---------- no-show via updateAppointmentStatus ----------

test('salon can mark a PAST confirmed appointment no-show and the customer is notified', async () => {
    const req = {
        params: { appointmentId: String(apptPast.id) },
        user: { role: 'salon', salonId: salonA.id },
        body: { status: 'no-show' },
    };
    const res = mockRes();
    await updateAppointmentStatus(req, res);
    assert.equal(res.statusCode, 200);

    await apptPast.reload();
    assert.equal(apptPast.status, 'no-show');

    const notice = await waitFor(() => Notification.findOne({
        where: { recipientRole: 'customer', recipientId: customer.id, type: 'booking.no-show', appointmentId: apptPast.id },
    }));
    assert.ok(notice, 'customer notification was created');
});

test('salon cannot mark a FUTURE appointment no-show (400)', async () => {
    const req = {
        params: { appointmentId: String(apptFuture.id) },
        user: { role: 'salon', salonId: salonA.id },
        body: { status: 'no-show' },
    };
    const res = mockRes();
    await updateAppointmentStatus(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Cannot mark a future appointment as no-show');

    await apptFuture.reload();
    assert.equal(apptFuture.status, 'confirmed'); // untouched
});

test('pending -> no-show is rejected even when in the past (400)', async () => {
    const req = {
        params: { appointmentId: String(apptPendingPast.id) },
        user: { role: 'salon', salonId: salonA.id },
        body: { status: 'no-show' },
    };
    const res = mockRes();
    await updateAppointmentStatus(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /pending/);

    await apptPendingPast.reload();
    assert.equal(apptPendingPast.status, 'pending');
});

test('customer role cannot set no-show (403)', async () => {
    const req = {
        params: { appointmentId: String(apptCustomerAttempt.id) },
        user: { role: 'customer', userId: otherCustomer.id },
        body: { status: 'no-show' },
    };
    const res = mockRes();
    await updateAppointmentStatus(req, res);
    assert.equal(res.statusCode, 403);

    await apptCustomerAttempt.reload();
    assert.equal(apptCustomerAttempt.status, 'confirmed');
});

test('staff role cannot set no-show, even on their own appointment (403)', async () => {
    const req = {
        params: { appointmentId: String(apptStaffAttempt.id) },
        user: { role: 'staff', staffId: staffA.id },
        body: { status: 'no-show' },
    };
    const res = mockRes();
    await updateAppointmentStatus(req, res);
    assert.equal(res.statusCode, 403);

    await apptStaffAttempt.reload();
    assert.equal(apptStaffAttempt.status, 'confirmed');
});

// ---------- staff today schedule ----------

test('GET my today schedule: bare array, own-today-only, ordered by time ASC', async () => {
    const req = { user: { role: 'staff', staffId: staffA.id } };
    const res = mockRes();
    await getMyTodaySchedule(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body), 'legacy bare-array response shape');

    assert.equal(res.body.length, 3); // today's staffA rows only
    const times = res.body.map((a) => String(a.time).slice(0, 5));
    assert.deepEqual(times, ['09:00', '11:00', '13:00']); // sorted, not creation order
    for (const row of res.body) {
        assert.equal(row.staffId, staffA.id);
        assert.equal(row.date, todayStr);
        assert.equal(row.service.name, 'Cut');
        assert.equal(row.user.name, 'Cust');
    }
});
