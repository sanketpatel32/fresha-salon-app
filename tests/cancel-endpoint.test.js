const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Appointment = require('../models/appointmentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const { cancelAppointment } = require('../controllers/appointmentController');

// Minimal req/res stubs for invoking the controller directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

let customer, otherCustomer, futureAppt, pastAppt, pendingAppt, completedAppt;

before(async () => {
    await sequelize.sync({ force: true });
    customer = await User.create({ name: 'Cust', email: 'c@t.com', password: 'x', phoneNumber: '1' });
    otherCustomer = await User.create({ name: 'Other', email: 'o@t.com', password: 'x', phoneNumber: '2' });
    const salon = await Salons.create({ name: 'S', email: 's@t.com', password: 'x', phoneNumber: '3', address: 'a', pricing: 'Moderate' });
    const staff = await Staff.create({ name: 'Stylist', email: 'st@t.com', password: 'x', phoneNumber: '4', salonId: salon.id });
    const service = await Services.create({ name: 'Cut', price: 100, duration: 30, salonId: salon.id });

    const futureDate = new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 10);
    const pastDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

    futureAppt = await Appointment.create({ staffId: staff.id, salonId: salon.id, serviceId: service.id, userId: customer.id, date: futureDate, time: '12:00', endTime: '12:30', status: 'confirmed' });
    pendingAppt = await Appointment.create({ staffId: staff.id, salonId: salon.id, serviceId: service.id, userId: customer.id, date: futureDate, time: '13:00', endTime: '13:30', status: 'pending' });
    pastAppt = await Appointment.create({ staffId: staff.id, salonId: salon.id, serviceId: service.id, userId: customer.id, date: pastDate, time: '12:00', endTime: '12:30', status: 'confirmed' });
    completedAppt = await Appointment.create({ staffId: staff.id, salonId: salon.id, serviceId: service.id, userId: customer.id, date: futureDate, time: '14:00', endTime: '14:30', status: 'completed' });
});

after(async () => { await sequelize.close(); });

test('owner can cancel a confirmed appointment >24h away', async () => {
    const req = { params: { appointmentId: String(futureAppt.id) }, user: { userId: customer.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 200);
    await futureAppt.reload();
    assert.equal(futureAppt.status, 'cancelled');
});

test('owner can cancel a pending appointment >24h away', async () => {
    const req = { params: { appointmentId: String(pendingAppt.id) }, user: { userId: customer.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 200);
});

test('cannot cancel an appointment within 24h', async () => {
    // pastAppt's date is yesterday so it's well within 24h.
    const req = { params: { appointmentId: String(pastAppt.id) }, user: { userId: customer.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /cancel/i);
});

test('cannot cancel a completed appointment', async () => {
    const req = { params: { appointmentId: String(completedAppt.id) }, user: { userId: customer.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 400);
});

test('non-owner cannot cancel (403)', async () => {
    const req = { params: { appointmentId: String(futureAppt.id) }, user: { userId: otherCustomer.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 403);
});

test('404 for unknown appointment', async () => {
    const req = { params: { appointmentId: '999999' }, user: { userId: customer.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 404);
});
