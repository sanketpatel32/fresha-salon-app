const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations');
const Appointment = require('../models/appointmentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const { updateCustomerReview, replyToReview } = require('../controllers/appointmentController');
const { getSalonProfile } = require('../controllers/salonController');

const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

let ownerSalon, otherSalon, customer, staff, service;
let reviewedAppt;      // has a customer review (text + rating)
let unreviewedAppt;    // completed but never reviewed

before(async () => {
    await sequelize.sync({ force: true });
    customer = await User.create({ name: 'C', email: 'c@r.com', password: 'x', phoneNumber: '1' });
    ownerSalon = await Salons.create({ name: 'OwnerS', email: 'own@r.com', password: 'x', phoneNumber: '2', address: 'a', pricing: 'Moderate' });
    otherSalon = await Salons.create({ name: 'OtherS', email: 'oth@r.com', password: 'x', phoneNumber: '3', address: 'b', pricing: 'Moderate' });
    staff = await Staff.create({ name: 'Sty', email: 'st@r.com', password: 'x', phoneNumber: '4', salonId: ownerSalon.id });
    service = await Services.create({ name: 'Cut', price: 100, duration: 30, salonId: ownerSalon.id });
    reviewedAppt = await Appointment.create({ staffId: staff.id, salonId: ownerSalon.id, serviceId: service.id, userId: customer.id, date: '2026-01-01', time: '10:00', endTime: '10:30', status: 'completed' });
    unreviewedAppt = await Appointment.create({ staffId: staff.id, salonId: ownerSalon.id, serviceId: service.id, userId: customer.id, date: '2026-01-02', time: '11:00', endTime: '11:30', status: 'completed' });

    // Customer leaves a text review + rating on reviewedAppt via the real flow.
    const req = { params: { appointmentId: String(reviewedAppt.id) }, body: { review: 'Great cut', rating: 5 }, user: { userId: customer.id } };
    await updateCustomerReview(req, mockRes());
});

after(async () => { await sequelize.close(); });

test('salon owner can reply to a customer review', async () => {
    const req = {
        params: { appointmentId: String(reviewedAppt.id) },
        body: { reply: 'Thank you for the kind words!' },
        user: { role: 'salon', salonId: ownerSalon.id },
    };
    const res = mockRes();
    await replyToReview(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'Reply saved successfully');
    assert.equal(res.body.salonReply, 'Thank you for the kind words!');
    await reviewedAppt.reload();
    assert.equal(reviewedAppt.salonReply, 'Thank you for the kind words!');
});

test('salon owner can edit an existing reply (upsert)', async () => {
    const req = {
        params: { appointmentId: String(reviewedAppt.id) },
        body: { reply: 'Edited reply — sorry for the mix-up!' },
        user: { role: 'salon', salonId: ownerSalon.id },
    };
    const res = mockRes();
    await replyToReview(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.salonReply, 'Edited reply — sorry for the mix-up!');
    await reviewedAppt.reload();
    assert.equal(reviewedAppt.salonReply, 'Edited reply — sorry for the mix-up!');
});

test('a different salon gets 403 when replying to another salon\'s review', async () => {
    const req = {
        params: { appointmentId: String(reviewedAppt.id) },
        body: { reply: 'Not my booking' },
        user: { role: 'salon', salonId: otherSalon.id },
    };
    const res = mockRes();
    await replyToReview(req, res);
    assert.equal(res.statusCode, 403);
});

test('replying to an unknown appointment returns 404', async () => {
    const req = {
        params: { appointmentId: '999999' },
        body: { reply: 'Hello?' },
        user: { role: 'salon', salonId: ownerSalon.id },
    };
    const res = mockRes();
    await replyToReview(req, res);
    assert.equal(res.statusCode, 404);
});

test('replying before any customer review exists returns 400', async () => {
    // Completed but neither rating nor userReview set.
    const req = {
        params: { appointmentId: String(unreviewedAppt.id) },
        body: { reply: 'Too early!' },
        user: { role: 'salon', salonId: ownerSalon.id },
    };
    const res = mockRes();
    await replyToReview(req, res);
    assert.equal(res.statusCode, 400);
    await unreviewedAppt.reload();
    assert.equal(unreviewedAppt.salonReply, null);
});

test('reply is visible in the public salon profile reviews listing', async () => {
    const req = { params: { salonId: String(ownerSalon.id) } };
    const res = mockRes();
    await getSalonProfile(req, res);
    assert.equal(res.statusCode, 200);
    const row = res.body.reviews.find((r) => r.userReview === 'Great cut');
    assert.ok(row, 'reviewed appointment should be listed');
    assert.equal(row.salonReply, 'Edited reply — sorry for the mix-up!');
});
