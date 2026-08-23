const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations');
const Salons = require('../models/salonsModel');
const User = require('../models/userModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Appointment = require('../models/appointmentModel');
const { getAllSalons } = require('../controllers/salonController');
const { updateCustomerReview } = require('../controllers/appointmentController');
const { validate, salonBrowseSchema } = require('../utils/validators');

const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// Insertion order is deliberately NOT alphabetical and NOT rating-ordered, so
// every sort/filter below has something real to reorder or exclude.
let customer, S;

before(async () => {
    await sequelize.sync({ force: true });
    customer = await User.create({ name: 'Cust', email: 'c@t.com', password: 'x', phoneNumber: '1' });

    const base = Date.now() - 100000;
    const stamp = (i) => new Date(base + i * 60000);
    const defs = [
        { name: 'Glow Studio', address: '12 Riverside Ave' },   // no ratings
        { name: 'Bravo Beauty', address: '7 Main Street' },     // avg 3.0, Nails service
        { name: 'Alpha Cuts', address: '3 Oak Road' },          // avg 4.5, Hair service
        { name: 'Charlie Charm', address: '9 Pine Lane' },      // no ratings
        { name: 'Delta Diva', address: '5 Elm Square' },        // no ratings
    ];
    // Stagger createdAt so sort=newest is deterministic (newest = last created).
    S = [];
    for (let i = 0; i < defs.length; i++) {
        S.push(await Salons.create({
            ...defs[i], email: `s${i}@t.com`, password: 'x',
            phoneNumber: String(i + 10), pricing: 'Moderate', statusbar: 'active',
            createdAt: stamp(i), updatedAt: stamp(i),
        }));
    }

    // Services drive the category filter (statusbar active like production).
    const staffOf = {};
    for (const s of S) {
        const st = await Staff.create({ name: `Sty ${s.id}`, email: `st${s.id}@t.com`, password: 'x', phoneNumber: String(s.id), salonId: s.id });
        staffOf[s.id] = st;
    }
    await Services.create({ name: 'Cut', price: 100, duration: 30, category: 'Hair', statusbar: 'active', salonId: S[2].id });
    await Services.create({ name: 'Manicure', price: 60, duration: 45, category: 'Nails', statusbar: 'active', salonId: S[1].id });

    // Ratings written through the REAL review handler so the denormalized
    // avgRating cache (what minRating filters on) is populated exactly as in
    // production — no duplicated aggregation math in this file.
    const rate = async (salon, ratingValue) => {
        const appt = await Appointment.create({
            staffId: staffOf[salon.id].id, salonId: salon.id,
            serviceId: (await Services.findOne({ where: { salonId: salon.id } })).id,
            userId: customer.id, date: '2026-01-05', time: '10:00', endTime: '10:30', status: 'completed',
        });
        const res = mockRes();
        await updateCustomerReview(
            { params: { appointmentId: String(appt.id) }, body: { rating: ratingValue }, user: { userId: customer.id } },
            res
        );
        assert.equal(res.statusCode, 200);
    };
    await rate(S[2], 4);
    await rate(S[2], 5);   // Alpha Cuts avg = 4.5
    await rate(S[1], 3);   // Bravo Beauty avg = 3.0
});

after(async () => { await sequelize.close(); });

const idsOf = (body) => (Array.isArray(body) ? body : body.data).map((s) => s.id);
const namesOf = (body) => (Array.isArray(body) ? body : body.data).map((s) => s.name);

test('no params: legacy bare array, every active salon in insertion (id) order', async () => {
    const res = mockRes();
    await getAllSalons({ query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    assert.deepEqual(idsOf(res.body), S.map((s) => s.id));
});

test('search hits by name case-insensitively', async () => {
    const res = mockRes();
    await getAllSalons({ query: { search: 'GLOW' } }, res); // stored as "Glow Studio"
    assert.equal(res.statusCode, 200);
    assert.deepEqual(namesOf(res.body), ['Glow Studio']);
});

test('search hits by address case-insensitively', async () => {
    const res = mockRes();
    await getAllSalons({ query: { search: 'main street' } }, res); // stored as "7 Main Street"
    assert.equal(res.statusCode, 200);
    assert.deepEqual(namesOf(res.body), ['Bravo Beauty']);
});

test('search miss returns an empty envelope, not an error', async () => {
    const res = mockRes();
    await getAllSalons({ query: { search: 'zzznowhere' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { data: [], total: 0, page: 1, totalPages: 0 });
});

test('category filters to salons offering an active service in that category', async () => {
    const nails = mockRes();
    await getAllSalons({ query: { category: 'Nails' } }, nails);
    assert.equal(nails.statusCode, 200);
    assert.deepEqual(namesOf(nails.body), ['Bravo Beauty']);

    const hair = mockRes();
    await getAllSalons({ query: { category: 'Hair' } }, hair);
    assert.deepEqual(namesOf(hair.body), ['Alpha Cuts']);

    const none = mockRes();
    await getAllSalons({ query: { category: 'Bridal' } }, none);
    assert.equal(none.body.data.length, 0);
    assert.equal(none.body.total, 0);
});

test('minRating boundary: average equal to the threshold passes, below fails', async () => {
    const atBoundary = mockRes();
    await getAllSalons({ query: { minRating: 3 } }, atBoundary);
    // Bravo Beauty avg is exactly 3.0 -> included; unrated salons (NULL) never match.
    assert.deepEqual(namesOf(atBoundary.body).sort(), ['Alpha Cuts', 'Bravo Beauty']);

    const aboveTheirAvg = mockRes();
    await getAllSalons({ query: { minRating: 3.5 } }, aboveTheirAvg);
    // Only Alpha Cuts (4.5) survives; Bravo (3.0 < 3.5) drops out.
    assert.deepEqual(namesOf(aboveTheirAvg.body), ['Alpha Cuts']);
});

test('sort=name orders alphabetically regardless of insertion order', async () => {
    const res = mockRes();
    await getAllSalons({ query: { sort: 'name' } }, res);
    assert.deepEqual(namesOf(res.body),
        ['Alpha Cuts', 'Bravo Beauty', 'Charlie Charm', 'Delta Diva', 'Glow Studio']);
});

test('sort=rating orders by cached average desc, unrated last', async () => {
    const res = mockRes();
    await getAllSalons({ query: { sort: 'rating' } }, res);
    assert.deepEqual(namesOf(res.body),
        ['Alpha Cuts', 'Bravo Beauty', 'Glow Studio', 'Charlie Charm', 'Delta Diva']);
});

test('sort=newest orders by createdAt desc', async () => {
    const res = mockRes();
    await getAllSalons({ query: { sort: 'newest' } }, res);
    assert.deepEqual(idsOf(res.body), [...S.map((s) => s.id)].reverse());
});

test('combined search + sort still works (filter then reorder)', async () => {
    const res = mockRes();
    await getAllSalons({ query: { search: 'a', sort: 'name' } }, res);
    const names = namesOf(res.body);
    assert.ok(names.length >= 2);
    assert.deepEqual(names, [...names].sort());
});

test('invalid sort enum is rejected with 400 before reaching the DB', () => {
    let captured = null;
    validate(salonBrowseSchema, 'query')({ query: { sort: 'bogus' } }, {}, (e) => { captured = e; });
    assert.ok(captured, 'expected a validation error');
    assert.equal(captured.status, 400);
});

test('out-of-range minRating is rejected with 400; string values are coerced', () => {
    let tooHigh = null;
    validate(salonBrowseSchema, 'query')({ query: { minRating: '6' } }, {}, (e) => { tooHigh = e; });
    assert.ok(tooHigh && tooHigh.status === 400);

    let garbage = null;
    validate(salonBrowseSchema, 'query')({ query: { minRating: 'abc' } }, {}, (e) => { garbage = e; });
    assert.ok(garbage && garbage.status === 400);

    let passed = false;
    const req = { query: { minRating: '3' } };
    validate(salonBrowseSchema, 'query')(req, {}, () => { passed = true; });
    assert.ok(passed);
    assert.equal(req.query.minRating, 3); // coerced to a real number
});
