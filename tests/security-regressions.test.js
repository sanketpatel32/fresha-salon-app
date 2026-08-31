const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Appointment = require('../models/appointmentModel');
const Payment = require('../models/paymentModel');
const Favorite = require('../models/favoriteModel');
// Same note as account-deletion.test.js: these tables carry no FK edges in
// models/associations.js, so they must be required for sequelize.sync() to
// create them.
const FavoriteStaff = require('../models/favoriteStaffModel');
const RecentlyViewed = require('../models/recentlyViewModel');
const RecurringSeries = require('../models/recurringSeriesModel');
const Waitlist = require('../models/waitlistModel');
const Notification = require('../models/notificationModel');

const { handleUserLogin, getUserProfile, editProfile } = require('../controllers/userController');
const { handleStaffLogin } = require('../controllers/staffController');
const { searchUsers, deleteUser } = require('../controllers/adminController');
const { addStaff, assignServices } = require('../controllers/salonStaffController');
const { getServiceById } = require('../controllers/salonServicesController');
const { mailAppointment } = require('../controllers/appointmentController');
const authMiddleware = require('../middlewares/authMiddleware');
const { validate, staffAssignServicesSchema } = require('../utils/validators');
const emailService = require('../services/emailService');

// Minimal req/res stubs for invoking the controllers directly.
const mockReq = (overrides = {}) => ({ user: {}, query: {}, params: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null, headers: {} };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    r.setHeader = (name, value) => { r.headers[name] = value; return r; };
    r.send = (data) => { r.body = data; return r; };
    return r;
};

// mockRes.json stores the raw value (often a Sequelize instance), so a JSON
// round-trip is needed to assert on what Express would actually put on the
// wire — instance.toJSON() drops dataValues keys the controller deleted.
const wire = (res) => JSON.parse(JSON.stringify(res.body));

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Far enough in the future that local-vs-UTC calendar frames can't flip them.
const FUTURE_DATE = '2030-05-10';
const PASSWORD = 'correctHorse123';
const STAFF_PASSWORD = 'staffHorse123';
const RESET_SENTINEL = sha256('reset-sentinel-alice');
const VERIFY_SENTINEL = sha256('verify-sentinel-alice');

let alice, bob, carol, dave; // customers
let salonA, salonB, staffA, serviceA, serviceB;

before(async () => {
    await sequelize.sync({ force: true });

    alice = await User.create({
        name: 'Alice Angry',
        email: 'alice@t.com',
        phoneNumber: '5550101',
        password: await bcrypt.hash(PASSWORD, 10),
        emailVerified: true,
        verificationTokenHash: VERIFY_SENTINEL,
        verificationExpiresAt: new Date(Date.now() + 86400000),
        resetTokenHash: RESET_SENTINEL,
        resetTokenExpiresAt: new Date(Date.now() + 3600000),
    });
    bob = await User.create({
        name: 'Bob Bystander',
        email: 'bob@t.com',
        phoneNumber: '5550202',
        password: await bcrypt.hash(PASSWORD, 10),
    });
    // Carol is the deleteUser victim: she gets one row in every personal-data
    // table the admin cascade must clean up.
    carol = await User.create({
        name: 'Carol Cascade',
        email: 'carol@t.com',
        phoneNumber: '5550303',
        password: await bcrypt.hash(PASSWORD, 10),
    });
    dave = await User.create({
        name: 'Dave Decider',
        email: 'dave@t.com',
        phoneNumber: '5550404',
        password: await bcrypt.hash(PASSWORD, 10),
    });

    salonA = await Salons.create({ name: 'SalonA', email: 'sa@t.com', password: 'x', phoneNumber: '3', address: 'a', pricing: 'Moderate' });
    salonB = await Salons.create({ name: 'SalonB', email: 'sb@t.com', password: 'x', phoneNumber: '4', address: 'b', pricing: 'Premium' });
    staffA = await Staff.create({ name: 'StylistA', email: 'sta@t.com', password: await bcrypt.hash(STAFF_PASSWORD, 10), phoneNumber: '5', salonId: salonA.id });
    serviceA = await Services.create({ name: 'CutA', price: 100, duration: 30, salonId: salonA.id });
    serviceB = await Services.create({ name: 'CutB', price: 200, duration: 45, salonId: salonB.id });

    // ── Carol's footprint (every table deleteUser must handle) ──────────
    await Appointment.create({
        userId: carol.id, staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id,
        date: FUTURE_DATE, time: '09:00', endTime: '09:30', status: 'confirmed',
    });
    await Payment.create({
        orderId: 'ORDER-CAROL-1', paymentSessionId: 'sess-carol-1',
        orderAmount: 100, orderCurrency: 'INR', paymentStatus: 'Success',
        customerID: carol.id, dateSelected: FUTURE_DATE, timeSelected: '09:00', endTime: '09:30',
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, duration: 30,
    });
    await Favorite.create({ userId: carol.id, salonId: salonA.id });
    await FavoriteStaff.create({ userId: carol.id, staffId: staffA.id });
    await RecentlyViewed.create({ userId: carol.id, salonId: salonA.id, viewedAt: new Date() });
    await RecurringSeries.create({
        userId: carol.id, salonId: salonA.id, serviceId: serviceA.id, staffId: staffA.id,
        startDate: FUTURE_DATE, time: '09:00', frequency: 'weekly',
        occurrences: 8, occurrencesCreated: 0, status: 'active',
    });
    await Waitlist.create({ salonId: salonA.id, userId: carol.id, date: FUTURE_DATE, status: 'waiting' });
    await Notification.create({
        recipientRole: 'customer', recipientId: carol.id,
        type: 'booking.confirmed', title: 'Booking confirmed',
    });

    // ── Dave's paid order (mailAppointment fixtures) ────────────────────
    await Payment.create({
        orderId: 'ORDER-MAIL-1', paymentSessionId: 'sess-mail-1',
        orderAmount: 500, orderCurrency: 'INR', paymentStatus: 'Success',
        customerID: dave.id, dateSelected: FUTURE_DATE, timeSelected: '10:00', endTime: '10:30',
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, duration: 30,
    });
});

after(async () => { await sequelize.close(); });

// ── 1. Login enumeration closed ───────────────────────────────────────────

test('customer login: unknown email and wrong password answer the identical 401 "Invalid credentials"', async () => {
    const unknown = mockRes();
    await handleUserLogin({ body: { email: 'ghost@nowhere.tld', password: PASSWORD } }, unknown);
    assert.equal(unknown.statusCode, 401, 'unknown email: 401, not 404');
    assert.equal(unknown.body.error, 'Invalid credentials');

    const wrong = mockRes();
    await handleUserLogin({ body: { email: alice.email, password: 'totallyWrong9' } }, wrong);
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.body.error, 'Invalid credentials');

    // No signal may distinguish the branches — status AND full body equality.
    assert.equal(unknown.statusCode, wrong.statusCode);
    assert.deepEqual(unknown.body, wrong.body);
    assert.deepEqual(Object.keys(unknown.body), ['error'], 'nothing but the error key');
});

test('staff login: unknown email and wrong password answer the identical 401 "Invalid credentials"', async () => {
    const unknown = mockRes();
    await handleStaffLogin({ body: { email: 'ghost-staff@nowhere.tld', password: STAFF_PASSWORD } }, unknown);
    assert.equal(unknown.statusCode, 401, 'unknown staff email: 401, not 404');
    assert.equal(unknown.body.error, 'Invalid credentials');

    const wrong = mockRes();
    await handleStaffLogin({ body: { email: staffA.email, password: 'totallyWrong9' } }, wrong);
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.body.error, 'Invalid credentials');

    assert.equal(unknown.statusCode, wrong.statusCode);
    assert.deepEqual(unknown.body, wrong.body);
});

// ── 2. Profile reads ship no credential material ─────────────────────────

test('getUserProfile: wire payload has no password, resetTokenHash or verificationTokenHash', async () => {
    const res = mockRes();
    await getUserProfile(mockReq({ user: { userId: alice.id, role: 'customer' } }), res);
    assert.equal(res.statusCode, 200);

    const body = wire(res);
    assert.ok(!('password' in body), 'password must not ship');
    assert.ok(!('resetTokenHash' in body), 'resetTokenHash must not ship');
    assert.ok(!('verificationTokenHash' in body), 'verificationTokenHash must not ship');
    // Belt-and-braces: the sentinel hash values themselves must be nowhere in
    // the serialized payload, whatever key they might hide under.
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes(RESET_SENTINEL));
    assert.ok(!serialized.includes(VERIFY_SENTINEL));
});

// ── 3. editProfile ────────────────────────────────────────────────────────

test('editProfile: duplicate email is refused with 409 "Email is already in use"', async () => {
    await alice.reload();
    const res = mockRes();
    await editProfile(mockReq({
        user: { userId: alice.id, role: 'customer' },
        body: { email: bob.email },
    }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.message, 'Email is already in use');

    await alice.reload();
    assert.equal(alice.email, 'alice@t.com', 'refused edit must not mutate the row');
});

test('editProfile: changing email resets emailVerified and burns the verification token', async () => {
    const res = mockRes();
    await editProfile(mockReq({
        user: { userId: alice.id, role: 'customer' },
        body: { email: 'alice-new@t.com' },
    }), res);
    assert.equal(res.statusCode, 200);

    await alice.reload();
    assert.equal(alice.email, 'alice-new@t.com');
    assert.equal(alice.emailVerified, false, 'a new address is unproven');
    assert.equal(alice.verificationTokenHash, null, 'old-address token must be burned');
    assert.equal(alice.verificationExpiresAt, null);
});

test('editProfile: response is whitelisted — profile fields present, credential keys absent', async () => {
    const res = mockRes();
    await editProfile(mockReq({
        user: { userId: alice.id, role: 'customer' },
        body: { name: 'Alice v2' },
    }), res);
    assert.equal(res.statusCode, 200);

    const user = res.body.user;
    for (const key of ['id', 'name', 'email', 'phoneNumber', 'emailVerified']) {
        assert.ok(key in user, `${key} must be present`);
    }
    for (const key of ['password', 'resetTokenHash', 'resetTokenExpiresAt', 'verificationTokenHash', 'verificationExpiresAt']) {
        assert.ok(!(key in user), `${key} must never ship`);
    }
    assert.equal(user.name, 'Alice v2');
});

test('editProfile: partial update { name } leaves email and phoneNumber untouched', async () => {
    await alice.reload();
    const emailBefore = alice.email;
    const phoneBefore = alice.phoneNumber;

    const res = mockRes();
    await editProfile(mockReq({
        user: { userId: alice.id, role: 'customer' },
        body: { name: 'Alice v3' },
    }), res);
    assert.equal(res.statusCode, 200);

    await alice.reload();
    assert.equal(alice.name, 'Alice v3');
    assert.equal(alice.email, emailBefore, 'omitted email must not be clobbered');
    assert.equal(alice.phoneNumber, phoneBefore, 'omitted phoneNumber must not be clobbered');
});

// ── 4. Admin user search whitelist ───────────────────────────────────────

test('admin searchUsers: every row carries only the whitelisted key set', async () => {
    const res = mockRes();
    await searchUsers(mockReq({ query: { searchTerm: 't.com' }, user: { role: 'admin' } }), res);
    assert.equal(res.statusCode, 200);

    const rows = wire(res);
    assert.ok(Array.isArray(rows) && rows.length > 0, 'fixture users should match');
    const allowed = ['id', 'name', 'email', 'phoneNumber', 'createdAt'];
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            assert.ok(allowed.includes(key), `unexpected key "${key}" in search row`);
        }
        assert.ok(!('password' in row));
        assert.ok(!('resetTokenHash' in row));
        assert.ok(!('verificationTokenHash' in row));
    }
});

// ── 5. addStaff response ──────────────────────────────────────────────────

test('addStaff: 201 response staff object ships no bcrypt password hash', async () => {
    const res = mockRes();
    await addStaff(mockReq({
        user: { salonId: salonA.id, role: 'salon' },
        body: { name: 'Newbie', phoneNumber: '5550909', email: 'newbie@t.com', password: 'plainSecret123' },
    }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.message, 'Staff member added successfully');

    const body = wire(res);
    assert.ok(body.staff && body.staff.id, 'staff object should be returned');
    assert.ok(!('password' in body.staff), 'the bcrypt hash must not ship');

    // The stored row still HAS a hash — and it is not the plaintext, and it is
    // not anywhere in the response body either.
    const stored = await Staff.findByPk(body.staff.id);
    assert.match(stored.password, /^\$2[aby]\$/, 'stored password stays a bcrypt hash');
    assert.notEqual(stored.password, 'plainSecret123');
    assert.ok(!JSON.stringify(body).includes(stored.password), 'no hash substring anywhere in the response');
});

// ── 6. Service ownership ──────────────────────────────────────────────────

test('getServiceById: salon-B service behind a salon-A token is 403; own salon is 200', async () => {
    const foreign = mockRes();
    await getServiceById(mockReq({ params: { id: String(serviceB.id) }, user: { salonId: salonA.id, role: 'salon' } }), foreign);
    assert.equal(foreign.statusCode, 403, 'cross-salon read must be denied');
    assert.equal(foreign.body.message, 'Unauthorized: Access denied to this service');

    const own = mockRes();
    await getServiceById(mockReq({ params: { id: String(serviceB.id) }, user: { salonId: salonB.id, role: 'salon' } }), own);
    assert.equal(own.statusCode, 200);
    assert.equal(wire(own).id, serviceB.id);
});

// ── 7. Admin deleteUser full cleanup ──────────────────────────────────────

test('admin deleteUser: 200 and the user row plus appointment/payment/favorites are gone', async () => {
    const res = mockRes();
    await deleteUser(
        { params: { id: String(carol.id) }, user: { role: 'admin', admin: 'admin@t.com' } },
        res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'User deleted successfully');

    assert.equal(await User.findByPk(carol.id), null, 'user row must be gone');
    assert.equal(await Appointment.count({ where: { userId: carol.id } }), 0);
    assert.equal(await Payment.count({ where: { customerID: carol.id } }), 0);
    assert.equal(await Favorite.count({ where: { userId: carol.id } }), 0);
    assert.equal(await FavoriteStaff.count({ where: { userId: carol.id } }), 0);
    assert.equal(await RecentlyViewed.count({ where: { userId: carol.id } }), 0);
});

test('admin deleteUser: recurring series cancelled, waitlist left, customer notification destroyed', async () => {
    const series = await RecurringSeries.findOne({ where: { userId: carol.id } });
    assert.ok(series, 'series row is kept (history), but...');
    assert.equal(series.status, 'cancelled', 'an active series must not outlive its user');

    const entry = await Waitlist.findOne({ where: { userId: carol.id } });
    assert.ok(entry, 'waitlist row is kept (lifecycle), but...');
    assert.equal(entry.status, 'left');

    assert.equal(
        await Notification.count({ where: { recipientRole: 'customer', recipientId: carol.id } }),
        0,
        'customer notifications must be destroyed',
    );
});

// ── 8. mailAppointment ────────────────────────────────────────────────────

test('mailAppointment: missing orderId is a 400 before any lookup', async () => {
    const res = mockRes();
    await mailAppointment(mockReq({ body: {}, user: { role: 'customer', userId: alice.id } }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'orderId is required');
});

test('mailAppointment: another customer\'s order is a 403, no email attempt', async () => {
    const original = emailService.sendBookingConfirmation;
    let attempted = 0;
    emailService.sendBookingConfirmation = async () => { attempted += 1; return { sent: true }; };
    try {
        const res = mockRes();
        await mailAppointment(mockReq({
            body: { orderId: 'ORDER-MAIL-1' },
            user: { role: 'customer', userId: alice.id }, // order belongs to dave
        }), res);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.message, 'Not authorized to email this booking');
        assert.equal(attempted, 0, 'refused request must never reach the mailer');
    } finally {
        emailService.sendBookingConfirmation = original;
    }
});

test('mailAppointment: the payment owner gets a non-error (mailer stubbed to sent)', async () => {
    const original = emailService.sendBookingConfirmation;
    const calls = [];
    emailService.sendBookingConfirmation = async (ctx) => { calls.push(ctx); return { sent: true }; };
    try {
        const res = mockRes();
        await mailAppointment(mockReq({
            body: { orderId: 'ORDER-MAIL-1' },
            user: { role: 'customer', userId: dave.id },
        }), res);
        assert.equal(res.statusCode, 200, 'owner must not be denied');
        assert.equal(res.body.message, 'Email sent successfully');

        assert.equal(calls.length, 1);
        assert.equal(calls[0].order.orderId, 'ORDER-MAIL-1');
        assert.equal(calls[0].customer.id, dave.id);
    } finally {
        emailService.sendBookingConfirmation = original;
    }
});

// ── 9. assignServices reads the validated body ────────────────────────────

test('assignServices: staffId in req.body assigns services (200) and getServices reflects it', async () => {
    const res = mockRes();
    await assignServices(mockReq({
        user: { salonId: salonA.id, role: 'salon' },
        body: { staffId: staffA.id, services: [serviceA.id] },
    }), res);
    assert.equal(res.statusCode, 200, 'the old req.query.staffid read always 400\'d here');
    assert.equal(res.body.message, 'Services assigned successfully');

    const assigned = await staffA.getServices();
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].id, serviceA.id);
});

test('staffAssignServicesSchema middleware: staffId via query ONLY (body without staffId) is rejected 400', () => {
    let err = null;
    let ok = false;
    validate(staffAssignServicesSchema)(
        { body: { services: [serviceA.id] }, query: { staffid: String(staffA.id) } },
        mockRes(),
        (e) => { if (e) err = e; else ok = true; },
    );
    assert.equal(ok, false, 'a body missing staffId must not pass validation');
    assert.equal(err && err.status, 400, 'schema failure maps to 400');

    // Positive control: staffId in the BODY passes and is coerced to a number.
    const req = { body: { staffId: String(staffA.id), services: [serviceA.id] }, query: {} };
    let okNext = false;
    validate(staffAssignServicesSchema)(req, mockRes(), () => { okNext = true; });
    assert.equal(okNext, true);
    assert.strictEqual(req.body.staffId, staffA.id, 'coerced onto the body the controller reads');
});

// ── 10. requireRole guard ─────────────────────────────────────────────────

test('requireRole: a salon token is 403 on a customer-only guard; the right role calls next()', () => {
    const guard = authMiddleware.requireRole('customer');

    const denied = mockRes();
    let deniedNext = false;
    guard({ user: { role: 'salon', salonId: salonA.id } }, denied, () => { deniedNext = true; });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.error, 'Forbidden');
    assert.equal(deniedNext, false, 'wrong role must never reach the controller');

    const allowed = mockRes();
    let allowedNext = false;
    guard({ user: { role: 'customer', userId: alice.id } }, allowed, () => { allowedNext = true; });
    assert.equal(allowedNext, true, 'right role must call next()');
    assert.equal(allowed.statusCode, 200, 'guard itself must not answer the happy path');
});
