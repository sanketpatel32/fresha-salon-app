const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const { getSalonStaff } = require('../controllers/salonController');
const { validate, staffDirectorySchema } = require('../utils/validators');

// Minimal req/res stubs for invoking the controllers directly.
const mockReq = (overrides = {}) => ({ user: {}, query: {}, params: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// Run the staffDirectorySchema validation middleware against a query; returns
// the next(err) error (null when the middleware passed) plus pass/fail.
const runMw = (query) => {
    let err = null;
    let ok = false;
    validate(staffDirectorySchema, 'query')({ query }, {}, (e) => { if (e) err = e; else ok = true; });
    return { err, ok };
};

let salonA, salonB, emptySalon;
let svcCut, svcColor, svcB;

before(async () => {
    await sequelize.sync({ force: true });

    salonA = await Salons.create({
        name: 'DirectorySalonA', email: 'da@t.com', password: 'x', phoneNumber: '1',
        address: 'a', pricing: 'Moderate',
        workingDays: ['mon'], openingTime: '08:00', closingTime: '20:00',
    });
    salonB = await Salons.create({
        name: 'DirectorySalonB', email: 'db@t.com', password: 'x', phoneNumber: '2',
        address: 'b', pricing: 'Premium',
        workingDays: ['mon'], openingTime: '08:00', closingTime: '20:00',
    });
    emptySalon = await Salons.create({
        name: 'DirectoryEmptySalon', email: 'de@t.com', password: 'x', phoneNumber: '3',
        address: 'c', pricing: 'Affordable',
        workingDays: ['mon'], openingTime: '08:00', closingTime: '20:00',
    });

    svcCut = await Services.create({ name: 'Cut & Finish', category: 'Hair', price: 30.0, duration: 45, salonId: salonA.id });
    svcColor = await Services.create({ name: 'Full Color', category: 'Hair', price: 80.0, duration: 120, salonId: salonA.id });
    // Another salon's service — must never leak into salon A's directory.
    svcB = await Services.create({ name: 'B Salon Special', category: 'Spa & Massage', price: 55.0, duration: 60, salonId: salonB.id });

    const zara = await Staff.create({
        name: 'Zara', phoneNumber: '11', email: 'zara@t.com', password: 'x', salonId: salonA.id,
    });
    const adam = await Staff.create({
        name: 'Adam', phoneNumber: '22', email: 'adam@t.com', password: 'x', salonId: salonA.id,
    });
    // Inactive staff with a service pairing — hidden from the public directory.
    const bob = await Staff.create({
        name: 'Bob', phoneNumber: '33', email: 'bob@t.com', password: 'x', salonId: salonA.id, statusbar: 'inactive',
    });
    const bella = await Staff.create({
        name: 'Bella', phoneNumber: '44', email: 'bella@t.com', password: 'x', salonId: salonB.id,
    });

    await zara.setServices([svcCut, svcColor]);
    await adam.setServices([svcCut]);
    await bob.setServices([svcColor]);
    await bella.setServices([svcB]);
});

after(async () => { await sequelize.close(); });

test('staffDirectorySchema rejects missing / zero / negative / non-numeric salonId with 400', () => {
    for (const bad of [undefined, {}, 0, -5, 2.5, 'abc']) {
        const { err, ok } = runMw({ salonId: bad });
        assert.equal(ok, false, `expected rejection for ${JSON.stringify(bad)}`);
        assert.equal(err.status, 400); // message varies by failure mode (NaN vs positive)
    }
    assert.ok(runMw({ salonId: String(salonA.id) }).ok); // string ids coerce fine
});

test('returns only the right salon\'s ACTIVE staff, ordered by name ASC', async () => {
    const res = mockRes();
    await getSalonStaff(mockReq({ query: { salonId: salonA.id } }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.length, 2);
    assert.deepEqual(res.body.map((m) => m.name), ['Adam', 'Zara']); // alphabetical
    // Salon B's staff never bleeds into A's roster.
    assert.equal(res.body.find((m) => m.name === 'Bella'), undefined);
});

test('excludes inactive staff even when they have service pairings', async () => {
    const res = mockRes();
    await getSalonStaff(mockReq({ query: { salonId: salonA.id } }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.find((m) => m.name === 'Bob'), undefined);
});

test('services are filtered to each staff pairing; another salon\'s service must not leak', async () => {
    const res = mockRes();
    await getSalonStaff(mockReq({ query: { salonId: salonA.id } }), res);
    assert.equal(res.statusCode, 200);

    const byName = Object.fromEntries(res.body.map((m) => [m.name, m]));
    assert.deepEqual(
        byName.Zara.services.map((s) => s.id).sort((a, b) => a - b),
        [svcCut.id, svcColor.id].sort((a, b) => a - b)
    );
    assert.deepEqual(byName.Adam.services.map((s) => s.id), [svcCut.id]);

    // svcB belongs to salon B — it may not appear anywhere in A's payload,
    // and A's services must not appear in B's payload either.
    const allServiceIds = res.body.flatMap((m) => m.services.map((s) => s.id));
    assert.equal(allServiceIds.includes(svcB.id), false);

    const resB = mockRes();
    await getSalonStaff(mockReq({ query: { salonId: salonB.id } }), resB);
    assert.equal(resB.statusCode, 200);
    assert.deepEqual(resB.body.map((m) => m.name), ['Bella']);
    assert.deepEqual(resB.body[0].services.map((s) => s.id), [svcB.id]);
});

test('payload carries NO email / phone / password keys and is clean JSON', async () => {
    const res = mockRes();
    await getSalonStaff(mockReq({ query: { salonId: salonA.id } }), res);
    assert.equal(res.statusCode, 200);

    for (const member of res.body) {
        assert.deepEqual(Object.keys(member).sort(), ['id', 'name', 'services']);
        assert.equal(member.email, undefined);
        assert.equal(member.phoneNumber, undefined);
        assert.equal(member.password, undefined);
        assert.equal(member.statusbar, undefined);
        for (const service of member.services) {
            assert.deepEqual(Object.keys(service).sort(), ['category', 'duration', 'id', 'name', 'price']);
            assert.equal(service.email, undefined);
            assert.equal(service.phoneNumber, undefined);
            assert.equal(service.password, undefined);
            assert.equal(service.salonId, undefined);
            assert.equal(service.statusbar, undefined);
        }
    }
});

test('unknown salon returns 404', async () => {
    const res = mockRes();
    await getSalonStaff(mockReq({ query: { salonId: 999999 } }), res);

    assert.equal(res.statusCode, 404);
    assert.match(res.body.message, /not found/i);
});

test('salon with no active staff returns 200 with an empty array', async () => {
    const res = mockRes();
    await getSalonStaff(mockReq({ query: { salonId: emptySalon.id } }), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, []);
});
