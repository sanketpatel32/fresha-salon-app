const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Salons = require('../models/salonsModel');
const Services = require('../models/servicesModel');
const { addService, getAllServices, updateService, deleteService } = require('../controllers/salonServicesController');
const { validate, serviceAddSchema, serviceUpdateSchema, SERVICE_CATEGORIES } = require('../utils/validators');

// Minimal req/res stubs for invoking the controllers directly.
const mockReq = (overrides = {}) => ({ user: {}, params: {}, body: {}, query: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// Run a zod validate middleware against a body directly (no HTTP layer);
// returns whether it passed and the next(err) error when it didn't.
const runValidate = (schema, body) => {
    let err = null;
    let ok = false;
    validate(schema)({ body }, {}, (e) => { if (e) err = e; else ok = true; });
    return { ok, err };
};

// Serialize like Express would — direct invocation leaves Sequelize instances.
const plain = (x) => JSON.parse(JSON.stringify(x));

let salonA, salonB;

before(async () => {
    await sequelize.sync({ force: true });

    salonA = await Salons.create({ name: 'SvcSalonA', email: 'sa@t.com', password: 'x', phoneNumber: '21', address: 'a', pricing: 'Moderate', statusbar: 'active' });
    salonB = await Salons.create({ name: 'SvcSalonB', email: 'sb@t.com', password: 'x', phoneNumber: '22', address: 'b', pricing: 'Premium', statusbar: 'active' });
});

after(async () => { await sequelize.close(); });

// ---------- POST /services/add ----------

test('service add: salon creates a service (201), fields persisted incl. token salonId', async () => {
    const res = mockRes();
    await addService(mockReq({
        user: { role: 'salon', salonId: salonA.id },
        body: { name: 'Classic Cut', price: 25.5, duration: 45, category: 'Hair' },
    }), res);
    assert.equal(res.statusCode, 201);
    const created = plain(res.body);
    assert.equal(created.name, 'Classic Cut');
    assert.equal(Number(created.price), 25.5);
    assert.equal(created.duration, 45);
    assert.equal(created.category, 'Hair');
    assert.equal(created.salonId, salonA.id, 'salonId comes from the token, not the body');
    assert.equal(created.statusbar, 'active', 'new services default to active');

    // Read back through the listing to prove persistence.
    const list = mockRes();
    await getAllServices(mockReq({ user: { role: 'salon', salonId: salonA.id } }), list);
    assert.equal(list.statusCode, 200);
    assert.ok(plain(list.body).some(s => s.name === 'Classic Cut'));
});

test('service add: category defaults to "Other" when omitted', async () => {
    const res = mockRes();
    await addService(mockReq({
        user: { role: 'salon', salonId: salonA.id },
        body: { name: 'Mystery Service', price: 10, duration: 30 },
    }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(plain(res.body).category, 'Other');
});

test('service add: controller-level guard rejects missing name/price/duration with 400', async () => {
    // NOTE current contract: the controller checks truthiness only — the route
    // layer's zod schema is the stricter gate tested in the next block.
    for (const body of [{ duration: 30 }, { name: 'x', duration: 30 }, { name: 'x', price: 5 }]) {
        const res = mockRes();
        await addService(mockReq({ user: { role: 'salon', salonId: salonA.id }, body }), res);
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /all fields are required/i);
    }
});

// ---------- zod schema rules (route middleware, invoked directly) ----------

test('serviceAddSchema accepts every documented category and optional category', () => {
    assert.ok(Array.isArray(SERVICE_CATEGORIES));
    for (const category of SERVICE_CATEGORIES) {
        assert.equal(runValidate(serviceAddSchema, { name: 'S', price: 10, duration: 30, category }).ok, true);
    }
    assert.equal(runValidate(serviceAddSchema, { name: 'S', price: 10, duration: 30 }).ok, true);
});

test('serviceAddSchema rejects negative/zero price and non-numeric price with 400', async () => {
    // Current rule: price must be a POSITIVE number — so both -1 and 0 fail.
    for (const bad of [-1, 0, -0.01, 'free', null]) {
        const { ok, err } = runValidate(serviceAddSchema, { name: 'S', price: bad, duration: 30 });
        assert.equal(ok, false, `price ${JSON.stringify(bad)} must be rejected`);
        assert.equal(err.status, 400);
    }
});

test('serviceAddSchema rejects zero/negative, fractional and >600 duration with 400', async () => {
    // Current rule: integer minutes, 1..600.
    for (const bad of [0, -10, 22.5, 601]) {
        const { ok, err } = runValidate(serviceAddSchema, { name: 'S', price: 10, duration: bad });
        assert.equal(ok, false, `duration ${JSON.stringify(bad)} must be rejected`);
        assert.equal(err.status, 400);
    }
    assert.equal(runValidate(serviceAddSchema, { name: 'S', price: 10, duration: 600 }).ok, true, 'boundary 600 allowed');
});

test('serviceUpdateSchema rejects unknown statusbar values but allows active/inactive', () => {
    assert.equal(runValidate(serviceUpdateSchema, { statusbar: 'archived' }).ok, false);
    for (const good of ['active', 'inactive']) {
        assert.equal(runValidate(serviceUpdateSchema, { statusbar: good }).ok, true);
    }
});

// ---------- GET /services/getall ----------

test('service list: scoped to the calling salon only', async () => {
    await Services.bulkCreate([
        { name: 'A-Service1', price: 20, duration: 30, category: 'Hair', salonId: salonA.id },
        { name: 'A-Service2', price: 40, duration: 60, category: 'Nails', salonId: salonA.id },
        { name: 'B-Service1', price: 99, duration: 90, category: 'Spa & Massage', salonId: salonB.id },
    ]);

    const resA = mockRes();
    await getAllServices(mockReq({ user: { role: 'salon', salonId: salonA.id } }), resA);
    assert.deepEqual(plain(resA.body).map(s => s.name).sort(), ['A-Service1', 'A-Service2', 'Classic Cut', 'Mystery Service']);

    const resB = mockRes();
    await getAllServices(mockReq({ user: { role: 'salon', salonId: salonB.id } }), resB);
    assert.deepEqual(plain(resB.body).map(s => s.name), ['B-Service1']);
});

// ---------- PUT /services/update/:id ----------

test('service update: owner changes price/duration/category (200, persisted)', async () => {
    const svc = await Services.create({ name: 'Updatable', price: 50, duration: 60, category: 'Makeup', salonId: salonA.id });

    const res = mockRes();
    await updateService(mockReq({
        user: { role: 'salon', salonId: salonA.id },
        params: { id: String(svc.id) },
        body: { price: 75.25, duration: 90, category: 'Bridal' },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body.message, /updated successfully/i);

    const after = plain(await Services.findByPk(svc.id));
    assert.equal(Number(after.price), 75.25);
    assert.equal(after.duration, 90);
    assert.equal(after.category, 'Bridal');
    assert.equal(after.name, 'Updatable', 'untouched fields stay put on partial update');
});

test('service update: deactivate via statusbar=inactive', async () => {
    const svc = await Services.create({ name: 'Deactivatable', price: 15, duration: 20, salonId: salonA.id });
    const res = mockRes();
    await updateService(mockReq({
        user: { role: 'salon', salonId: salonA.id },
        params: { id: String(svc.id) },
        body: { statusbar: 'inactive' },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal((await Services.findByPk(svc.id)).statusbar, 'inactive');
    // Row is kept — deactivation is soft, deletion is the hard removal path.
    assert.ok(await Services.findByPk(svc.id));
});

test('service update: OTHER salon cannot update your service (403, untouched)', async () => {
    const svc = await Services.create({ name: 'AsOnly', price: 33, duration: 45, salonId: salonA.id });

    const res = mockRes();
    await updateService(mockReq({
        user: { role: 'salon', salonId: salonB.id }, // B poking at A's row
        params: { id: String(svc.id) },
        body: { price: 1 },
    }), res);
    // Contract note: existing-but-foreign rows are a 403; unknown ids are the 404 below.
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /unauthorized|access denied/i);
    assert.equal((await Services.findByPk(svc.id)).price, 33, 'row unchanged after denied update');
});

test('service update: unknown id -> 404', async () => {
    const res = mockRes();
    await updateService(mockReq({
        user: { role: 'salon', salonId: salonA.id },
        params: { id: '999999' },
        body: { price: 1 },
    }), res);
    assert.equal(res.statusCode, 404);
});

// ---------- DELETE /services/delete/:id ----------

test('service delete: owner hard-deletes their service (200, row gone)', async () => {
    const svc = await Services.create({ name: 'Doomed', price: 8, duration: 15, salonId: salonA.id });

    const res = mockRes();
    await deleteService(mockReq({
        user: { role: 'salon', salonId: salonA.id },
        params: { id: String(svc.id) },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body.message, /deleted successfully/i);
    assert.equal(await Services.findByPk(svc.id), null);
});

test('service delete: OTHER salon cannot delete your service (403, row survives)', async () => {
    const svc = await Services.create({ name: 'KeepMe', price: 12, duration: 25, salonId: salonA.id });

    const res = mockRes();
    await deleteService(mockReq({
        user: { role: 'salon', salonId: salonB.id },
        params: { id: String(svc.id) },
    }), res);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /unauthorized|access denied/i);
    assert.ok(await Services.findByPk(svc.id), 'row must survive a foreign delete attempt');
});

test('service delete: unknown id -> 404', async () => {
    const res = mockRes();
    await deleteService(mockReq({ user: { role: 'salon', salonId: salonA.id }, params: { id: '999999' } }), res);
    assert.equal(res.statusCode, 404);
});
