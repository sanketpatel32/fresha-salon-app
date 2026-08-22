const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Favorite = require('../models/favoriteModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const { getFavorites } = require('../controllers/favoriteController');
const { getAllSalons } = require('../controllers/salonController');

// Minimal req/res stubs for invoking the controllers directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// Seed sizes (assertions below depend on these).
const SALON_COUNT = 6;
const A_FAV_COUNT = 5; // customerA favorites S1..S5 (S6 left unfavorited)
// customerA's favorites, S1 oldest -> S5 newest (newest-first assertions rely on this).
let customerA, customerB, salons;

before(async () => {
    await sequelize.sync({ force: true });
    customerA = await User.create({ name: 'CustA', email: 'ca@t.com', password: 'x', phoneNumber: '1' });
    customerB = await User.create({ name: 'CustB', email: 'cb@t.com', password: 'x', phoneNumber: '2' });

    salons = [];
    for (let i = 1; i <= SALON_COUNT; i++) {
        salons.push(await Salons.create({
            name: `Salon${i}`, email: `s${i}@t.com`, password: 'x',
            phoneNumber: String(i), address: `addr${i}`, pricing: 'Moderate', statusbar: 'active',
        }));
    }

    // Stagger createdAt explicitly so newest-first ordering is deterministic.
    const base = Date.now() - 100000;
    const stamp = (i) => new Date(base + i * 1000);
    await Favorite.bulkCreate(
        Array.from({ length: A_FAV_COUNT }, (_, i) => ({
            userId: customerA.id, salonId: salons[i].id,
            createdAt: stamp(i), updatedAt: stamp(i),
        }))
    );
    // customerB favorited ONLY Salon1 — drives the true/false mix assertion.
    await Favorite.create({ userId: customerB.id, salonId: salons[0].id, createdAt: stamp(50), updatedAt: stamp(50) });
});

after(async () => { await sequelize.close(); });

// Browse rows are Sequelize instances; isFavorite lives in dataValues (like
// images/avgRating), so read flags through serialization exactly as an HTTP
// client would see them.
const asJson = (x) => JSON.parse(JSON.stringify(x));

// ---------- Favorites listing (/api/user/favorites) ----------

test('favorites: no params -> legacy bare array of salons, newest first', async () => {
    const res = mockRes();
    await getFavorites({ query: {}, user: { userId: customerA.id } }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, A_FAV_COUNT);
    assert.equal(res.body[0].id, salons[4].id); // most recently favorited first
    assert.equal(res.body[A_FAV_COUNT - 1].id, salons[0].id);
    // Items are salon objects (no favorite join noise).
    assert.equal(res.body[0].name, 'Salon5');
});

test('favorites: page+limit -> paginated envelope, newest first', async () => {
    const res = mockRes();
    await getFavorites({ query: { page: '1', limit: '2' }, user: { userId: customerA.id } }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(!Array.isArray(res.body));
    assert.deepEqual(res.body.data.map(s => s.id), [salons[4].id, salons[3].id]);
    assert.deepEqual(
        { page: res.body.page, limit: res.body.limit, total: res.body.total, totalPages: res.body.totalPages },
        { page: 1, limit: 2, total: A_FAV_COUNT, totalPages: 3 }
    );
});

test('favorites: pages do not overlap; last page carries the remainder', async () => {
    const p3 = mockRes();
    await getFavorites({ query: { page: '3', limit: '2' }, user: { userId: customerA.id } }, p3);
    assert.deepEqual(p3.body.data.map(s => s.id), [salons[0].id]);
});

test('favorites: page past the end -> empty data with intact meta', async () => {
    const res = mockRes();
    await getFavorites({ query: { page: '9', limit: '2' }, user: { userId: customerA.id } }, res);
    assert.deepEqual(res.body.data, []);
    assert.deepEqual(
        { page: res.body.page, limit: res.body.limit, total: res.body.total, totalPages: res.body.totalPages },
        { page: 9, limit: 2, total: A_FAV_COUNT, totalPages: 3 }
    );
});

test('favorites: scoping — another customer sees only their own favorites', async () => {
    const res = mockRes();
    await getFavorites({ query: { page: '1', limit: '10' }, user: { userId: customerB.id } }, res);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].id, salons[0].id);
});

// ---------- isFavorite in browse (/business/getall) ----------

test('browse: customer sees isFavorite mix across a page (1 of 2 favorited)', async () => {
    const res = mockRes();
    // Default order is insertion order, so page 1 @ limit 2 == Salon1, Salon2.
    await getAllSalons({ query: { page: '1', limit: '2' }, user: { role: 'customer', userId: customerB.id } }, res);
    assert.equal(res.statusCode, 200);
    const items = asJson(res.body.data);
    assert.deepEqual(items.map(s => s.id), [salons[0].id, salons[1].id]);
    assert.deepEqual(items.map(s => s.isFavorite), [true, false]);
});

test('browse: second page flags the rest of the customer\'s set correctly', async () => {
    const res = mockRes();
    await getAllSalons({ query: { page: '2', limit: '2' }, user: { role: 'customer', userId: customerB.id } }, res);
    assert.deepEqual(asJson(res.body.data).map(s => s.isFavorite), [false, false]);
});

test('browse: legacy (no params) response also carries isFavorite for customers', async () => {
    const res = mockRes();
    await getAllSalons({ query: {}, user: { role: 'customer', userId: customerA.id } }, res);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, SALON_COUNT);
    const items = asJson(res.body);
    const flagged = items.filter(s => s.isFavorite).map(s => s.id);
    assert.deepEqual(flagged, salons.slice(0, A_FAV_COUNT).map(s => s.id));
});

test('browse: anonymous request behaves like before (no crash, no isFavorite field)', async () => {
    const res = mockRes();
    await getAllSalons({ query: { page: '1', limit: '10' } }, res); // no req.user at all
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.total, SALON_COUNT);
    for (const s of asJson(res.body.data)) {
        assert.ok(!('isFavorite' in s), 'anonymous payloads must not expose isFavorite');
    }
});

test('browse: non-customer roles (e.g. salon owner) get no isFavorite field either', async () => {
    const res = mockRes();
    await getAllSalons({ query: { page: '1', limit: '10' }, user: { role: 'salon', salonId: salons[0].id } }, res);
    assert.equal(res.statusCode, 200);
    for (const s of asJson(res.body.data)) {
        assert.ok(!('isFavorite' in s), 'non-customer payloads must not expose isFavorite');
    }
});

test('browse: favorites batch-loaded in ONE query (no N+1)', async () => {
    // Count SQL statements touching the favorites table during one
    // authenticated browse of the full catalog.
    let favSqlCount = 0;
    const originalLogging = sequelize.options.logging;
    sequelize.options.logging = (sql) => {
        if (typeof sql === 'string' && /favorites/i.test(sql)) favSqlCount++;
    };
    try {
        const res = mockRes();
        await getAllSalons({ query: { page: '1', limit: '10' }, user: { role: 'customer', userId: customerA.id } }, res);
        assert.equal(res.statusCode, 200);
    } finally {
        sequelize.options.logging = originalLogging;
    }
    assert.equal(favSqlCount, 1, `expected exactly 1 favorites query, got ${favSqlCount}`);
});
