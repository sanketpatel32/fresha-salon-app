const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const User = require('../models/userModel');
const Appointment = require('../models/appointmentModel');
const Favorite = require('../models/favoriteModel');
const Waitlist = require('../models/waitlistModel');
const Notification = require('../models/notificationModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const FavoriteStaff = require('../models/favoriteStaffModel');
// Not wired through models/associations.js (they deliberately carry no FK
// edges — see the model docstrings), so they must be required here or
// sequelize.sync() never creates their tables.
const RecentlyViewed = require('../models/recentlyViewModel');
const RecurringSeries = require('../models/recurringSeriesModel');
const AdminAudit = require('../models/adminAuditModel');
const authMiddleware = require('../middlewares/authMiddleware');
const userRoutes = require('../routes/userRoutes');
const { strictLimiter } = require('../middlewares/rateLimiters');
const { validate, accountDeletionSchema } = require('../utils/validators');
const { deleteMyAccount, handleUserLogin } = require('../controllers/userController');

// Minimal req/res stubs for invoking the controller directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};
const reqWith = (over = {}) => ({
    body: { password: PASSWORD, ...over.body },
    user: { userId: customer ? customer.id : 0, role: 'customer', ...over.user },
});

// Audit writes are fire-and-forget; poll briefly until the row shows up.
const waitFor = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await fn();
        if (result) return result;
        await new Promise((r) => setTimeout(r, 25));
    }
    return await fn();
};

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Far enough into the future/past that local-vs-UTC calendar frames can't flip them.
const FUTURE_DATE = '2030-05-10';
const PAST_DATE = '2020-01-15';
const PASSWORD = 'correctHorse123';

let customer, otherCustomer, salonA, salonB, staffA, serviceA;
let apptFuturePending, apptFutureConfirmed, apptPastCompleted, apptPastCancelled, apptFutureDeclined, apptOtherFuture;

before(async () => {
    await sequelize.sync({ force: true });

    customer = await User.create({
        name: 'Jane Doe',
        email: 'jane@t.com',
        phoneNumber: '5550101',
        password: await bcrypt.hash(PASSWORD, 10),
        emailVerified: true,
        verificationTokenHash: sha256('verification-token'),
        verificationExpiresAt: new Date(Date.now() + 86400000),
        resetTokenHash: sha256('reset-token'),
        resetTokenExpiresAt: new Date(Date.now() + 3600000),
        loyaltyPoints: 50,
        lifetimePointsEarned: 120,
        referralCode: 'JANECODE1',
        referredByUserId: 99, // must survive deletion untouched
    });
    otherCustomer = await User.create({
        name: 'Other Olga',
        email: 'olga@t.com',
        phoneNumber: '5550202',
        password: await bcrypt.hash('olgaPass123', 10),
        loyaltyPoints: 7,
    });

    salonA = await Salons.create({ name: 'SalonA', email: 'sa@t.com', password: 'x', phoneNumber: '3', address: 'a', pricing: 'Moderate' });
    salonB = await Salons.create({ name: 'SalonB', email: 'sb@t.com', password: 'x', phoneNumber: '4', address: 'b', pricing: 'Premium' });
    staffA = await Staff.create({ name: 'StylistA', email: 'sta@t.com', password: 'x', phoneNumber: '5', salonId: salonA.id });
    serviceA = await Services.create({ name: 'CutA', price: 100, duration: 30, salonId: salonA.id });

    const base = { userId: customer.id, staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id };
    // The two rows the feature MUST cancel: pending + confirmed, both in the future.
    apptFuturePending = await Appointment.create({ ...base, date: FUTURE_DATE, time: '09:00', endTime: '10:00', status: 'pending' });
    apptFutureConfirmed = await Appointment.create({ ...base, date: FUTURE_DATE, time: '11:00', endTime: '12:00', status: 'confirmed' });
    // History rows the feature MUST NOT touch.
    apptPastCompleted = await Appointment.create({ ...base, date: PAST_DATE, time: '10:00', endTime: '11:00', status: 'completed' });
    apptPastCancelled = await Appointment.create({ ...base, date: PAST_DATE, time: '12:00', endTime: '13:00', status: 'cancelled' });
    apptFutureDeclined = await Appointment.create({ ...base, date: FUTURE_DATE, time: '14:00', endTime: '15:00', status: 'declined' });
    // Another customer's future booking must survive this user's deletion.
    apptOtherFuture = await Appointment.create({
        userId: otherCustomer.id, staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id,
        date: FUTURE_DATE, time: '16:00', endTime: '17:00', status: 'confirmed',
    });

    await Favorite.bulkCreate([
        { userId: customer.id, salonId: salonA.id },
        { userId: customer.id, salonId: salonB.id },
        { userId: otherCustomer.id, salonId: salonA.id }, // must survive
    ]);

    // #59 / #58 / #61 — the personal-data tables added after the deletion
    // feature shipped. Each is a distinct erasure case: FavoriteStaff has a
    // CASCADE FK but survives anonymization (an UPDATE, not a DELETE);
    // RecentlyViewed has no FK at all; RecurringSeries is standing
    // instructions to create bookings, which must be stopped rather than kept.
    await FavoriteStaff.bulkCreate([
        { userId: customer.id, staffId: staffA.id },
        { userId: otherCustomer.id, staffId: staffA.id }, // must survive
    ]);
    await RecentlyViewed.bulkCreate([
        { userId: customer.id, salonId: salonA.id, viewedAt: new Date() },
        { userId: customer.id, salonId: salonB.id, viewedAt: new Date() },
        { userId: otherCustomer.id, salonId: salonA.id, viewedAt: new Date() }, // must survive
    ]);
    await RecurringSeries.bulkCreate([
        {
            userId: customer.id, salonId: salonA.id, serviceId: serviceA.id, staffId: staffA.id,
            startDate: FUTURE_DATE, time: '09:00', frequency: 'weekly', occurrences: 8,
            occurrencesCreated: 0, status: 'active',
        },
        {
            userId: otherCustomer.id, salonId: salonA.id, serviceId: serviceA.id, staffId: staffA.id,
            startDate: FUTURE_DATE, time: '10:00', frequency: 'weekly', occurrences: 8,
            occurrencesCreated: 0, status: 'active',
        }, // must survive, still active
    ]);

    await Waitlist.bulkCreate([
        { salonId: salonA.id, userId: customer.id, date: FUTURE_DATE, status: 'waiting' },
        { salonId: salonB.id, userId: customer.id, date: FUTURE_DATE, status: 'notified', notifiedAt: new Date() },
        { salonId: salonA.id, userId: otherCustomer.id, date: FUTURE_DATE, status: 'waiting' }, // must survive
    ]);

    await Notification.bulkCreate([
        { recipientRole: 'customer', recipientId: customer.id, type: 'booking.confirmed', title: 'Booking confirmed' },
        { recipientRole: 'customer', recipientId: customer.id, type: 'loyalty.earned', title: 'You earned points', readAt: new Date() },
        { recipientRole: 'salon', recipientId: salonA.id, type: 'booking.new', title: 'New booking' },   // belongs to the salon
        { recipientRole: 'customer', recipientId: otherCustomer.id, type: 'booking.new', title: 'Other' }, // belongs to Olga
    ]);
});

after(async () => { await sequelize.close(); });

// ── Schema & route wiring ─────────────────────────────────────────────────

test('schema: missing/empty password 400s at the middleware before any DB work', () => {
    // The validate middleware signals failure via next(err) — assert on the
    // forwarded error's status, per the house direct-middleware style.
    for (const body of [{}, { password: '' }]) {
        let err = null;
        let ok = false;
        validate(accountDeletionSchema)({ body }, mockRes(), (e) => { if (e) err = e; else ok = true; });
        assert.equal(ok, false, 'empty/missing password must not pass');
        assert.equal(err && err.status, 400);
    }
    // A non-empty password passes through to the controller.
    let okNext = false;
    validate(accountDeletionSchema)({ body: { password: 'x' } }, mockRes(), () => { okNext = true; });
    assert.equal(okNext, true);
});

test('routes: DELETE /me sits behind strictLimiter -> auth -> roleGuard(customer) -> validate -> controller', () => {
    const layer = userRoutes.stack.find((l) => l.route && l.route.path === '/me');
    assert.ok(layer, '/me route should be registered');
    assert.equal(Object.keys(layer.route.methods)[0], 'delete', 'must be a DELETE route');
    const handlers = layer.route.stack.map((s) => s.handle);
    assert.equal(handlers.length, 5, 'exactly five handlers');
    assert.equal(handlers[0], strictLimiter, 'must reuse THE shared strict limiter instance');
    assert.equal(handlers[1].name, 'isAuth', 'must sit behind authMiddleware');
    assert.equal(handlers[2].name, 'roleGuard', 'must sit behind requireRole(customer)');
    // handlers[3] is validate(accountDeletionSchema) — an anonymous arrow per
    // the validators helper, so identity of shape (function, not controller).
    assert.equal(typeof handlers[3], 'function', 'body password must be schema-checked');
    assert.match(handlers[4].name, /^delete/, 'terminal handler must be its controller');
});

test('guard: requireRole(customer) rejects salon/staff/admin tokens at role level', () => {
    const guard = authMiddleware.requireRole('customer');
    for (const role of ['salon', 'staff', 'admin']) {
        const res = mockRes();
        let nextCalled = false;
        guard({ user: { role, salonId: 1, staffId: 1 } }, res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 403, `${role} token must be rejected`);
        assert.equal(res.body.error, 'Forbidden');
        assert.equal(nextCalled, false);
    }
    const allowed = mockRes();
    guard({ user: { role: 'customer', userId: 1 } }, allowed, () => { });
    assert.equal(allowed.statusCode, 200, 'guard itself must not answer customers');
});

// ── Wrong password ────────────────────────────────────────────────────────

test('wrong password: 401 and NOTHING is touched — no cancels, no scrub, no audit', async () => {
    const res = mockRes();
    await deleteMyAccount(reqWith({ body: { password: 'totallyWrong9' } }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'Incorrect password');

    await customer.reload();
    assert.equal(customer.email, 'jane@t.com', 'email must stay original');
    assert.equal(customer.name, 'Jane Doe');
    assert.equal(customer.loyaltyPoints, 50);
    assert.equal(customer.referralCode, 'JANECODE1');

    // Future booking still standing, favorites intact, zero audit rows written.
    const stillPending = await Appointment.findByPk(apptFuturePending.id);
    assert.equal(stillPending.status, 'pending');
    assert.equal(await Favorite.count({ where: { userId: customer.id } }), 2);
    assert.equal(await AdminAudit.count(), 0);
});

// ── Happy path ────────────────────────────────────────────────────────────

test('happy path: 200 generic confirmation and the row is fully anonymized', async () => {
    const storedBefore = customer.password;
    const res = mockRes();
    await deleteMyAccount(reqWith(), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.body), ['message'], 'generic confirmation carries no internals');
    assert.equal(res.body.message, 'Your account has been deleted.');

    await customer.reload();
    // Identity scrubbed in place.
    assert.equal(customer.email, `deleted+${customer.id}@anonymized.local`);
    assert.equal(customer.name, 'Deleted');
    assert.equal(customer.phoneNumber, '', 'NOT NULL phone column scrubbed to empty string');

    // Password replaced with an unusable hash of a discarded random value.
    assert.notEqual(customer.password, storedBefore);
    assert.equal(await bcrypt.compare(PASSWORD, customer.password), false, 'old password must stop verifying');

    // Tokens cleared, flags reset, ledger zeroed, unique code freed.
    assert.equal(customer.emailVerified, false);
    assert.equal(customer.verificationTokenHash, null);
    assert.equal(customer.verificationExpiresAt, null);
    assert.equal(customer.resetTokenHash, null);
    assert.equal(customer.resetTokenExpiresAt, null);
    assert.equal(Number(customer.loyaltyPoints), 0);
    assert.equal(customer.referralCode, null);
    assert.equal(customer.referredByUserId, 99, 'referrer link is history, not identity — kept');
});

test('future pending/confirmed bookings are bulk-cancelled; history rows are untouched', async () => {
    const fPending = await Appointment.findByPk(apptFuturePending.id);
    const fConfirmed = await Appointment.findByPk(apptFutureConfirmed.id);
    const pCompleted = await Appointment.findByPk(apptPastCompleted.id);
    const pCancelled = await Appointment.findByPk(apptPastCancelled.id);
    const fDeclined = await Appointment.findByPk(apptFutureDeclined.id);
    const other = await Appointment.findByPk(apptOtherFuture.id);

    assert.equal(fPending.status, 'cancelled');
    assert.equal(fConfirmed.status, 'cancelled');
    // Terminal / past rows keep their exact state (salon-side history integrity).
    assert.equal(pCompleted.status, 'completed');
    assert.equal(pCancelled.status, 'cancelled');
    assert.equal(fDeclined.status, 'declined');
    // Strictly scoped to the deleting user.
    assert.equal(other.status, 'confirmed', 'another customer\'s future booking must survive');
});

test('favorites are destroyed for the deleting user only', async () => {
    assert.equal(await Favorite.count({ where: { userId: customer.id } }), 0);
    assert.equal(await Favorite.count({ where: { userId: otherCustomer.id } }), 1);
});

test('favorite staff are destroyed for the deleting user only', async () => {
    assert.equal(await FavoriteStaff.count({ where: { userId: customer.id } }), 0);
    assert.equal(await FavoriteStaff.count({ where: { userId: otherCustomer.id } }), 1);
});

test('recently-viewed history is destroyed — no FK cascade covers it', async () => {
    assert.equal(await RecentlyViewed.count({ where: { userId: customer.id } }), 0);
    assert.equal(await RecentlyViewed.count({ where: { userId: otherCustomer.id } }), 1);
});

test('active recurring series are cancelled so the sweep stops booking for a deleted account', async () => {
    const mine = await RecurringSeries.findAll({ where: { userId: customer.id } });
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, 'cancelled', 'a live series would keep materializing bookings forever');
    const others = await RecurringSeries.findOne({ where: { userId: otherCustomer.id } });
    assert.equal(others.status, 'active');
});

test('waitlist entries are flipped to left (rows kept, per lifecycle)', async () => {
    const mine = await Waitlist.findAll({ where: { userId: customer.id } });
    assert.equal(mine.length, 2);
    assert.ok(mine.every((w) => w.status === 'left'), 'both waiting AND notified entries go left');
    const others = await Waitlist.findOne({ where: { userId: otherCustomer.id } });
    assert.equal(others.status, 'waiting');
});

test('notifications are destroyed for the customer identity; salons/others keep theirs', async () => {
    assert.equal(await Notification.count({ where: { recipientRole: 'customer', recipientId: customer.id } }), 0);
    assert.equal(await Notification.count({ where: { recipientRole: 'salon', recipientId: salonA.id } }), 1);
    assert.equal(await Notification.count({ where: { recipientRole: 'customer', recipientId: otherCustomer.id } }), 1);
});

test('an audit row is recorded asynchronously with action account.self_delete', async () => {
    const row = await waitFor(() => AdminAudit.findOne({
        where: { action: 'account.self_delete', targetId: String(customer.id) },
    }));
    assert.ok(row, 'audit row should appear shortly after deletion');
    assert.equal(row.targetType, 'user');
    assert.equal(row.adminEmail, 'self-service');
    // GDPR point of the exercise: NO personal data may land in the log.
    assert.equal(row.details.includes('jane@t.com'), false);
    assert.equal(row.details.includes('Jane'), false);
});

// ── Aftermath ─────────────────────────────────────────────────────────────

test('post-deletion logins fail naturally — old email unknown, anonymized email unusable', async () => {
    // Both branches answer identically (401 "Invalid credentials") — a
    // 404/401 split was an account-existence oracle.
    const oldEmail = mockRes();
    await handleUserLogin({ body: { email: 'jane@t.com', password: PASSWORD } }, oldEmail);
    assert.equal(oldEmail.statusCode, 401, 'old email: no existence signal');
    assert.equal(oldEmail.body.error, 'Invalid credentials');

    const anonEmail = mockRes();
    await handleUserLogin({ body: { email: `deleted+${customer.id}@anonymized.local`, password: PASSWORD } }, anonEmail);
    assert.equal(anonEmail.statusCode, 401);
    assert.equal(anonEmail.body.error, 'Invalid credentials');
});

test('idempotency: a second call answers the identical 200 and does zero new work', async () => {
    const res = mockRes();
    await deleteMyAccount(reqWith(), res); // even with the (now dead) password
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'Your account has been deleted.');

    await customer.reload();
    assert.equal(customer.email, `deleted+${customer.id}@anonymized.local`);

    // Exactly ONE audit row for this target — the early return wrote none.
    const audits = await AdminAudit.findAll({
        where: { action: 'account.self_delete', targetId: String(customer.id) },
    });
    assert.equal(audits.length, 1);
});
