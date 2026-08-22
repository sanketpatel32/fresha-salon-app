const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Appointment = require('../models/appointmentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Payment = require('../models/paymentModel');
const AdminAudit = require('../models/adminAuditModel');
const authMiddleware = require('../middlewares/authMiddleware');
const adminRoutes = require('../routes/adminRoutes');
const {
    getPlatformStats,
    getAuditLog,
    deleteUser,
    deleteAppointment,
} = require('../controllers/adminController');
const { recordAudit } = require('../services/adminAuditService');

// Minimal req/res stubs for invoking the controller directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

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

// Expected aggregates (assertions below depend on these fixture sizes).
// Users: 2 created now + 1 backdated beyond the 7-day window.
const EXPECT = {
    totalSalons: 2,
    totalCustomers: 3,
    totalStaff: 3,
    statuses: { pending: 1, confirmed: 3, cancelled: 1, completed: 1, declined: 1, 'no-show': 1 },
    // Only paymentStatus='Success' counts: 100.50 + 49.50 (Pending + Slot taken excluded).
    revenueTotal: 150,
    newCustomers7d: 2,
};

let customerA, customerB, oldCustomer, salonA, salonB, staffA, staffB, staffC, serviceA, serviceB;
let apptToDelete;

before(async () => {
    await sequelize.sync({ force: true });

    const now = Date.now();
    const tenDaysAgo = new Date(now - 10 * 24 * 3600 * 1000);
    customerA = await User.create({ name: 'CustA', email: 'ca@t.com', password: 'x', phoneNumber: '1', createdAt: new Date(now) });
    customerB = await User.create({ name: 'CustB', email: 'cb@t.com', password: 'x', phoneNumber: '2', createdAt: new Date(now) });
    oldCustomer = await User.create({ name: 'OldCust', email: 'old@t.com', password: 'x', phoneNumber: '9', createdAt: tenDaysAgo });

    salonA = await Salons.create({ name: 'SalonA', email: 'sa@t.com', password: 'x', phoneNumber: '3', address: 'a', pricing: 'Moderate' });
    salonB = await Salons.create({ name: 'SalonB', email: 'sb@t.com', password: 'x', phoneNumber: '4', address: 'b', pricing: 'Premium' });

    staffA = await Staff.create({ name: 'StylistA', email: 'sta@t.com', password: 'x', phoneNumber: '5', salonId: salonA.id });
    staffB = await Staff.create({ name: 'StylistB', email: 'stb@t.com', password: 'x', phoneNumber: '6', salonId: salonA.id });
    staffC = await Staff.create({ name: 'StylistC', email: 'stc@t.com', password: 'x', phoneNumber: '7', salonId: salonB.id });

    serviceA = await Services.create({ name: 'CutA', price: 100, duration: 30, salonId: salonA.id });
    serviceB = await Services.create({ name: 'CutB', price: 200, duration: 30, salonId: salonB.id });

    // One appointment per non-confirmed status + three confirmed.
    const baseAppt = { userId: customerA.id, date: '2030-01-01', endTime: '10:00' };
    apptToDelete = await Appointment.create({ ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, time: '09:00', status: 'pending' });
    await Appointment.bulkCreate([
        { ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, time: '10:00', status: 'confirmed' },
        { ...baseAppt, staffId: staffB.id, salonId: salonA.id, serviceId: serviceA.id, time: '11:00', status: 'confirmed' },
        { ...baseAppt, staffId: staffC.id, salonId: salonB.id, serviceId: serviceB.id, time: '12:00', status: 'confirmed' },
        { ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, time: '13:00', status: 'cancelled' },
        { ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, time: '14:00', status: 'completed' },
        { ...baseAppt, staffId: staffB.id, salonId: salonA.id, serviceId: serviceA.id, time: '15:00', status: 'declined' },
        { ...baseAppt, staffId: staffC.id, salonId: salonB.id, serviceId: serviceB.id, time: '16:00', status: 'no-show' },
    ]);

    // Revenue ledger: only the two 'Success' rows may sum into revenueTotal.
    const payBase = { customerID: customerA.id, dateSelected: '2030-01-01', timeSelected: '09:00', endTime: '10:00', staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id };
    await Payment.bulkCreate([
        { ...payBase, orderId: 'ord-success-1', paymentSessionId: 'ps1', orderAmount: 100.50, orderCurrency: 'INR', paymentStatus: 'Success' },
        { ...payBase, orderId: 'ord-success-2', paymentSessionId: 'ps2', orderAmount: 49.50, orderCurrency: 'INR', paymentStatus: 'Success' },
        { ...payBase, orderId: 'ord-pending', paymentSessionId: 'ps3', orderAmount: 500.00, orderCurrency: 'INR', paymentStatus: 'Pending' },
        { ...payBase, orderId: 'ord-slot', paymentSessionId: 'ps4', orderAmount: 75.00, orderCurrency: 'INR', paymentStatus: 'Slot taken' },
    ]);
});

after(async () => { await sequelize.close(); });

// ---------- GET /stats ----------

test('stats: totals, grouped appointment statuses, success-only revenue, 7d signups', async () => {
    const res = mockRes();
    await getPlatformStats({ query: {}, user: { role: 'admin' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.totalSalons, EXPECT.totalSalons);
    assert.equal(res.body.totalCustomers, EXPECT.totalCustomers);
    assert.equal(res.body.totalStaff, EXPECT.totalStaff);
    // Grouped in ONE query, every key always present even when zero.
    assert.deepEqual(res.body.appointmentsByStatus, EXPECT.statuses);
    // SUM(orderAmount) over paymentStatus='Success' ONLY.
    assert.equal(res.body.revenueTotal, EXPECT.revenueTotal);
    // Backdated user excluded from the trailing-7-day window.
    assert.deepEqual(res.body.last7Days, { newCustomers: EXPECT.newCustomers7d });
});

test('stats: serverTimestamp is a fresh ISO timestamp', async () => {
    const res = mockRes();
    await getPlatformStats({ query: {}, user: { role: 'admin' } }, res);
    const ts = Date.parse(res.body.serverTimestamp);
    assert.ok(!Number.isNaN(ts), 'serverTimestamp should be ISO-parseable');
    assert.ok(Math.abs(Date.now() - ts) < 60000, 'serverTimestamp should be close to now');
});

// ---------- Route guard ----------

test('guard: requireRole(admin) 403s a customer and never calls next', () => {
    const guard = authMiddleware.requireRole('admin');
    const res = mockRes();
    let nextCalled = false;
    guard({ user: { role: 'customer' } }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Forbidden');
    assert.equal(nextCalled, false);
});

test('guard: requireRole(admin) passes admins through to the controller', () => {
    const guard = authMiddleware.requireRole('admin');
    const res = mockRes();
    let nextCalled = false;
    guard({ user: { role: 'admin' } }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
});

test('routes: /stats and /audit are wired as auth -> roleGuard -> controller', () => {
    for (const path of ['/stats', '/audit']) {
        const layer = adminRoutes.stack.find((l) => l.route && l.route.path === path);
        assert.ok(layer, `${path} route should be registered`);
        const handlers = layer.route.stack.map((s) => s.handle);
        assert.equal(handlers.length, 3, `${path} should chain exactly three handlers`);
        assert.equal(handlers[0].name, 'isAuth', `${path} must sit behind authMiddleware`);
        assert.equal(handlers[1].name, 'roleGuard', `${path} must sit behind requireRole('admin')`);
        assert.match(handlers[2].name, /^get(P|A)/, `${path} terminal handler must be its controller`);
    }
});

// ---------- Audit writes from the delete handlers ----------

test('delete-user writes an audit row with action, target and identity details', async () => {
    const res = mockRes();
    await deleteUser(
        { params: { id: customerB.id }, user: { admin: 'root@salon.test', role: 'admin' } },
        res
    );
    assert.equal(res.statusCode, 200);

    const row = await waitFor(() => AdminAudit.findOne({
        where: { action: 'user.delete', targetId: String(customerB.id) },
    }));
    assert.ok(row, 'audit row should appear shortly after deletion');
    assert.equal(row.adminEmail, 'root@salon.test');
    assert.equal(row.targetType, 'user');
    assert.ok(row.details.includes(customerB.name), 'details should carry the deleted name');
    assert.ok(row.details.includes(customerB.email), 'details should carry the deleted email');
    assert.ok(row.createdAt instanceof Date || !!row.createdAt, 'row should carry createdAt');
});

test('delete-appointment writes an audit row including customer and salon names', async () => {
    const res = mockRes();
    await deleteAppointment(
        { params: { id: apptToDelete.id }, user: { admin: 'root@salon.test', role: 'admin' } },
        res
    );
    assert.equal(res.statusCode, 200);

    const row = await waitFor(() => AdminAudit.findOne({
        where: { action: 'appointment.delete', targetId: String(apptToDelete.id) },
    }));
    assert.ok(row, 'audit row should appear shortly after deletion');
    assert.equal(row.targetType, 'appointment');
    assert.equal(row.adminEmail, 'root@salon.test');
    assert.ok(row.details.includes('ca@t.com'), 'details should carry the booking customer email');
    assert.ok(row.details.includes('SalonA'), 'details should carry the salon name');
});

// ---------- recordAudit hardening units ----------

test('recordAudit truncates oversized fields instead of rejecting the insert', async () => {
    const row = await recordAudit({
        adminEmail: 'root@salon.test',
        action: 'x'.repeat(100),
        targetType: 'y'.repeat(50),
        targetId: 'z'.repeat(100),
        details: 'd'.repeat(400),
    });
    assert.ok(row, 'oversized payload must still persist');
    assert.equal(row.action.length, 64);
    assert.equal(row.targetType.length, 32);
    assert.equal(row.targetId.length, 64);
    assert.equal(row.details.length, 255);
});

// ---------- GET /audit listing ----------

test('audit listing: no params -> legacy bare array, newest-first across actions', async () => {
    // Deterministic seeds interleaved around the handler-written rows above.
    const t = (minsAgo) => new Date(Date.now() - minsAgo * 60000);
    await AdminAudit.create({ adminEmail: 'seed@x', action: 'user.delete', targetType: 'user', targetId: '9001', details: null, createdAt: t(30) });
    await AdminAudit.create({ adminEmail: 'seed@x', action: 'promo.update', targetType: 'promo', targetId: 'p1', details: 'cap raised', createdAt: t(20) });
    await AdminAudit.create({ adminEmail: 'other@x', action: 'appointment.delete', targetType: 'appointment', targetId: '9002', details: null, createdAt: t(10) });

    const res = mockRes();
    await getAuditLog({ query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body), 'no pagination params must keep the legacy array shape');

    const stamps = res.body.map((r) => new Date(r.createdAt).getTime());
    const sortedDesc = [...stamps].sort((a, b) => b - a);
    assert.deepEqual(stamps, sortedDesc, 'rows must be newest-first');

    const actions = new Set(res.body.map((r) => r.action));
    assert.ok(actions.has('user.delete'), 'platform-wide listing spans all admins/actions');
    assert.ok(actions.has('appointment.delete'));
    assert.ok(actions.has('promo.update'));
});

test('audit listing: params -> envelope with correct meta math', async () => {
    const res = mockRes();
    await getAuditLog({ query: { page: '1', limit: '2' } }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(!Array.isArray(res.body));
    assert.equal(res.body.data.length, 2);
    const total = await AdminAudit.count();
    assert.equal(res.body.total, total);
    assert.equal(res.body.totalPages, Math.ceil(total / 2));
    // Page 1 must hold the two newest rows overall.
    const topTwo = (await getAuditLog({ query: {} }, mockRes())).body
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 2).map((r) => r.id);
    assert.deepEqual(res.body.data.map((r) => r.id), topTwo);
});
