const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations');
const Appointment = require('../models/appointmentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Favorite = require('../models/favoriteModel');
const { updateCustomerReview } = require('../controllers/appointmentController');

const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

let salon, appt1, appt2, customer;

before(async () => {
    await sequelize.sync({ force: true });
    customer = await User.create({ name: 'C', email: 'c@r.com', password: 'x', phoneNumber: '1' });
    salon = await Salons.create({ name: 'SalonR', email: 'sr@r.com', password: 'x', phoneNumber: '2', address: 'a', pricing: 'Moderate' });
    const staff = await Staff.create({ name: 'Sty', email: 'st@r.com', password: 'x', phoneNumber: '3', salonId: salon.id });
    const service = await Services.create({ name: 'Cut', price: 100, duration: 30, salonId: salon.id });
    appt1 = await Appointment.create({ staffId: staff.id, salonId: salon.id, serviceId: service.id, userId: customer.id, date: '2026-01-01', time: '10:00', endTime: '10:30', status: 'completed' });
    appt2 = await Appointment.create({ staffId: staff.id, salonId: salon.id, serviceId: service.id, userId: customer.id, date: '2026-01-02', time: '11:00', endTime: '11:30', status: 'completed' });
});

after(async () => { await sequelize.close(); });

test('updateCustomerReview accepts a valid 1-5 rating', async () => {
    const req = { params: { appointmentId: String(appt1.id) }, body: { review: 'Great', rating: 4 }, user: { userId: customer.id } };
    const res = mockRes();
    await updateCustomerReview(req, res);
    assert.equal(res.statusCode, 200);
    await appt1.reload();
    assert.equal(appt1.rating, 4);
    assert.equal(appt1.userReview, 'Great');
});

test('updateCustomerReview rejects rating out of range', async () => {
    const req = { params: { appointmentId: String(appt1.id) }, body: { rating: 7 }, user: { userId: customer.id } };
    const res = mockRes();
    await updateCustomerReview(req, res);
    assert.equal(res.statusCode, 400);
});

test('updateCustomerReview works with review only (no rating) — backward compatible', async () => {
    const req = { params: { appointmentId: String(appt2.id) }, body: { review: 'Just text' }, user: { userId: customer.id } };
    const res = mockRes();
    await updateCustomerReview(req, res);
    assert.equal(res.statusCode, 200);
    await appt2.reload();
    assert.equal(appt2.userReview, 'Just text');
    assert.equal(appt2.rating, null);
});

test('updateCustomerReview rejects review on a non-completed appointment', async () => {
    // A pending appointment cannot be reviewed — customers should only rate
    // services they actually received.
    const pending = await Appointment.create({
        staffId: appt1.staffId, salonId: appt1.salonId, serviceId: appt1.serviceId,
        userId: customer.id, date: '2026-03-01', time: '09:00', endTime: '09:30', status: 'pending',
    });
    const req = { params: { appointmentId: String(pending.id) }, body: { review: 'Nope', rating: 5 }, user: { userId: customer.id } };
    const res = mockRes();
    await updateCustomerReview(req, res);
    assert.equal(res.statusCode, 400);
});

test('Favorite composite PK prevents duplicate (findOrCreate is idempotent)', async () => {
    const a = await Favorite.findOrCreate({ where: { userId: customer.id, salonId: salon.id } });
    const b = await Favorite.findOrCreate({ where: { userId: customer.id, salonId: salon.id } });
    assert.equal(a[1], true);  // first call created
    assert.equal(b[1], false); // second call found existing
    const count = await Favorite.count({ where: { userId: customer.id } });
    assert.equal(count, 1);
});
