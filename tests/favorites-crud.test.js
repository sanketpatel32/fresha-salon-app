const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Favorite = require('../models/favoriteModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const { getFavorites, addFavorite, removeFavorite } = require('../controllers/favoriteController');

// Minimal req/res stubs for invoking the controllers directly.
const mockReq = (overrides = {}) => ({ user: {}, params: {}, body: {}, query: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

let customerA, customerB, salon1, salon2, salon3;

before(async () => {
    await sequelize.sync({ force: true });

    customerA = await User.create({ name: 'FavCustA', email: 'fca@t.com', password: 'x', phoneNumber: '1' });
    customerB = await User.create({ name: 'FavCustB', email: 'fcb@t.com', password: 'x', phoneNumber: '2' });

    salon1 = await Salons.create({ name: 'FavSalon1', email: 'fs1@t.com', password: 'x', phoneNumber: '11', address: 'a1', pricing: 'Moderate', statusbar: 'active' });
    salon2 = await Salons.create({ name: 'FavSalon2', email: 'fs2@t.com', password: 'x', phoneNumber: '12', address: 'a2', pricing: 'Moderate', statusbar: 'active' });
    salon3 = await Salons.create({ name: 'FavSalon3', email: 'fs3@t.com', password: 'x', phoneNumber: '13', address: 'a3', pricing: 'Moderate', statusbar: 'active' });

    // Pre-existing state so list-scoping tests have something to compare against:
    // A already favorites Salon3 (older), B already favorites Salon1.
    const base = Date.now() - 10000;
    await Favorite.bulkCreate([
        { userId: customerA.id, salonId: salon3.id, createdAt: new Date(base), updatedAt: new Date(base) },
        { userId: customerB.id, salonId: salon1.id, createdAt: new Date(base), updatedAt: new Date(base) },
    ]);
});

after(async () => { await sequelize.close(); });

// ---------- POST /api/user/favorites (addFavorite) ----------

test('favorites add: creates a row and answers 200 with a message', async () => {
    const res = mockRes();
    await addFavorite(mockReq({ user: { userId: customerA.id }, body: { salonId: salon1.id } }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { message: 'Added to favorites' });

    const rows = await Favorite.findAll({ where: { userId: customerA.id, salonId: salon1.id } });
    assert.equal(rows.length, 1);
});

test('favorites add: duplicate add is idempotent (findOrCreate) — still exactly 1 row, no error', async () => {
    // Contract note: re-adding is deliberately NOT an error — always 200.
    for (let i = 0; i < 2; i++) {
        const res = mockRes();
        await addFavorite(mockReq({ user: { userId: customerA.id }, body: { salonId: salon2.id } }), res);
        assert.equal(res.statusCode, 200);
    }
    const count = await Favorite.count({ where: { userId: customerA.id, salonId: salon2.id } });
    assert.equal(count, 1, 'duplicate adds must not create extra rows');
});

test('favorites add: missing salonId -> 400 without touching the table', async () => {
    const beforeCount = await Favorite.count();
    const res = mockRes();
    await addFavorite(mockReq({ user: { userId: customerA.id }, body: {} }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /salonId is required/i);
    assert.equal(await Favorite.count(), beforeCount);
});

// ---------- GET /api/user/favorites (getFavorites) ----------

test('favorites list: legacy shape returns own favorites as salon objects with salon data', async () => {
    const res = mockRes();
    await getFavorites(mockReq({ user: { userId: customerA.id }, query: {} }), res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    // A has Salon3 (seeded) + Salon1 + Salon2 (added above); newest first.
    assert.deepEqual(res.body.map(s => s.id), [salon2.id, salon1.id, salon3.id]);
    // Items are full salon payloads, not bare favorite join rows.
    assert.equal(res.body[0].name, 'FavSalon2');
    assert.ok(!('userId' in res.body[0]), 'response maps to salon objects only');
});

test('favorites list: one user cannot see another user\'s favorites', async () => {
    const res = mockRes();
    await getFavorites(mockReq({ user: { userId: customerB.id }, query: {} }), res);
    assert.equal(res.statusCode, 200);
    // B only ever favorited Salon1 — none of A's three may leak.
    assert.deepEqual(res.body.map(s => s.id), [salon1.id]);
});

// ---------- DELETE /api/user/favorites/:salonId (removeFavorite) ----------

test('favorites remove: own pairing is deleted and confirmed 200', async () => {
    const res = mockRes();
    await removeFavorite(mockReq({ user: { userId: customerA.id }, params: { salonId: String(salon1.id) } }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { message: 'Removed from favorites' });
    assert.equal(await Favorite.count({ where: { userId: customerA.id, salonId: salon1.id } }), 0);
});

test('favorites remove: non-existent pairing -> 404 "Favorite not found"', async () => {
    // Current contract: destroying 0 rows is reported as 404 (not 400 or silent 200).
    // Also covers removing a salon you never favorited — same 404.
    const res = mockRes();
    await removeFavorite(mockReq({ user: { userId: customerA.id }, params: { salonId: String(salon1.id) } }), res);
    assert.equal(res.statusCode, 404);
    assert.match(res.body.message, /favorite not found/i);

    const neverAdded = mockRes();
    await removeFavorite(mockReq({ user: { userId: customerB.id }, params: { salonId: String(salon3.id) } }), neverAdded);
    assert.equal(neverAdded.statusCode, 404);
});
