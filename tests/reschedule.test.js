const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Appointment = require('../models/appointmentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const StaffServices = require('../models/StaffServices');
const Notification = require('../models/notificationModel');
const { rescheduleAppointment } = require('../controllers/appointmentController');

// Minimal req/res stubs for invoking the controller directly.
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

// Local-time helpers: the controller rebuilds startAt from date+time strings
// parsed as local time, so fixtures are generated with local getters too.
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

let customer, otherCustomer, salonA, staffA, staffB, serviceA;
let dayX, dayY;
let apptHappy, apptSoon, apptCompleted, apptConflict, apptStaffSwap;

before(async () => {
    await sequelize.sync({ force: true });
    customer = await User.create({ name: 'Cust', email: 'c@t.com', password: 'x', phoneNumber: '1' });
    otherCustomer = await User.create({ name: 'Other', email: 'o@t.com', password: 'x', phoneNumber: '2' });
    // Open all week so fixtures never land on a closed day regardless of run time.
    salonA = await Salons.create({
        name: 'SalonA', email: 'sa@t.com', password: 'x', phoneNumber: '3', address: 'a', pricing: 'Moderate',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '08:00', closingTime: '20:00',
    });
    staffA = await Staff.create({ name: 'StylistA', email: 'sta@t.com', password: 'x', phoneNumber: '5', salonId: salonA.id });
    const salonB = await Salons.create({ name: 'SalonB', email: 'sb@t.com', password: 'x', phoneNumber: '4', address: 'b', pricing: 'Premium' });
    staffB = await Staff.create({ name: 'StylistB', email: 'stb@t.com', password: 'x', phoneNumber: '6', salonId: salonB.id });
    serviceA = await Services.create({ name: 'Cut', price: 100, duration: 30, salonId: salonA.id });
    await StaffServices.create({ staffId: staffA.id, serviceId: serviceA.id });

    dayX = new Date(Date.now() + 3 * 24 * 3600 * 1000); // safely >24h out
    dayY = new Date(Date.now() + 4 * 24 * 3600 * 1000);
    const soonAt = new Date(Date.now() + 18 * 3600 * 1000);   // strictly within 24h

    apptHappy = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: ymd(dayX), time: '10:00', endTime: '10:30', status: 'confirmed',
    });
    apptSoon = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: ymd(soonAt), time: hm(soonAt), endTime: hm(new Date(soonAt.getTime() + 30 * 60000)), status: 'confirmed',
    });
    apptCompleted = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: ymd(dayX), time: '11:00', endTime: '11:30', status: 'completed',
    });
    // Overlapping booking (other customer, same staff/salon/day) at 14:15–14:45
    // so moving apptConflict to 14:00 collides with it.
    apptConflict = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: ymd(dayX), time: '09:00', endTime: '09:30', status: 'confirmed',
    });
    await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: otherCustomer.id,
        date: ymd(dayX), time: '14:15', endTime: '14:45', status: 'confirmed',
    });
    apptStaffSwap = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: ymd(dayX), time: '12:00', endTime: '12:30', status: 'pending',
    });
});

after(async () => { await sequelize.close(); });

test('owner can reschedule to a new slot and the salon is notified', async () => {
    const newDate = ymd(dayY);
    const req = {
        params: { appointmentId: String(apptHappy.id) },
        user: { userId: customer.id },
        body: { dateSelect: newDate, time: '15:00' },
    };
    const res = mockRes();
    await rescheduleAppointment(req, res);
    assert.equal(res.statusCode, 200);

    await apptHappy.reload();
    assert.equal(apptHappy.date, newDate);
    assert.equal(apptHappy.time, '15:00');
    assert.equal(apptHappy.endTime, '15:30'); // recomputed from duration 30
    assert.equal(apptHappy.staffId, staffA.id); // same staff by default

    const notice = await waitFor(() => Notification.findOne({
        where: { recipientRole: 'salon', recipientId: salonA.id, type: 'booking.rescheduled', appointmentId: apptHappy.id },
    }));
    assert.ok(notice, 'salon notification was created');
    assert.match(notice.body, /10:00/);
    assert.match(notice.body, /15:00/);
});

test('cannot reschedule an appointment within 24h (400)', async () => {
    const req = {
        params: { appointmentId: String(apptSoon.id) },
        user: { userId: customer.id },
        body: { dateSelect: ymd(dayY), time: '16:00' },
    };
    const res = mockRes();
    await rescheduleAppointment(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /reschedul/i);
});

test('cannot reschedule a completed appointment (400)', async () => {
    const req = {
        params: { appointmentId: String(apptCompleted.id) },
        user: { userId: customer.id },
        body: { dateSelect: ymd(dayY), time: '16:00' },
    };
    const res = mockRes();
    await rescheduleAppointment(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /completed/);
});

test('non-owner cannot reschedule (403)', async () => {
    const req = {
        params: { appointmentId: String(apptSoon.id) },
        user: { userId: otherCustomer.id },
        body: { dateSelect: ymd(dayY), time: '16:00' },
    };
    const res = mockRes();
    await rescheduleAppointment(req, res);
    assert.equal(res.statusCode, 403);
});

test('404 for unknown appointment', async () => {
    const req = {
        params: { appointmentId: '999999' },
        user: { userId: customer.id },
        body: { dateSelect: ymd(dayY), time: '16:00' },
    };
    const res = mockRes();
    await rescheduleAppointment(req, res);
    assert.equal(res.statusCode, 404);
});

test('conflicting new slot rejected with 409 and nothing persisted', async () => {
    const dayX = apptConflict.date;
    const req = {
        params: { appointmentId: String(apptConflict.id) },
        user: { userId: customer.id },
        // 14:00–14:30 overlaps the other customer's 14:15–14:45 booking.
        body: { dateSelect: dayX, time: '14:00' },
    };
    const res = mockRes();
    await rescheduleAppointment(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.message, 'New slot is not available');
    await apptConflict.reload();
    assert.equal(apptConflict.time, '09:00'); // untouched on conflict
});

test('staffId from another salon is rejected (400)', async () => {
    const req = {
        params: { appointmentId: String(apptStaffSwap.id) },
        user: { userId: customer.id },
        body: { dateSelect: ymd(dayY), time: '17:00', staffId: staffB.id },
    };
    const res = mockRes();
    await rescheduleAppointment(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /staff/i);
});
