const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Appointment = require('../models/appointmentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const { paginateQuery, buildMeta, MAX_LIMIT } = require('../utils/pagination');
const {
    getAllAppointmentsByUserId,
    getScheduledAppointmentsBySalonId,
} = require('../controllers/appointmentController');
const { getAllAppointments } = require('../controllers/adminController');

// Minimal req/res stubs for invoking the controller directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// Seed sizes (assertions below depend on these).
const A_COUNT = 55;  // future appointments for customerA in salonA (> MAX_LIMIT so clamping is visible)
const B_COUNT = 3;   // future appointments for customerB in salonB
const PAST_A_COUNT = 1; // past booking for customerA in salonA (excluded from admin list only)
// Totals per scope.
const CUST_A_TOTAL = A_COUNT + PAST_A_COUNT;
const SALON_A_TOTAL = A_COUNT + PAST_A_COUNT;
const ADMIN_TOTAL = A_COUNT + B_COUNT; // admin lists upcoming only
const FUTURE_DAYS_AHEAD = 45;

let customerA, customerB, salonA, salonB, staffA, staffB, serviceA, serviceB;
let futureDate, pastDate;

before(async () => {
    await sequelize.sync({ force: true });
    customerA = await User.create({ name: 'CustA', email: 'ca@t.com', password: 'x', phoneNumber: '1' });
    customerB = await User.create({ name: 'CustB', email: 'cb@t.com', password: 'x', phoneNumber: '2' });
    salonA = await Salons.create({ name: 'SalonA', email: 'sa@t.com', password: 'x', phoneNumber: '3', address: 'a', pricing: 'Moderate' });
    salonB = await Salons.create({ name: 'SalonB', email: 'sb@t.com', password: 'x', phoneNumber: '4', address: 'b', pricing: 'Premium' });
    staffA = await Staff.create({ name: 'StylistA', email: 'sta@t.com', password: 'x', phoneNumber: '5', salonId: salonA.id });
    staffB = await Staff.create({ name: 'StylistB', email: 'stb@t.com', password: 'x', phoneNumber: '6', salonId: salonB.id });
    serviceA = await Services.create({ name: 'CutA', price: 100, duration: 30, salonId: salonA.id });
    serviceB = await Services.create({ name: 'CutB', price: 200, duration: 30, salonId: salonB.id });

    futureDate = new Date(Date.now() + FUTURE_DAYS_AHEAD * 24 * 3600 * 1000).toISOString().slice(0, 10);
    pastDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

    const rows = [];
    const time = (i) => `${String(6 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`;
    for (let i = 0; i < A_COUNT; i++) {
        rows.push({ staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id, date: futureDate, time: time(i), endTime: '23:59', status: 'confirmed' });
    }
    // One past booking — must be excluded from the admin "upcoming" list.
    rows.push({ staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id, date: pastDate, time: '12:00', endTime: '12:30', status: 'completed' });
    for (let i = 0; i < B_COUNT; i++) {
        rows.push({ staffId: staffB.id, salonId: salonB.id, serviceId: serviceB.id, userId: customerB.id, date: futureDate, time: time(i), endTime: '23:59', status: 'confirmed' });
    }
    await Appointment.bulkCreate(rows);
});

after(async () => { await sequelize.close(); });

// ---------- Helper unit tests ----------

test('helper: no params -> not requested, defaults page=1 limit=10 offset=0', () => {
    const p = paginateQuery({ query: {} });
    assert.equal(p.requested, false);
    assert.equal(p.page, 1);
    assert.equal(p.limit, 10);
    assert.equal(p.offset, 0);
});

test('helper: unrelated params only -> still legacy (not requested)', () => {
    // BookedAppointments.jsx sends ?userId=... — that must NOT opt into the envelope.
    const p = paginateQuery({ query: { userId: '7' } });
    assert.equal(p.requested, false);
});

test('helper: clamps limit>50 to 50 and page<1 to 1', () => {
    const big = paginateQuery({ query: { limit: String(MAX_LIMIT + 450) } });
    assert.equal(big.limit, 50);
    const lowPage = paginateQuery({ query: { page: '-5' } });
    assert.equal(lowPage.page, 1);
    assert.equal(paginateQuery({ query: { page: '0', limit: '20' } }).page, 1);
});

test('helper: garbage params fall back to defaults but opt into envelope', () => {
    const p = paginateQuery({ query: { page: 'abc', limit: 'xyz' } });
    assert.equal(p.requested, true);
    assert.equal(p.page, 1);
    assert.equal(p.limit, 10);
    assert.equal(p.offset, 0);
});

test('helper: computes offset for later pages', () => {
    const p = paginateQuery({ query: { page: '3', limit: '25' } });
    assert.equal(p.page, 3);
    assert.equal(p.limit, 25);
    assert.equal(p.offset, 50);
});

test('buildMeta returns page/limit/total/totalPages', () => {
    assert.deepEqual(buildMeta(2, 10, 25), { page: 2, limit: 10, total: 25, totalPages: 3 });
    assert.deepEqual(buildMeta(1, 10, 0), { page: 1, limit: 10, total: 0, totalPages: 0 });
});

// ---------- Customer listing (/api/appointment/getAll) ----------

test('customer listing: no params -> legacy bare array with all rows', async () => {
    const res = mockRes();
    await getAllAppointmentsByUserId({ query: {}, user: { userId: customerA.id } }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, CUST_A_TOTAL);
});

test('customer listing: unrelated param (userId) keeps legacy array shape', async () => {
    const res = mockRes();
    await getAllAppointmentsByUserId({ query: { userId: customerA.id }, user: { userId: customerA.id } }, res);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, CUST_A_TOTAL);
});

test('customer listing: page+limit -> paginated envelope with correct meta', async () => {
    const res = mockRes();
    await getAllAppointmentsByUserId({ query: { page: '2', limit: '20' }, user: { userId: customerA.id } }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(!Array.isArray(res.body));
    assert.equal(res.body.data.length, 20);
    assert.deepEqual(
        { page: res.body.page, limit: res.body.limit, total: res.body.total, totalPages: res.body.totalPages },
        { page: 2, limit: 20, total: CUST_A_TOTAL, totalPages: Math.ceil(CUST_A_TOTAL / 20) }
    );
    // Pages must not overlap.
    const first = mockRes();
    await getAllAppointmentsByUserId({ query: { page: '1', limit: '20' }, user: { userId: customerA.id } }, first);
    const ids1 = new Set(first.body.data.map(a => a.id));
    for (const row of res.body.data) assert.ok(!ids1.has(row.id));
});

test('customer listing: limit above max clamps to 50', async () => {
    const res = mockRes();
    await getAllAppointmentsByUserId({ query: { page: '1', limit: '9999' }, user: { userId: customerA.id } }, res);
    assert.equal(res.body.data.length, 50);
    assert.equal(res.body.limit, 50);
    assert.equal(res.body.total, CUST_A_TOTAL);
});

// ---------- Salon listing (/api/appointment/sceduledAppointments) ----------

test('salon listing: no params -> legacy bare array scoped to own salon', async () => {
    const res = mockRes();
    await getScheduledAppointmentsBySalonId({ query: {}, user: { salonId: salonA.id } }, res);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, SALON_A_TOTAL); // includes the past booking; only the admin list filters by date
    const other = mockRes();
    await getScheduledAppointmentsBySalonId({ query: {}, user: { salonId: salonB.id } }, other);
    assert.equal(other.body.length, B_COUNT);
});

test('salon listing: params -> envelope scoped to own salon', async () => {
    const res = mockRes();
    await getScheduledAppointmentsBySalonId({ query: { page: '1', limit: '2' }, user: { salonId: salonB.id } }, res);
    assert.equal(res.body.data.length, 2);
    assert.deepEqual(
        { page: res.body.page, limit: res.body.limit, total: res.body.total, totalPages: res.body.totalPages },
        { page: 1, limit: 2, total: B_COUNT, totalPages: Math.ceil(B_COUNT / 2) }
    );
});

// ---------- Admin listing (/api/admin/appointments/getall) ----------

test('admin listing: no params -> legacy bare array of upcoming appointments only', async () => {
    const res = mockRes();
    await getAllAppointments({ query: {} }, res);
    assert.ok(Array.isArray(res.body));
    // Future bookings only; the single past booking is excluded.
    assert.equal(res.body.length, ADMIN_TOTAL);
});

test('admin listing: params -> paginated envelope over upcoming appointments', async () => {
    const res = mockRes();
    await getAllAppointments({ query: { page: '1', limit: '25' } }, res);
    assert.equal(res.body.data.length, 25);
    assert.deepEqual(
        { page: res.body.page, limit: res.body.limit, total: res.body.total, totalPages: res.body.totalPages },
        { page: 1, limit: 25, total: ADMIN_TOTAL, totalPages: Math.ceil(ADMIN_TOTAL / 25) }
    );
});

test('admin listing: garbage params still produce a default-envelope page', async () => {
    const res = mockRes();
    await getAllAppointments({ query: { page: 'oops', limit: 'nope' } }, res);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.limit, 10);
    assert.equal(res.body.data.length, 10);
});
