// Demo payments: when no Cashfree credentials are configured (or
// PAYMENTS_MODE=demo), orders get a locally-minted "demo-" session id, the
// gateway is never contacted, and the status endpoint auto-settles the order
// so the full book → pay → confirm flow works without real keys.
//
// PAYMENTS_MODE must be set BEFORE utils/config is required — config is
// parsed once at require time.
process.env.PAYMENTS_MODE = 'demo';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
const { config } = require('../utils/config');
require('../models/associations'); // wire associations
const Salons = require('../models/salonsModel');
const Services = require('../models/servicesModel');
const Staff = require('../models/staffModel');
const User = require('../models/userModel');
const Appointment = require('../models/appointmentModel');
const Payment = require('../models/paymentModel');

// Prove the real Cashfree SDK is never contacted in demo mode: any call
// throws and is counted.
const { Cashfree } = require('cashfree-pg');
const realCreate = Cashfree.PGCreateOrder;
let gatewayCreateCalls = 0;
Cashfree.PGCreateOrder = async () => {
  gatewayCreateCalls += 1;
  throw new Error('PGCreateOrder must not be called in demo mode');
};

const {
  createOrder,
  isDemoSession,
  isDemoPayments,
} = require('../services/cashfreeServices');
const { processPayment, getPaymentStatus_ } = require('../controllers/paymentController');

const mockRes = () => {
  const r = { statusCode: 200, body: null };
  r.status = (code) => { r.statusCode = code; return r; };
  r.json = (data) => { r.body = data; return r; };
  r.send = (data) => { r.body = data; return r; };
  return r;
};
const mockReq = (overrides = {}) => ({
  user: {}, query: {}, params: {}, body: {}, headers: {},
  secure: false, get: (k) => (k === 'host' ? 'localhost' : undefined),
  ...overrides,
});

const pad = (n) => String(n).padStart(2, '0');
const daysFromNow = (days) => {
  const d = new Date(Date.now() + days * 24 * 3600 * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

let customer, salon, staff, service;

before(async () => {
  await sequelize.sync({ force: true });

  customer = await User.create({ name: 'Demo Tester', email: 'demo@t.com', password: 'x', phoneNumber: '9' });
  salon = await Salons.create({
    name: 'Demo Salon', email: 'ds@t.com', password: 'x', phoneNumber: '1', address: 'a', pricing: 'Premium',
    workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '00:00', closingTime: '23:59',
  });
  staff = await Staff.create({
    name: 'Demo Stylist', email: 'dsty@t.com', password: 'x', phoneNumber: '2', salonId: salon.id,
  });
  const StaffServicesModel = require('../models/StaffServices');
  service = await Services.create({ name: 'Demo Cut', price: 800, duration: 60, salonId: salon.id });
  await StaffServicesModel.create({ staffId: staff.id, serviceId: service.id });
});

after(async () => {
  Cashfree.PGCreateOrder = realCreate;
  await sequelize.close();
});

test('PAYMENTS_MODE=demo forces demo mode regardless of keys', () => {
  assert.equal(isDemoPayments(), true);
  assert.equal(config.payments.demo, true);
});

test('createOrder mints a demo- session and never touches the gateway', async () => {
  const sessionId = await createOrder('ORDER-demo-1', 800, 'INR', 1, '9', 'http://localhost:3000');
  assert.ok(typeof sessionId === 'string' && sessionId.startsWith('demo-'), `expected demo- session, got ${sessionId}`);
  assert.ok(sessionId.length > 'demo-'.length + 8, 'demo session id should carry random entropy');
  assert.equal(gatewayCreateCalls, 0, 'PGCreateOrder must never fire in demo mode');
});

test('isDemoSession recognizes only locally-minted sessions', () => {
  assert.equal(isDemoSession('demo-abc123'), true);
  assert.equal(isDemoSession('session_abc123'), false);
  assert.equal(isDemoSession(null), false);
  assert.equal(isDemoSession(undefined), false);
  assert.equal(isDemoSession(42), false);
});

test('processPayment stores the demo session; status endpoint finalizes the booking', async () => {
  const res = mockRes();
  await processPayment(mockReq({
    user: { userId: customer.id, role: 'customer' },
    body: {
      serviceId: service.id, salonId: salon.id, staffId: staff.id,
      dateSelect: daysFromNow(3), time: '10:00',
    },
  }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.paymentSessionId.startsWith('demo-'), 'order should carry a demo session id');
  assert.equal(gatewayCreateCalls, 0);

  const order = await Payment.findOne({ where: { orderId: res.body.orderId } });
  assert.equal(order.paymentStatus, 'Pending');

  // The customer polls the status endpoint (exactly what the SPA's
  // PaymentStatus page does after the simulated checkout).
  const statusRes = mockRes();
  await getPaymentStatus_(mockReq({
    user: { userId: customer.id, role: 'customer' },
    params: { orderId: res.body.orderId },
  }), statusRes);

  assert.equal(statusRes.statusCode, 200, JSON.stringify(statusRes.body));
  assert.equal(statusRes.body.paymentStatus, 'Success');

  const appt = await Appointment.findOne({ where: { orderId: res.body.orderId } });
  assert.ok(appt, 'demo success must materialize the appointment');
  assert.equal(appt.status, 'confirmed');

  await order.reload();
  assert.equal(order.paymentStatus, 'Success');
});

test('?simulate=failure marks a demo order failed and the failure sticks', async () => {
  const res = mockRes();
  await processPayment(mockReq({
    user: { userId: customer.id, role: 'customer' },
    body: {
      serviceId: service.id, salonId: salon.id, staffId: staff.id,
      dateSelect: daysFromNow(4), time: '12:00',
    },
  }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const { orderId } = res.body;

  const failRes = mockRes();
  await getPaymentStatus_(mockReq({
    user: { userId: customer.id, role: 'customer' },
    params: { orderId },
    query: { simulate: 'failure' },
  }), failRes);
  assert.equal(failRes.body.paymentStatus, 'Failure');

  // No booking is created for a failed order.
  assert.equal(await Appointment.findOne({ where: { orderId } }), null);

  // A later plain poll (the SPA re-polls without the query param) must NOT
  // resurrect the failed order to Success.
  const recheck = mockRes();
  await getPaymentStatus_(mockReq({
    user: { userId: customer.id, role: 'customer' },
    params: { orderId },
  }), recheck);
  assert.equal(recheck.body.paymentStatus, 'Failure', 'simulated failure must stick');
  assert.equal(await Appointment.findOne({ where: { orderId } }), null);
});

test('demo order status is still access-controlled', async () => {
  const res = mockRes();
  await processPayment(mockReq({
    user: { userId: customer.id, role: 'customer' },
    body: {
      serviceId: service.id, salonId: salon.id, staffId: staff.id,
      dateSelect: daysFromNow(5), time: '15:00',
    },
  }), res);
  const { orderId } = res.body;

  // A DIFFERENT customer must not read (or settle) someone else's order.
  const other = mockRes();
  await getPaymentStatus_(mockReq({
    user: { userId: customer.id + 999, role: 'customer' },
    params: { orderId },
  }), other);
  assert.equal(other.statusCode, 403);
  assert.equal(other.body.paymentStatus, undefined);
});
