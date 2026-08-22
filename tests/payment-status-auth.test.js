const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Payment = require('../models/paymentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const { getPaymentStatus_, canAccessPayment } = require('../controllers/paymentController');

// Minimal req/res stubs for invoking the controller directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

let customer, otherCustomer, salon, otherSalon, staff, service, order;

before(async () => {
    await sequelize.sync({ force: true });
    customer = await User.create({ name: 'Cust', email: 'c@t.com', password: 'x', phoneNumber: '1' });
    otherCustomer = await User.create({ name: 'Other', email: 'o@t.com', password: 'x', phoneNumber: '2' });
    salon = await Salons.create({ name: 'S', email: 's@t.com', password: 'x', phoneNumber: '3', address: 'a', pricing: 'Moderate' });
    otherSalon = await Salons.create({ name: 'S2', email: 's2@t.com', password: 'x', phoneNumber: '33', address: 'b', pricing: 'Moderate' });
    staff = await Staff.create({ name: 'Stylist', email: 'st@t.com', password: 'x', phoneNumber: '4', salonId: salon.id });
    service = await Services.create({ name: 'Cut', price: 500, duration: 30, salonId: salon.id });

    order = await Payment.create({
        orderId: 'ORDER-test-auth-1',
        paymentSessionId: 'session_1',
        orderAmount: 500.00,
        orderCurrency: 'INR',
        paymentStatus: 'Pending',
        customerID: customer.id,
        dateSelected: '2030-01-01',
        timeSelected: '10:00',
        endTime: '10:30',
        staffId: staff.id,
        salonId: salon.id,
        serviceId: service.id,
        duration: 30,
    });
});

after(async () => { await sequelize.close(); });

test('canAccessPayment: owning customer allowed', () => {
    assert.equal(canAccessPayment(order, { role: 'customer', userId: customer.id }), true);
});

test('canAccessPayment: other customer rejected', () => {
    assert.equal(canAccessPayment(order, { role: 'customer', userId: otherCustomer.id }), false);
});

test('canAccessPayment: salon of the booking allowed, other salon rejected', () => {
    assert.equal(canAccessPayment(order, { role: 'salon', salonId: salon.id }), true);
    assert.equal(canAccessPayment(order, { role: 'salon', salonId: otherSalon.id }), false);
});

test('canAccessPayment: admin allowed; missing role rejected', () => {
    assert.equal(canAccessPayment(order, { role: 'admin' }), true);
    assert.equal(canAccessPayment(order, undefined), false);
    assert.equal(canAccessPayment(order, {}), false);
});

test('404 for unknown order (before any authz decision)', async () => {
    const req = { params: { orderId: 'ORDER-does-not-exist' }, user: { role: 'customer', userId: customer.id } };
    const res = mockRes();
    await getPaymentStatus_(req, res);
    assert.equal(res.statusCode, 404);
});

test('non-owner customer cannot view someone else\'s payment (403)', async () => {
    const req = { params: { orderId: order.orderId }, user: { role: 'customer', userId: otherCustomer.id } };
    const res = mockRes();
    await getPaymentStatus_(req, res);
    assert.equal(res.statusCode, 403);
});

test('unrelated salon cannot view the payment (403)', async () => {
    const req = { params: { orderId: order.orderId }, user: { role: 'salon', salonId: otherSalon.id } };
    const res = mockRes();
    await getPaymentStatus_(req, res);
    assert.equal(res.statusCode, 403);
});
