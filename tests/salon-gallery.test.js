const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Salons = require('../models/salonsModel');
const { parseGallery, updateGallery } = require('../controllers/salonGalleryController');
const { getSalonById, getSalonProfile } = require('../controllers/salonController');
const { validate, gallerySchema } = require('../utils/validators');

// Minimal req/res stubs for invoking the controllers directly.
const mockReq = (overrides = {}) => ({ user: {}, query: {}, params: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// Run the gallerySchema validation middleware against a body; returns the
// next(err) error (null when the middleware passed) plus pass/fail.
const runMw = (body) => {
    let err = null;
    let ok = false;
    validate(gallerySchema)({ body }, {}, (e) => { if (e) err = e; else ok = true; });
    return { err, ok };
};

let salonA, salonB;

before(async () => {
    await sequelize.sync({ force: true });

    salonA = await Salons.create({
        name: 'GallerySalonA', email: 'ga@t.com', password: 'x', phoneNumber: '3',
        address: 'a', pricing: 'Moderate',
        workingDays: ['mon'], openingTime: '08:00', closingTime: '20:00',
    });
    salonB = await Salons.create({
        name: 'GallerySalonB', email: 'gb@t.com', password: 'x', phoneNumber: '4',
        address: 'b', pricing: 'Premium',
        workingDays: ['mon'], openingTime: '08:00', closingTime: '20:00',
    });
});

after(async () => { await sequelize.close(); });

// ── parseGallery units (pure helper, never throws) ───────────────────────

test('parseGallery returns [] for null/undefined/non-string values', () => {
    assert.deepEqual(parseGallery(null), []);
    assert.deepEqual(parseGallery(undefined), []);
    assert.deepEqual(parseGallery(42), []);
    assert.deepEqual(parseGallery({}), []);
    assert.deepEqual(parseGallery(''), []);
});

test('parseGallery returns [] for malformed JSON and JSON that is not an array', () => {
    assert.deepEqual(parseGallery('{{{not-json'), []);
    assert.deepEqual(parseGallery('"just a string"'), []);
    assert.deepEqual(parseGallery('{"a":1}'), []);
});

test('parseGallery keeps string entries and filters non-string entries', () => {
    assert.deepEqual(
        parseGallery(JSON.stringify(['http://a.com/1.jpg', 7, null, 'https://b.com/2.png'])),
        ['http://a.com/1.jpg', 'https://b.com/2.png']
    );
    assert.deepEqual(parseGallery(JSON.stringify([])), []);
});

// ── gallerySchema middleware (tested directly, like the csv test) ────────

test('gallerySchema rejects more than 10 urls with 400', () => {
    const images = Array.from({ length: 11 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
    const { err, ok } = runMw({ images });

    assert.equal(ok, false);
    assert.equal(err.status, 400);
    assert.match(err.message, /at most 10/i);
});

// Serialize like Express would over the wire — needed because direct
// invocation leaves raw Sequelize instances in res.json(), and runtime-set
// fields (dataValues.images) have no instance getter.
const plain = (obj) => JSON.parse(JSON.stringify(obj));

test('gallerySchema rejects non-http(s) schemes, bare words and empty strings with 400', () => {
    for (const [bad, msg] of [
        ['ftp://cdn.example.com/a.jpg', /valid http\(s\) URL/i],
        ['not-a-url', /valid http\(s\) URL/i],
        ['javascript:alert(1)', /valid http\(s\) URL/i],
        ['', /cannot be empty/i],
    ]) {
        const { err, ok } = runMw({ images: [bad] });
        assert.equal(ok, false, `expected rejection for ${JSON.stringify(bad)}`);
        assert.equal(err.status, 400);
        assert.match(err.message, msg);
    }
});

test('gallerySchema trims entries, drops duplicates, and allows an empty list', () => {
    const req = { body: { images: ['  https://a.com/1.jpg  ', 'https://a.com/1.jpg', 'https://b.com/2.jpg'] } };
    let passed = false;
    validate(gallerySchema)(req, {}, () => { passed = true; });

    assert.ok(passed);
    assert.deepEqual(req.body.images, ['https://a.com/1.jpg', 'https://b.com/2.jpg']);
    assert.ok(runMw({ images: [] }).ok);
});

// ── Controller tests (direct invocation, SQLite fixtures) ────────────────

test('owner upsert stores JSON and read-back parses it into an images array', async () => {
    const res = mockRes();
    await updateGallery(mockReq({
        user: { salonId: salonA.id },
        body: { images: ['https://cdn.example.com/hero.jpg', 'http://cdn.example.com/room.png'] },
    }), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.images, ['https://cdn.example.com/hero.jpg', 'http://cdn.example.com/room.png']);

    // Raw column really holds a JSON string.
    await salonA.reload();
    assert.deepEqual(
        JSON.parse(salonA.galleryImages),
        ['https://cdn.example.com/hero.jpg', 'http://cdn.example.com/room.png']
    );

    // Public profile exposes the parsed array — and not the raw blob.
    const profile = mockRes();
    await getSalonProfile(mockReq({ params: { salonId: String(salonA.id) } }), profile);
    assert.equal(profile.statusCode, 200);
    const salon = plain(profile.body.salon);
    assert.deepEqual(salon.images, ['https://cdn.example.com/hero.jpg', 'http://cdn.example.com/room.png']);
    assert.equal(salon.galleryImages, undefined);
});

test('public getsalonbyId also includes parsed images', async () => {
    const res = mockRes();
    await getSalonById(mockReq({ query: { salonId: String(salonA.id) } }), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(plain(res.body).images, ['https://cdn.example.com/hero.jpg', 'http://cdn.example.com/room.png']);
});

test('empty upsert clears the gallery (stored NULL, reads back as [])', async () => {
    const res = mockRes();
    await updateGallery(mockReq({ user: { salonId: salonA.id }, body: { images: [] } }), res);
    assert.equal(res.statusCode, 200);

    await salonA.reload();
    assert.equal(salonA.galleryImages, null);

    const profile = mockRes();
    await getSalonProfile(mockReq({ params: { salonId: String(salonA.id) } }), profile);
    assert.deepEqual(plain(profile.body.salon).images, []);
});

test('garbage DB value parses to [] instead of breaking public reads', async () => {
    salonB.galleryImages = '{{{definitely not json';
    await salonB.save();

    const profile = mockRes();
    await getSalonProfile(mockReq({ params: { salonId: String(salonB.id) } }), profile);
    assert.equal(profile.statusCode, 200);
    assert.deepEqual(plain(profile.body.salon).images, []);
});

test("one salon's write never touches another salon's gallery", async () => {
    // Salon B writes its own gallery via its own token identity…
    const res = mockRes();
    await updateGallery(mockReq({
        user: { salonId: salonB.id },
        body: { images: ['https://salon-b.example.com/own.jpg'] },
    }), res);
    assert.equal(res.statusCode, 200);

    // …it lands on B's row only. Ownership is token-scoped (the controller
    // has no :id param to point at someone else's salon), so A's row keeps
    // whatever it had ([] since the empty upsert) instead of inheriting
    // B's image.
    const profileA = mockRes();
    await getSalonProfile(mockReq({ params: { salonId: String(salonA.id) } }), profileA);
    assert.deepEqual(plain(profileA.body.salon).images, []);

    const profileB = mockRes();
    await getSalonProfile(mockReq({ params: { salonId: String(salonB.id) } }), profileB);
    assert.deepEqual(plain(profileB.body.salon).images, ['https://salon-b.example.com/own.jpg']);
});
