const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Appointment = require('../models/appointmentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Notification = require('../models/notificationModel');
const { updateAppointmentStatus, cancelAppointment } = require('../controllers/appointmentController');
const { sendBookingStatusEmail, bookingStatusSubject } = require('../services/emailService');

// Local-time helpers: DATEONLY/TIME columns round-trip as plain strings.
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (offsetDays) => new Date(Date.now() + offsetDays * 24 * 3600 * 1000);

let customer, salonA, staffA, serviceA, apptPending, apptCancellable;

// Force the mailer unconfigured for this run so every send resolves to the
// documented no-op instead of attempting a real Brevo call (.env ships real
// keys, so deleting makes the no-op explicit). Fixtures share this hook.
before(async () => {
    await sequelize.sync({ force: true });
    delete process.env.BREVO_API_KEY;
    delete process.env.SENDER_EMAIL;

    customer = await User.create({ name: 'Cust', email: 'c@t.com', password: 'x', phoneNumber: '1' });
    salonA = await Salons.create({
        name: 'SalonA', email: 'sa@t.com', password: 'x', phoneNumber: '3', address: 'a', pricing: 'Moderate',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '08:00', closingTime: '20:00',
    });
    staffA = await Staff.create({ name: 'StylistA', email: 'sta@t.com', password: 'x', phoneNumber: '5', salonId: salonA.id });
    serviceA = await Services.create({ name: 'Cut', price: 100, duration: 30, salonId: salonA.id });

    apptPending = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: ymd(day(3)), time: '10:00', endTime: '10:30', status: 'pending',
    });
    // Strictly >24h away so the customer-cancellation window passes.
    apptCancellable = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customer.id,
        date: ymd(day(4)), time: '11:00', endTime: '11:30', status: 'confirmed',
    });
});

after(async () => { await sequelize.close(); });

// Minimal req/res stubs for invoking the controllers directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// The notify()/email hooks are fire-and-forget; poll briefly until the row shows up.
const waitFor = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await fn();
        if (result) return result;
        await new Promise((r) => setTimeout(r, 25));
    }
    return await fn();
};

// ---------- service units (unconfigured no-op contract) ----------

test('sendBookingStatusEmail returns {sent:false} unconfigured for every mapped status, never throws', async () => {
    for (const status of ['confirmed', 'declined', 'completed', 'no-show', 'cancelled']) {
        const result = await sendBookingStatusEmail('c@t.com', {
            status,
            salonName: 'SalonX',
            serviceName: 'Cut',
            date: '2030-01-01',
            time: '10:00',
        });
        assert.deepEqual(result, { sent: false, reason: 'not-configured' }, `status=${status}`);
    }
});

test('bookingStatusSubject lines are non-empty, distinct per status, and mention the salon', () => {
    const statuses = ['confirmed', 'declined', 'completed', 'no-show', 'cancelled'];
    const subjects = statuses.map((s) => bookingStatusSubject(s, 'SalonA'));
    for (const subject of subjects) {
        assert.ok(typeof subject === 'string' && subject.length > 0);
        assert.match(subject, /SalonA/); // "Your booking at SalonA ..."
    }
    assert.equal(new Set(subjects).size, subjects.length, 'subjects differ per status');

    // Unknown status -> null copy (service maps it to missing-data).
    assert.equal(bookingStatusSubject('bogus', 'SalonA'), null);
});

// ---------- controller wiring (happy paths survive an unconfigured mailer) ----------

test('updateAppointmentStatus happy path: 200 + customer notification written despite unconfigured mailer', async () => {
    const req = {
        params: { appointmentId: String(apptPending.id) },
        user: { role: 'salon', salonId: salonA.id },
        body: { status: 'declined' },
    };
    const res = mockRes();
    await updateAppointmentStatus(req, res);
    assert.equal(res.statusCode, 200);

    await apptPending.reload();
    assert.equal(apptPending.status, 'declined');

    const notice = await waitFor(() => Notification.findOne({
        where: { recipientRole: 'customer', recipientId: customer.id, type: 'booking.declined', appointmentId: apptPending.id },
    }));
    assert.ok(notice, 'in-app notification still created');
});

test('cancelAppointment happy path: 200 + cancellation notification written despite unconfigured mailer', async () => {
    const req = {
        params: { appointmentId: String(apptCancellable.id) },
        user: { role: 'customer', userId: customer.id },
    };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 200);

    await apptCancellable.reload();
    assert.equal(apptCancellable.status, 'cancelled');

    const notice = await waitFor(() => Notification.findOne({
        where: { recipientRole: 'salon', recipientId: salonA.id, type: 'booking.cancelled', appointmentId: apptCancellable.id },
    }));
    assert.ok(notice, 'salon notification still created');
});
