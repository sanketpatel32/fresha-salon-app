const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Appointment = require('../models/appointmentModel');
const Notification = require('../models/notificationModel');
const { notify } = require('../services/notificationService');
const {
    listNotifications,
    markNotificationRead,
    markAllNotificationsRead,
} = require('../controllers/notificationController');
const { cancelAppointment, updateAppointmentStatus } = require('../controllers/appointmentController');

// Minimal req/res stubs for invoking the controller directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// The creation hooks are fire-and-forget; poll briefly until the row shows up.
const waitFor = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await fn();
        if (result) return result;
        await new Promise((r) => setTimeout(r, 25));
    }
    return await fn();
};

let custA, custB, salonA, salonB, staffA, staffB, serviceA;
let apptForCancel, apptForConfirm;

before(async () => {
    await sequelize.sync({ force: true });
    custA = await User.create({ name: 'CustA', email: 'ca@t.com', password: 'x', phoneNumber: '1' });
    custB = await User.create({ name: 'CustB', email: 'cb@t.com', password: 'x', phoneNumber: '2' });
    salonA = await Salons.create({ name: 'SalonA', email: 'sa@t.com', password: 'x', phoneNumber: '3', address: 'a', pricing: 'Moderate' });
    salonB = await Salons.create({ name: 'SalonB', email: 'sb@t.com', password: 'x', phoneNumber: '4', address: 'b', pricing: 'Premium' });
    staffA = await Staff.create({ name: 'StylistA', email: 'sta@t.com', password: 'x', phoneNumber: '5', salonId: salonA.id });
    staffB = await Staff.create({ name: 'StylistB', email: 'stb@t.com', password: 'x', phoneNumber: '6', salonId: salonB.id });
    serviceA = await Services.create({ name: 'CutA', price: 100, duration: 30, salonId: salonA.id });

    const futureDate = new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 10);
    apptForCancel = await Appointment.create({ staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id, date: futureDate, time: '12:00', endTime: '12:30', status: 'confirmed' });
    apptForConfirm = await Appointment.create({ staffId: staffB.id, salonId: salonB.id, serviceId: serviceA.id, userId: custB.id, date: futureDate, time: '13:00', endTime: '13:30', status: 'pending' });

    // Seed notifications through the service itself (also covers it):
    // custA gets 3 (one pre-read), custB 1, salonA 2, salonB 0.
    await notify({ recipientRole: 'customer', recipientId: custA.id, type: 'booking.confirmed', title: 'Booking confirmed', body: '2030-01-01 at 10:00', appointmentId: apptForCancel.id });
    await notify({ recipientRole: 'customer', recipientId: custA.id, type: 'booking.completed', title: 'Booking completed', body: null });
    const old = await notify({ recipientRole: 'customer', recipientId: custA.id, type: 'booking.new', title: 'Old one' });
    // Make exactly one of custA's rows read, and backdate another so
    // newest-first ordering is observable.
    await Notification.update({ readAt: new Date() }, { where: { id: old.id } });
    await Notification.update(
        { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
        { where: { recipientRole: 'customer', recipientId: custA.id, type: 'booking.confirmed' } }
    );
    await notify({ recipientRole: 'customer', recipientId: custB.id, type: 'booking.declined', title: 'Booking declined' });
    await notify({ recipientRole: 'salon', recipientId: salonA.id, type: 'booking.new', title: 'New booking', body: 'CutA on 2030-01-01 at 12:00' });
    await notify({ recipientRole: 'salon', recipientId: salonA.id, type: 'booking.cancelled', title: 'Booking cancelled' });
});

after(async () => { await sequelize.close(); });

// ---------- Service ----------

test('notify creates a row with all fields persisted', async () => {
    const row = await notify({
        recipientRole: 'customer', recipientId: custA.id,
        type: 'review.received', title: 'New review',
        body: 'Someone rated you 5 stars', appointmentId: apptForCancel.id,
    });
    assert.ok(row && row.id);
    assert.equal(row.recipientRole, 'customer');
    assert.equal(Number(row.recipientId), Number(custA.id));
    assert.equal(row.type, 'review.received');
    assert.equal(row.title, 'New review');
    assert.equal(row.body, 'Someone rated you 5 stars');
    assert.equal(row.appointmentId, apptForCancel.id);
    assert.equal(row.readAt, null);
});

test('notify never throws and returns null on missing required fields', async () => {
    const noTitle = await notify({ recipientRole: 'salon', recipientId: salonA.id, type: 'x.y' });
    const noRecipient = await notify({ recipientRole: 'salon', type: 'x.y', title: 'hi' });
    assert.equal(noTitle, null);
    assert.equal(noRecipient, null);
});

// ---------- Listing & scoping ----------

test('customer list: legacy bare array, only own rows, newest first', async () => {
    const res = mockRes();
    await listNotifications({ query: {}, user: { role: 'customer', userId: custA.id } }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    // 3 seeded + 1 from the "creates a row" test above = 4; custB's excluded.
    assert.equal(res.body.length, 4);
    assert.ok(res.body.every((n) => n.recipientRole === 'customer' && Number(n.recipientId) === Number(custA.id)));
    const times = res.body.map((n) => new Date(n.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test('customer list: page+limit -> envelope with correct meta', async () => {
    const res = mockRes();
    await listNotifications({ query: { page: '2', limit: '3' }, user: { role: 'customer', userId: custA.id } }, res);
    assert.ok(!Array.isArray(res.body));
    assert.equal(res.body.data.length, 1); // 4 total -> page 2 of size 3 has 1 row
    assert.deepEqual(
        { page: res.body.page, limit: res.body.limit, total: res.body.total, totalPages: res.body.totalPages },
        { page: 2, limit: 3, total: 4, totalPages: 2 }
    );
});

test('salon list: only own salon rows; salon with zero gets empty array', async () => {
    const resA = mockRes();
    await listNotifications({ query: {}, user: { role: 'salon', salonId: salonA.id } }, resA);
    assert.ok(Array.isArray(resA.body));
    assert.equal(resA.body.length, 2);
    assert.ok(resA.body.every((n) => n.recipientRole === 'salon' && Number(n.recipientId) === Number(salonA.id)));

    const resB = mockRes();
    await listNotifications({ query: { limit: '10' }, user: { role: 'salon', salonId: salonB.id } }, resB);
    assert.deepEqual(resB.body, { data: [], page: 1, limit: 10, total: 0, totalPages: 0 });
});

test('admin (no entity id) owns zero notifications', async () => {
    const res = mockRes();
    await listNotifications({ query: { page: '1', limit: '5' }, user: { role: 'admin' } }, res);
    assert.equal(res.body.total, 0);
    assert.deepEqual(res.body.data, []);
});

// ---------- Mark one as read ----------

test('owner can mark own unread notification read', async () => {
    const target = await Notification.findOne({ where: { recipientRole: 'customer', recipientId: custA.id, readAt: null } });
    const res = mockRes();
    await markNotificationRead({ params: { id: String(target.id) }, user: { role: 'customer', userId: custA.id } }, res);
    assert.equal(res.statusCode, 200);
    await target.reload();
    assert.ok(target.readAt);
});

test('read endpoint 404s someone else\'s notification', async () => {
    const theirs = await Notification.findOne({ where: { recipientRole: 'salon', recipientId: salonA.id } });
    const res = mockRes();
    await markNotificationRead({ params: { id: String(theirs.id) }, user: { role: 'customer', userId: custA.id } }, res);
    assert.equal(res.statusCode, 404);
    await theirs.reload();
    assert.equal(theirs.readAt, null); // untouched
});

test('read endpoint 404s unknown id', async () => {
    const res = mockRes();
    await markNotificationRead({ params: { id: '999999' }, user: { role: 'customer', userId: custA.id } }, res);
    assert.equal(res.statusCode, 404);
});

// ---------- Read-all ----------

test('read-all marks every own unread as read (and zeroes the count)', () => {
    return (async () => {
        const before = await Notification.count({ where: { recipientRole: 'customer', recipientId: custA.id, readAt: null } });
        assert.ok(before > 0);

        const res = mockRes();
        await markAllNotificationsRead({ user: { role: 'customer', userId: custA.id } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.updated, before);

        const afterUnread = await Notification.count({ where: { recipientRole: 'customer', recipientId: custA.id, readAt: null } });
        assert.equal(afterUnread, 0);

        // Other recipients are untouched.
        const salonUnread = await Notification.count({ where: { recipientRole: 'salon', recipientId: salonA.id, readAt: null } });
        assert.equal(salonUnread, 2);
    })();
});

// ---------- Controller hook points ----------

test('cancelling an appointment notifies the salon (other party)', async () => {
    const req = { params: { appointmentId: String(apptForCancel.id) }, user: { role: 'customer', userId: custA.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 200);

    const found = await waitFor(() => Notification.findOne({
        where: { recipientRole: 'salon', recipientId: salonA.id, type: 'booking.cancelled', appointmentId: apptForCancel.id },
    }));
    assert.ok(found, 'salon cancellation notification was created');
    assert.match(found.title, /cancelled/i);
    assert.ok(String(found.body).includes(apptForCancel.date));
});

test('confirming a pending appointment notifies the customer', async () => {
    const req = {
        params: { appointmentId: String(apptForConfirm.id) },
        body: { status: 'confirmed' },
        user: { role: 'salon', salonId: salonB.id }, // owner of apptForConfirm's salon
    };
    const res = mockRes();
    await updateAppointmentStatus(req, res);
    assert.equal(res.statusCode, 200);

    const found = await waitFor(() => Notification.findOne({
        where: { recipientRole: 'customer', recipientId: custB.id, type: 'booking.confirmed', appointmentId: apptForConfirm.id },
    }));
    assert.ok(found, 'customer confirmation notification was created');
    assert.match(found.title, /confirmed/i);
});
