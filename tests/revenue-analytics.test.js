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
const authMiddleware = require('../middlewares/authMiddleware');
const salonAnalyticsRoutes = require('../routes/salonAnalyticsRoutes');
const {
    getRevenueAnalytics,
    getTopServices,
    revenueWindow,
    buildRevenueSeries,
} = require('../controllers/salonAnalyticsController');
const { validate, analyticsWindowSchema } = require('../utils/validators');

// Minimal req/res stubs for invoking middleware/controllers directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};
// Run a query-schema middleware against req, capturing next(err).
const runValidate = (mw, query) => {
    const req = { query };
    const res = mockRes();
    let passed = false;
    let err = null;
    mw(req, res, (e) => { if (e) err = e; else passed = true; });
    return { req, res, passed, err };
};

// Local-frame date helpers (mirror the controller's localDateString frame).
const pad = (n) => String(n).padStart(2, '0');
const dstr = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// A Date offsetDays ago at a fixed local wall-clock time (noon-ish hours keep
// fixtures away from midnight edges).
const at = (offsetDays, h, m) => {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    d.setHours(h, m, 0, 0);
    return d;
};

let salonA, salonB, customerA, staffA, staffB, svcCut, svcColor, svcMassage, svcFacial;

before(async () => {
    await sequelize.sync({ force: true });

    salonA = await Salons.create({ name: 'RevSalonA', email: 'ra@t.com', password: 'x', phoneNumber: '1', address: 'a', pricing: 'Moderate' });
    salonB = await Salons.create({ name: 'RevSalonB', email: 'rb@t.com', password: 'x', phoneNumber: '2', address: 'b', pricing: 'Premium' });
    customerA = await User.create({ name: 'RevCust', email: 'rc@t.com', password: 'x', phoneNumber: '3' });
    staffA = await Staff.create({ name: 'StylistRA', email: 'sra@t.com', password: 'x', phoneNumber: '4', salonId: salonA.id });
    staffB = await Staff.create({ name: 'StylistRB', email: 'srb@t.com', password: 'x', phoneNumber: '5', salonId: salonB.id });

    svcCut = await Services.create({ name: 'Cut', price: 100, duration: 30, salonId: salonA.id });
    svcColor = await Services.create({ name: 'Color', price: 150, duration: 60, salonId: salonA.id });
    svcMassage = await Services.create({ name: 'Massage', price: 200, duration: 45, salonId: salonA.id });
    svcFacial = await Services.create({ name: 'Facial', price: 80, duration: 30, salonId: salonA.id });

    // ── Payment ledger for SalonA ──
    // Today: one promo+tipped success (orderAmount carries discounted charge
    // PLUS tip per #26 math: max(0, 120.50-20) + 5.25 = 105.75) ...
    await Payment.create({
        orderId: 'rev-promo-tip', paymentSessionId: 'ps-pt', orderAmount: 105.75,
        orderCurrency: 'INR', paymentStatus: 'Success', customerID: customerA.id,
        dateSelected: dstr(0), timeSelected: '10:00', endTime: '11:00',
        staffId: staffA.id, salonId: salonA.id, serviceId: svcCut.id,
        originalAmount: 120.50, discountAmount: 20.00, promoCodeApplied: 'SAVE20',
        tipAmount: 5.25, tipCaptured: 1, createdAt: at(0, 10, 15),
    });
    // ... and one plain success (no tip, no discount — legacy-shaped nulls).
    await Payment.create({
        orderId: 'rev-plain', paymentSessionId: 'ps-pl', orderAmount: 49.50,
        orderCurrency: 'INR', paymentStatus: 'Success', customerID: customerA.id,
        dateSelected: dstr(0), timeSelected: '12:00', endTime: '13:00',
        staffId: staffA.id, salonId: salonA.id, serviceId: svcCut.id,
        createdAt: at(0, 12, 45),
    });
    // Yesterday: tipped success whose tip was NEVER captured (tipCaptured=0 —
    // e.g. slot-taken replay): tip rides in orderAmount/revenue but must NOT
    // count toward the tips total.
    await Payment.create({
        orderId: 'rev-uncaptured', paymentSessionId: 'ps-un', orderAmount: 65.00,
        orderCurrency: 'INR', paymentStatus: 'Success', customerID: customerA.id,
        dateSelected: dstr(1), timeSelected: '14:00', endTime: '15:00',
        staffId: staffA.id, salonId: salonA.id, serviceId: svcColor.id,
        tipAmount: 15.00, tipCaptured: 0, createdAt: at(1, 11, 30),
    });
    // Non-Success rows are invisible to every metric.
    await Payment.bulkCreate([
        { orderId: 'rev-pending', paymentSessionId: 'ps-pe', orderAmount: 500.00, orderCurrency: 'INR', paymentStatus: 'Pending', customerID: customerA.id, dateSelected: dstr(0), timeSelected: '16:00', endTime: '17:00', staffId: staffA.id, salonId: salonA.id, serviceId: svcCut.id, createdAt: at(0, 16, 0) },
        { orderId: 'rev-slot', paymentSessionId: 'ps-sl', orderAmount: 75.00, orderCurrency: 'INR', paymentStatus: 'Slot taken', customerID: customerA.id, dateSelected: dstr(0), timeSelected: '17:00', endTime: '18:00', staffId: staffA.id, salonId: salonA.id, serviceId: svcCut.id, createdAt: at(0, 17, 0) },
    ]);
    // 40 days ago: inside the 90-day max window, outside the 30-day default.
    await Payment.create({
        orderId: 'rev-old', paymentSessionId: 'ps-old', orderAmount: 200.00,
        orderCurrency: 'INR', paymentStatus: 'Success', customerID: customerA.id,
        dateSelected: dstr(40), timeSelected: '10:00', endTime: '11:00',
        staffId: staffA.id, salonId: salonA.id, serviceId: svcCut.id,
        createdAt: at(40, 10, 0),
    });
    // 100 days ago: outside even the 90-day max window.
    await Payment.create({
        orderId: 'rev-ancient', paymentSessionId: 'ps-an', orderAmount: 900.00,
        orderCurrency: 'INR', paymentStatus: 'Success', customerID: customerA.id,
        dateSelected: dstr(100), timeSelected: '10:00', endTime: '11:00',
        staffId: staffA.id, salonId: salonA.id, serviceId: svcCut.id,
        createdAt: at(100, 10, 0),
    });
    // Foreign salon's success payment TODAY — must never leak into SalonA.
    await Payment.create({
        orderId: 'rev-foreign', paymentSessionId: 'ps-fo', orderAmount: 999.99,
        orderCurrency: 'INR', paymentStatus: 'Success', customerID: customerA.id,
        dateSelected: dstr(0), timeSelected: '10:00', endTime: '11:00',
        staffId: staffB.id, salonId: salonB.id, serviceId: svcCut.id, // svcCut belongs to A; id collision proves scope comes from salonId alone
        createdAt: at(0, 10, 30),
    });

    // ── Completed appointments driving top-services ──
    const baseAppt = { userId: customerA.id, endTime: '11:00' };
    await Appointment.bulkCreate([
        // Massage: 5 completed in-window (clear leader).
        ...[0, 1, 2, 3, 4].map((i) => ({ ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: svcMassage.id, date: dstr(i), time: `0${i}:00`, status: 'completed' })),
        // Color: 2 completed in-window.
        { ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: svcColor.id, date: dstr(3), time: '10:00', status: 'completed' },
        { ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: svcColor.id, date: dstr(4), time: '11:00', status: 'completed' },
        // Cut: 1 completed TODAY + 1 completed EXACTLY at the 30-day window's
        // first day (boundary inclusion check).
        { ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: svcCut.id, date: dstr(0), time: '09:00', status: 'completed' },
        { ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: svcCut.id, date: dstr(29), time: '09:30', status: 'completed' },
        // Cut non-completed rows in-window — pending/confirmed/cancelled must
        // NOT count (completed-only rule).
        { ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: svcCut.id, date: dstr(1), time: '12:00', status: 'pending' },
        { ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: svcCut.id, date: dstr(1), time: '13:00', status: 'confirmed' },
        { ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: svcCut.id, date: dstr(1), time: '14:00', status: 'cancelled' },
        // Facial: completed but 40 days back — outside the 30-day window.
        { ...baseAppt, staffId: staffA.id, salonId: salonA.id, serviceId: svcFacial.id, date: dstr(40), time: '10:00', status: 'completed' },
        // Foreign salon: 9 completions today — scope must exclude ALL of them.
        ...Array.from({ length: 9 }, (_, i) => ({ ...baseAppt, staffId: staffB.id, salonId: salonB.id, serviceId: svcFacial.id, date: dstr(0), time: `1${i}:00`, status: 'completed' })),
    ]);
});

after(async () => { await sequelize.close(); });

// ---------- days schema ----------

test('schema: omitted days defaults to 30', () => {
    const { req, passed } = runValidate(validate(analyticsWindowSchema, 'query'), {});
    assert.equal(passed, true);
    assert.equal(req.query.days, 30);
});

test('schema: out-of-range integers CLAMP into 1..90, valid values pass through', () => {
    for (const [raw, expected] of [['0', 1], ['-5', 1], ['500', 90], ['91', 90], ['45', 45], ['1', 1], ['90', 90]]) {
        const { req, passed } = runValidate(validate(analyticsWindowSchema, 'query'), { days: raw });
        assert.equal(passed, true, `days=${raw} should parse`);
        assert.equal(req.query.days, expected, `days=${raw} should clamp/keep to ${expected}`);
    }
});

test('schema: non-numeric garbage has no sane clamp and 400s', () => {
    // 'abc'/NaN and 2.5 fail the number/int check outright; note '' coerces
    // to 0 and clamps to 1 by design (documented clamp semantics).
    for (const raw of ['abc', 'NaN', '2.5']) {
        const { err, passed } = runValidate(validate(analyticsWindowSchema, 'query'), { days: raw });
        assert.equal(passed, false, `days=${JSON.stringify(raw)} must be rejected`);
        assert.equal(err.status, 400);
    }
});

// ---------- GET /analytics/revenue ----------

test('revenue: default 30-day window shape — dense series ending today, lean per-day payloads', async () => {
    const res = mockRes();
    await getRevenueAnalytics({ query: { days: 30 }, user: { role: 'salon', salonId: salonA.id } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['days', 'series', 'totals']);
    assert.equal(res.body.days, 30);
    assert.equal(res.body.series.length, 30);

    // Dense: every day present exactly once, oldest-first, ending today.
    const dates = res.body.series.map((s) => s.date);
    assert.equal(dates[dates.length - 1], dstr(0));
    assert.equal(new Set(dates).size, 30);
    assert.ok(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));

    // Lean per-day payload keys only.
    for (const s of res.body.series) {
        assert.deepEqual(Object.keys(s).sort(), ['bookings', 'date', 'discounts', 'revenue', 'tips']);
    }

    // A gap renders as an explicit all-zero day.
    const quietDay = res.body.series.find((s) => s.date === dstr(15));
    assert.deepEqual(quietDay, { date: dstr(15), revenue: 0, tips: 0, discounts: 0, bookings: 0 });
});

test('revenue: sums come from Success rows only — gross-of-tip revenue, captured-only tips', async () => {
    const res = mockRes();
    await getRevenueAnalytics({ query: { days: 30 }, user: { role: 'salon', salonId: salonA.id } }, res);
    const byDate = new Map(res.body.series.map((s) => [s.date, s]));

    // Today: 105.75 (discounted+tipped) + 49.50 plain = 155.25. Pending 500
    // and Slot taken 75 are excluded; foreign 999.99 is scoped out.
    const today = byDate.get(dstr(0));
    assert.equal(today.revenue, 155.25);
    assert.equal(today.tips, 5.25);
    assert.equal(today.discounts, 20.00);
    assert.equal(today.bookings, 2);

    // Yesterday: uncaptured tip rides in revenue but NOT in tips.
    const yesterday = byDate.get(dstr(1));
    assert.equal(yesterday.revenue, 65.00);
    assert.equal(yesterday.tips, 0);
    assert.equal(yesterday.discounts, 0);
    assert.equal(yesterday.bookings, 1);

    // Totals aggregate the series; serviceRevenue nets the captured tips out.
    assert.equal(res.body.totals.revenue, 155.25 + 65.00);
    assert.equal(res.body.totals.tips, 5.25);
    assert.equal(res.body.totals.discounts, 20.00);
    assert.equal(res.body.totals.bookings, 3);
    assert.equal(res.body.totals.serviceRevenue, 220.25 - 5.25);
});

test('revenue: days=90 widens the window; >90-day-old payments stay excluded', async () => {
    const res = mockRes();
    await getRevenueAnalytics({ query: { days: 90 }, user: { role: 'salon', salonId: salonA.id } }, res);
    assert.equal(res.body.series.length, 90);
    assert.equal(res.body.totals.revenue, 155.25 + 65.00 + 200.00); // + the 40-day-old row
    assert.equal(res.body.totals.bookings, 4);
    assert.equal(res.body.totals.serviceRevenue, 420.25 - 5.25);
});

test('revenue: scoping — a second salon sees only its own ledger', async () => {
    const res = mockRes();
    await getRevenueAnalytics({ query: { days: 30 }, user: { role: 'salon', salonId: salonB.id } }, res);
    assert.equal(res.body.totals.revenue, 999.99);
    assert.equal(res.body.totals.bookings, 1);
    assert.equal(res.body.totals.tips, 0);
});

test('revenue: full middleware→controller chain honors a clamped days value', async () => {
    const { req, passed } = runValidate(validate(analyticsWindowSchema, 'query'), { days: '500' });
    assert.equal(passed, true);
    assert.equal(req.query.days, 90); // clamped, not rejected
    req.user = { role: 'salon', salonId: salonA.id }; // what authMiddleware would attach
    const res = mockRes();
    await getRevenueAnalytics(req, res);
    assert.equal(res.body.days, 90);
    assert.equal(res.body.series.length, 90);
});

// ---------- pure bucketing helpers ----------

test('bucketing: month boundary splits correctly across local calendar days', () => {
    // Synthetic "now" so the test is independent of the real clock: window of
    // 3 days ending Sun 2026-08-02 spans the July/August boundary.
    const now = new Date(2026, 7, 2, 9, 30);
    const rows = [
        { createdAt: new Date(2026, 6, 31, 23, 59), orderAmount: '50.00', tipAmount: null, tipCaptured: 0, discountAmount: null },
        { createdAt: new Date(2026, 7, 1, 0, 1), orderAmount: '25.50', tipAmount: '2.00', tipCaptured: 1, discountAmount: null },
        { createdAt: new Date(2026, 7, 1, 18, 0), orderAmount: '10.00', tipAmount: null, tipCaptured: 0, discountAmount: '5.00' },
    ];
    const { series, totals } = buildRevenueSeries(rows, 3, now);
    assert.deepEqual(series.map((s) => s.date), ['2026-07-31', '2026-08-01', '2026-08-02']);
    assert.deepEqual(series.map((s) => s.revenue), [50.00, 35.50, 0]);
    assert.deepEqual(series.map((s) => s.tips), [0, 2.00, 0]);
    assert.deepEqual(series.map((s) => s.discounts), [0, 5.00, 0]);
    assert.deepEqual(series.map((s) => s.bookings), [1, 2, 0]);
    assert.equal(totals.bookings, 3);
    assert.equal(totals.serviceRevenue, 85.50 - 2.00);
});

test('window: trailing N days INCLUDING today, oldest-first', () => {
    const { dates, start, end } = revenueWindow(5, new Date(2026, 7, 24, 15, 0));
    assert.deepEqual(dates, ['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24']);
    assert.equal(start.getHours(), 0);
    assert.equal(end.getHours(), 23);
});

// ---------- GET /analytics/top-services ----------

test('top-services: completed-only, scoped, count desc with name-asc tiebreak', async () => {
    const res = mockRes();
    await getTopServices({ query: { days: 30 }, user: { role: 'salon', salonId: salonA.id } }, res);
    assert.equal(res.statusCode, 200);
    // Massage leads (5); Color and Cut tie at 2 → name asc puts Color first.
    // Facial's completion is out-of-window; the foreign salon's 9 completions
    // never appear; Cut's pending/confirmed/cancelled rows don't count;
    // the 29-days-ago Cut completion IS inside the window (boundary).
    assert.deepEqual(res.body, [
        { serviceId: svcMassage.id, name: 'Massage', bookings: 5 },
        { serviceId: svcColor.id, name: 'Color', bookings: 2 },
        { serviceId: svcCut.id, name: 'Cut', bookings: 2 },
    ]);
});

test('top-services: shorter window drops bookings outside it (boundary row excluded at days=7)', async () => {
    const res = mockRes();
    await getTopServices({ query: { days: 7 }, user: { role: 'salon', salonId: salonA.id } }, res);
    // All five Massage completions sit within the last week (unchanged); Cut
    // loses its dstr(29) completion to the narrower window.
    assert.deepEqual(res.body, [
        { serviceId: svcMassage.id, name: 'Massage', bookings: 5 },
        { serviceId: svcColor.id, name: 'Color', bookings: 2 },
        { serviceId: svcCut.id, name: 'Cut', bookings: 1 },
    ]);
});

test('top-services: scoping — salon B sees only its own nine completions', async () => {
    const res = mockRes();
    await getTopServices({ query: { days: 30 }, user: { role: 'salon', salonId: salonB.id } }, res);
    assert.deepEqual(res.body, [
        { serviceId: svcFacial.id, name: 'Facial', bookings: 9 },
    ]);
});

// ---------- auth guards & wiring ----------

test('guard: requireRole(salon) 403s customers and staff without calling next', () => {
    for (const role of ['customer', 'staff']) {
        const guard = authMiddleware.requireRole('salon');
        const res = mockRes();
        let nextCalled = false;
        guard({ user: { role } }, res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 403, `${role} must be rejected`);
        assert.equal(res.body.error, 'Forbidden');
        assert.equal(nextCalled, false);
    }
});

test('guard: requireRole(salon) passes salons through', () => {
    const guard = authMiddleware.requireRole('salon');
    let nextCalled = false;
    guard({ user: { role: 'salon' } }, mockRes(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
});

test('routes: analytics endpoints are wired auth -> roleGuard -> validate -> controller', () => {
    for (const path of ['/analytics/revenue', '/analytics/top-services']) {
        const layer = salonAnalyticsRoutes.stack.find((l) => l.route && l.route.path === path);
        assert.ok(layer, `${path} route should be registered`);
        const handlers = layer.route.stack.map((s) => s.handle);
        assert.equal(handlers.length, 4, `${path} should chain exactly four handlers`);
        assert.equal(handlers[0].name, 'isAuth', `${path} must sit behind authMiddleware`);
        assert.equal(handlers[1].name, 'roleGuard', `${path} must sit behind requireRole('salon')`);
        assert.equal(typeof handlers[2], 'function', `${path} must carry a query validator`);
        assert.match(handlers[3].name, /^get(RevenueAnalytics|TopServices)$/, `${path} terminal handler must be its controller`);
    }
});
