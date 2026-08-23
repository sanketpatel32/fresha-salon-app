const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const User = require('../models/userModel');
const Appointment = require('../models/appointmentModel');
const Notification = require('../models/notificationModel');

// Cashfree never comes into play here — completions happen through
// updateAppointmentStatus, exactly where salons/staff mark bookings done.
const { updateAppointmentStatus } = require('../controllers/appointmentController');
const { getLoyaltyBalance, getUserProfile } = require('../controllers/userController');
const { getPlatformStats } = require('../controllers/adminController');
const { awardForCompletedAppointment, POINTS_PER_APPOINTMENT } = require('../services/loyaltyService');
const authMiddleware = require('../middlewares/authMiddleware');
const userRoutes = require('../routes/userRoutes');

// Minimal req/res stubs for invoking the controllers directly
// (established mock style across the suites).
const mockReq = (overrides = {}) => ({ user: {}, query: {}, params: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null, headers: {} };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    r.setHeader = (name, value) => { r.headers[name] = value; return r; };
    r.send = (data) => { r.body = data; return r; };
    return r;
};

// The loyalty notification is fire-and-forget; poll briefly until it lands.
const waitFor = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await fn();
        if (result) return result;
        await new Promise((r) => setTimeout(r, 25));
    }
    return await fn();
};

// Salon caller for status transitions (owns salonA, so authorization passes).
const salonAs = () => ({ role: 'salon', salonId: salonA.id });

let customer, salonA, staffA, serviceA;

before(async () => {
    await sequelize.sync({ force: true });

    customer = await User.create({ name: 'Loyal Liz', email: 'liz@t.com', password: 'x', phoneNumber: '1' });
    salonA = await Salons.create({
        name: 'Points Salon', email: 'ps@t.com', password: 'x', phoneNumber: '2', address: 'a', pricing: 'Premium',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '00:00', closingTime: '23:59',
    });
    staffA = await Staff.create({ name: 'Stylist Points', email: 'stp@t.com', password: 'x', phoneNumber: '3', salonId: salonA.id });
    serviceA = await Services.create({ name: 'Loyalty Cut', price: 500, duration: 30, salonId: salonA.id });
});

after(async () => { await sequelize.close(); });

// Confirmed booking fixture — date/time values don't gate completed moves
// (only no-show checks the clock), so any plausible slot works.
const mkConfirmedAppt = async (overrides = {}) => Appointment.create({
    userId: customer.id,
    salonId: salonA.id,
    staffId: staffA.id,
    serviceId: serviceA.id,
    date: '2030-01-01',
    time: '10:00',
    endTime: '10:30',
    status: 'confirmed',
    ...overrides,
});

const setStatus = async (appt, status, user = salonAs()) => {
    const res = mockRes();
    await updateAppointmentStatus(mockReq({ user, params: { appointmentId: String(appt.id) }, body: { status } }), res);
    return res;
};

// ── Earning: flat 10, exactly once ────────────────────────────────────────

test('completing a booking awards a flat 10 points once, stamps pointsAwardedAt, and notifies', async () => {
    const appt = await mkConfirmedAppt();
    const res = await setStatus(appt, 'completed');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.appointment.status, 'completed');

    await customer.reload();
    assert.equal(Number(customer.loyaltyPoints), POINTS_PER_APPOINTMENT, 'balance gains exactly 10');
    assert.equal(Number(customer.lifetimePointsEarned), POINTS_PER_APPOINTMENT, 'audit counter mirrors it');

    // The award was claimed on the row itself — the replay guard.
    const stamped = await Appointment.findByPk(appt.id);
    assert.ok(stamped.pointsAwardedAt, 'pointsAwardedAt set inside the successful transition');

    // Fire-and-forget notification eventually lands for the right customer.
    const notice = await waitFor(() => Notification.findOne({
        where: { recipientRole: 'customer', recipientId: customer.id, type: 'loyalty.earned' },
    }));
    assert.ok(notice, 'loyalty.earned notification written');
    assert.equal(notice.title, `You earned ${POINTS_PER_APPOINTMENT} points`);
    assert.equal(notice.appointmentId, appt.id);
});

test('a second completion attempt is refused by the transition rules and awards nothing', async () => {
    const appt = await Appointment.findOne({ where: { status: 'completed' } });
    const res = await setStatus(appt, 'completed'); // completed is terminal -> canTransition false

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Cannot move appointment from 'completed'/);

    await customer.reload();
    assert.equal(Number(customer.loyaltyPoints), POINTS_PER_APPOINTMENT, 'no double award via replays');
});

test('re-invoking the award helper directly (any future re-entry path) is a guarded no-op', async () => {
    const appt = await Appointment.findOne({ where: { status: 'completed' } });
    const outcome = await awardForCompletedAppointment(appt);

    assert.equal(outcome.awarded, 0, 'stamp already present -> skipped');
    await customer.reload();
    assert.equal(Number(customer.loyaltyPoints), POINTS_PER_APPOINTMENT, 'balance untouched by the replay');
});

test('non-completed transitions award nothing (confirmed stays 10)', async () => {
    const pending = await mkConfirmedAppt({ status: 'pending' });
    const ok = await setStatus(pending, 'confirmed');
    assert.equal(ok.statusCode, 200);

    const other = await mkConfirmedAppt({ status: 'pending' });
    const declined = await setStatus(other, 'declined');
    assert.equal(declined.statusCode, 200);

    await customer.reload();
    assert.equal(Number(customer.loyaltyPoints), POINTS_PER_APPOINTMENT, 'confirm/decline earn zero');
    assert.equal(Number(customer.lifetimePointsEarned), POINTS_PER_APPOINTMENT);
    assert.equal(await Appointment.count({ where: { pointsAwardedAt: { [require('sequelize').Op.ne]: null } } }), 1,
        'still only one stamped booking overall');
});

// ── Award failures never break the status change ──────────────────────────

test('a failing balance increment is swallowed: transition succeeds, ledger unchanged', async () => {
    const appt = await mkConfirmedAppt();

    const originalIncrement = User.increment;
    User.increment = () => Promise.reject(new Error('db exploded'));
    try {
        const res = await setStatus(appt, 'completed');
        assert.equal(res.statusCode, 200, 'the status change must survive the award failure');
        assert.equal(res.body.appointment.status, 'completed');
    } finally {
        User.increment = originalIncrement;
    }

    const row = await Appointment.findByPk(appt.id);
    assert.equal(row.status, 'completed', 'status persisted despite the award blowing up');
    assert.ok(row.pointsAwardedAt, 'claim-first: the stamp landed before the increment failed');
    await customer.reload();
    assert.equal(Number(customer.loyaltyPoints), POINTS_PER_APPOINTMENT,
        'under-awards once rather than double-crediting (documented trade-off)');
});

// ── GET /api/user/loyalty ─────────────────────────────────────────────────

test('GET /loyalty returns { points, lifetimePointsEarned, referralCode } scoped to the token', async () => {
    const res = mockRes();
    await getLoyaltyBalance(mockReq({ user: { userId: customer.id, role: 'customer' } }), res);

    assert.equal(res.statusCode, 200);
    // #28 extended this payload: the caller's personal code now ships here
    // (lazily assigned) so clients can show points + code together.
    assert.deepEqual(Object.keys(res.body).sort(), ['lifetimePointsEarned', 'points', 'referralCode'], 'exact shape');
    assert.equal(res.body.points, POINTS_PER_APPOINTMENT);
    assert.equal(res.body.lifetimePointsEarned, POINTS_PER_APPOINTMENT);
    assert.match(res.body.referralCode, /^[A-HJ-NP-Z2-9]{8}$/);

    // Another customer's token must not see anyone else's balance — scoping
    // is by req.user.userId alone.
    const stranger = await User.create({ name: 'Stranger', email: 'str@t.com', password: 'x', phoneNumber: '9' });
    const theirs = mockRes();
    await getLoyaltyBalance(mockReq({ user: { userId: stranger.id, role: 'customer' } }), theirs);
    assert.equal(theirs.body.points, 0);
});

test('profile endpoint (whole-row response) now carries both loyalty fields', async () => {
    const res = mockRes();
    await getUserProfile(mockReq({ user: { userId: customer.id } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(Number(res.body.loyaltyPoints), POINTS_PER_APPOINTMENT);
    assert.equal(Number(res.body.lifetimePointsEarned), POINTS_PER_APPOINTMENT);
});

test('auth scoping: the customer-only role guard rejects salon tokens and passes customers', () => {
    const guard = authMiddleware.requireRole('customer');

    const denied = mockRes();
    let nextCalled = false;
    guard({ user: { role: 'salon', salonId: salonA.id } }, denied, () => { nextCalled = true; });
    assert.equal(denied.statusCode, 403);
    assert.equal(nextCalled, false, 'salon token must never reach the controller');

    const allowed = mockRes();
    guard({ user: { role: 'customer', userId: customer.id } }, allowed, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
});

test('routes: /api/user/loyalty is wired as auth -> roleGuard(customer) -> controller', () => {
    const layer = userRoutes.stack.find((l) => l.route && l.route.path === '/loyalty');
    assert.ok(layer, '/loyalty route should be registered');
    const handlers = layer.route.stack.map((s) => s.handle);
    assert.equal(handlers.length, 3, 'exactly three handlers');
    assert.equal(handlers[0].name, 'isAuth', 'must sit behind authMiddleware');
    assert.equal(handlers[1].name, 'roleGuard', 'must sit behind requireRole(customer)');
    assert.match(handlers[2].name, /^get/, 'terminal handler must be its controller');
});

// ── Legacy rows & admin stat ──────────────────────────────────────────────

test('legacy rows written before loyalty existed (columns omitted) read as 0 everywhere', async () => {
    // A pre-feature writer INSERTs without ever naming the loyalty columns;
    // post-backfill those columns are INTEGER NOT NULL DEFAULT 0, so the row
    // materializes at 0 — never null/garbage. (True NULLs are impossible once
    // ensureColumns has added the constrained columns; readers coerce anyway.)
    const [, meta] = await sequelize.query(
        `INSERT INTO users (name, email, password, phoneNumber, createdAt, updatedAt)
         VALUES ('Legacy Ada', 'ada@t.com', 'x', '42', ?, ?)`,
        { replacements: [new Date().toISOString(), new Date().toISOString()] }
    );
    const legacyId = meta.lastID || meta.insertId || (meta[0] && meta[0].lastID_rowid);

    const res = mockRes();
    await getLoyaltyBalance(mockReq({ user: { userId: legacyId, role: 'customer' } }), res);
    assert.equal(res.statusCode, 200);
    // #28: the loyalty read lazily assigns a referral code, so the legacy
    // row leaves this call with points 0/0 AND a fresh personal code.
    assert.equal(res.body.points, 0);
    assert.equal(res.body.lifetimePointsEarned, 0);
    assert.match(res.body.referralCode, /^[A-HJ-NP-Z2-9]{8}$/);
});

test('admin totalLoyaltyOutstanding sums every user balance exactly (lifetime excluded)', async () => {
    // customer currently holds 10/10; add two known balances.
    const b = await User.create({
        name: 'Payer B', email: 'b@t.com', password: 'x', phoneNumber: '7',
        loyaltyPoints: 25, lifetimePointsEarned: 40,
    });
    await User.create({
        name: 'Payer C', email: 'c@t.com', password: 'x', phoneNumber: '8',
        loyaltyPoints: 5, lifetimePointsEarned: 5,
    });

    const res = mockRes();
    await getPlatformStats({ query: {}, user: { role: 'admin' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.totalLoyaltyOutstanding, 10 + 25 + 5,
        'SUM(loyaltyPoints) only — summing lifetime too would give 60');
    assert.ok(b.id); // keep linters honest about the fixture handle
    for (const key of ['totalSalons', 'totalCustomers', 'totalStaff', 'appointmentsByStatus',
        'revenueTotal', 'totalTips', 'last7Days', 'serverTimestamp']) {
        assert.ok(key in res.body, `${key} still exposed`);
    }
});

test('admin totalLoyaltyOutstanding defaults to 0 on an empty users table', async () => {
    await User.destroy({ where: {} }); // run LAST — wipes the fixtures on purpose

    const res = mockRes();
    await getPlatformStats({ query: {}, user: { role: 'admin' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.totalLoyaltyOutstanding, 0, 'empty table -> 0, never null');
});
