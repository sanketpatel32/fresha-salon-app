const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations');
const PromoCode = require('../models/promoCodeModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const User = require('../models/userModel');
const Payment = require('../models/paymentModel');
const {
  round2,
  computeDiscount,
  resolvePromo,
  finalizeAppointmentFromPayment,
} = require('../services/paymentService');
const { validate, paymentCreateSchema, promoCreateSchema, promoUpdateSchema } = require('../utils/validators');
const {
  createPromo, listPromos, updatePromo, deletePromo,
} = require('../controllers/salonPromosController');

const mockReq = (overrides = {}) => ({ user: {}, params: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// ── computeDiscount units (pure — no DB) ─────────────────────────────────

test('computeDiscount percent without cap takes value% of amount', () => {
    assert.equal(computeDiscount({ discountType: 'percent', discountValue: 10 }, 500), 50);
});

test('computeDiscount percent is capped by maxDiscountAmount', () => {
    const promo = { discountType: 'percent', discountValue: 25, maxDiscountAmount: 300 };
    assert.equal(computeDiscount(promo, 2000), 300); // 25% of 2000 = 500 → capped
});

test('computeDiscount flat ignores the percent cap and returns the flat value', () => {
    const promo = { discountType: 'flat', discountValue: 75, maxDiscountAmount: 10 };
    assert.equal(computeDiscount(promo, 500), 75);
});

test('computeDiscount rounds to 2 decimals', () => {
    // 15% of 333.33 = 49.9995
    assert.equal(computeDiscount({ discountType: 'percent', discountValue: 15 }, 333.33), 50);
});

// ── Fixtures ─────────────────────────────────────────────────────────────

let salonA, salonB;
let pctCapped, flat75, salonOnlyA, expiredPct, upcomingPct, inactiveFlat, limitedFlat;

before(async () => {
    await sequelize.sync({ force: true });

    salonA = await Salons.create({ name: 'PromoS A', email: 'pa@t.com', password: 'x', phoneNumber: '1', address: 'a', pricing: 'Moderate' });
    salonB = await Salons.create({ name: 'PromoS B', email: 'pb@t.com', password: 'x', phoneNumber: '2', address: 'b', pricing: 'Moderate' });

    const past = new Date('2020-01-01T00:00:00Z');
    const future = new Date('2099-01-01T00:00:00Z');

    pctCapped = await PromoCode.create({
        code: 'pct10cap300', discountType: 'percent', discountValue: 10,
        maxDiscountAmount: 300, minOrderAmount: 500, usageLimit: null, salonId: null,
        validFrom: past, validUntil: future,
    });
    flat75 = await PromoCode.create({
        code: 'flat75', discountType: 'flat', discountValue: 75, minOrderAmount: 200, salonId: null,
    });
    salonOnlyA = await PromoCode.create({
        code: 'onlyatA', discountType: 'flat', discountValue: 50, minOrderAmount: 0, salonId: salonA.id,
    });
    expiredPct = await PromoCode.create({
        code: 'oldeone', discountType: 'flat', discountValue: 100, validUntil: past, salonId: null,
    });
    upcomingPct = await PromoCode.create({
        code: 'toosoon', discountType: 'flat', discountValue: 100, validFrom: future, salonId: null,
    });
    inactiveFlat = await PromoCode.create({
        code: 'switchedoff', discountType: 'flat', discountValue: 100, isActive: false, salonId: null,
    });
    limitedFlat = await PromoCode.create({
        code: 'onceonly', discountType: 'flat', discountValue: 100, usageLimit: 1, usedCount: 1, salonId: null,
    });
});

after(async () => { await sequelize.close(); });

// ── resolvePromo ─────────────────────────────────────────────────────────

test('resolvePromo applies percent math with cap for a valid global promo', async () => {
    const r = await resolvePromo('PCT10CAP300', salonA.id, 5000);
    assert.equal(r.ok, true);
    assert.equal(r.discountAmount, 300);
});

test('resolvePromo accepts amount exactly equal to minOrderAmount (boundary)', async () => {
    const r = await resolvePromo('FLAT75', salonA.id, 200);
    assert.equal(r.ok, true);
    assert.equal(r.discountAmount, 75);
});

test('resolvePromo rejects below minimum order amount', async () => {
    const r = await resolvePromo('FLAT75', salonA.id, 199.99);
    assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: 'Minimum order amount not met' });
});

test('resolvePromo rejects an expired code', async () => {
    const r = await resolvePromo('OLDEONE', salonA.id, 1000);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'Promo code expired');
});

test('resolvePromo rejects a not-yet-valid code with the same expiry message', async () => {
    const r = await resolvePromo('TOOSOON', salonA.id, 1000);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'Promo code expired');
});

test('resolvePromo rejects an inactive code', async () => {
    const r = await resolvePromo('SWITCHEDOFF', salonA.id, 1000);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'Invalid promo code');
});

test('resolvePromo rejects an unknown code', async () => {
    const r = await resolvePromo('NOSUCHCODE', salonA.id, 1000);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'Invalid promo code');
});

test('resolvePromo rejects wrong-salon codes but honors them at their own salon', async () => {
    const other = await resolvePromo('ONLYATA', salonB.id, 1000);
    assert.equal(other.ok, false);
    assert.equal(other.reason, 'Invalid promo code'); // no existence leak

    const own = await resolvePromo('ONLYATA', salonA.id, 1000);
    assert.equal(own.ok, true);
    assert.equal(own.discountAmount, 50);
});

test('resolvePromo rejects when usage limit is already reached', async () => {
    const r = await resolvePromo('ONCEONLY', salonA.id, 1000);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'Promo code usage limit reached');
});

test('resolvePromo canonicalizes lowercase / padded input to the stored uppercase code', async () => {
    const r = await resolvePromo('  pct10cap300 ', salonA.id, 5000);
    assert.equal(r.ok, true);
});

test('round2 avoids float artifacts on currency math', () => {
    assert.equal(round2(1.005), 1.01);
    assert.equal(round2(4.675), 4.68);
});

// ── Finalize integration (no gateway involved) ───────────────────────────

test('finalizeAppointmentFromPayment increments promo usedCount once and is idempotent', async () => {
    const customer = await User.create({ name: 'Promo User', email: 'pu@t.com', password: 'x', phoneNumber: '9' });
    const staff = await Staff.create({ name: 'Stylist P', email: 'stp@t.com', password: 'x', phoneNumber: '8', salonId: salonA.id });
    const service = await Services.create({ name: 'Promo Cut', price: 900, duration: 30, salonId: salonA.id });

    const order = await Payment.create({
        orderId: 'ORDER-PROMOTEST-1',
        paymentSessionId: 'session_promotest',
        orderAmount: 825, // discounted final charge
        orderCurrency: 'INR',
        originalAmount: 900,
        discountAmount: 75,
        promoCodeApplied: 'FLAT75',
        paymentStatus: 'Success',
        customerID: customer.id,
        dateSelected: '2026-09-01',
        timeSelected: '10:00',
        endTime: '11:00',
        staffId: staff.id,
        salonId: salonA.id,
        serviceId: service.id,
        duration: 60,
    });

    const beforeCount = (await PromoCode.findOne({ where: { code: 'FLAT75' } })).usedCount;
    const appt = await finalizeAppointmentFromPayment(order);
    assert.ok(appt && appt.id);

    let promo = await PromoCode.findOne({ where: { code: 'FLAT75' } });
    assert.equal(promo.usedCount, beforeCount + 1);

    // Replay (redirect handler + webhook) must NOT double-count.
    await finalizeAppointmentFromPayment(order);
    promo = await PromoCode.findOne({ where: { code: 'FLAT75' } });
    assert.equal(promo.usedCount, beforeCount + 1);
});

// ── Salon management endpoints (direct controller invocation) ────────────

test('createPromo stores the code uppercased and scoped to the owning salon', async () => {
    const req = mockReq({
        user: { role: 'salon', salonId: salonA.id },
        body: {
            code: 'save20', discountType: 'percent', discountValue: 20,
            maxDiscountAmount: 400, minOrderAmount: 300, validFrom: '2026-01-01', validUntil: '2026-12-31', usageLimit: 5,
        },
    });
    const res = mockRes();
    await createPromo(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.code, 'SAVE20');
    assert.equal(Number(res.body.salonId), Number(salonA.id));
    assert.equal(res.body.isActive, true);
    assert.equal(res.body.usedCount, 0);

    // Duplicate codes are rejected with 409.
    const dupRes = mockRes();
    await createPromo(mockReq({ user: { role: 'salon', salonId: salonB.id }, body: req.body }), dupRes);
    assert.equal(dupRes.statusCode, 409);
});

test('listPromos only returns the calling salon\'s own promos', async () => {
    const resA = mockRes();
    await listPromos(mockReq({ user: { role: 'salon', salonId: salonA.id } }), resA);
    assert.equal(resA.statusCode, 200);
    const codesA = resA.body.map((p) => p.code);
    assert.ok(codesA.includes('ONLYATA'), 'own promo listed');
    assert.ok(codesA.includes('SAVE20'), 'own promo listed');

    const resB = mockRes();
    await listPromos(mockReq({ user: { role: 'salon', salonId: salonB.id } }), resB);
    const codesB = resB.body.map((p) => p.code);
    assert.ok(!codesB.includes('ONLYATA'), 'other salon\'s promos are invisible');
    assert.ok(!codesB.includes('SAVE20'), 'other salon\'s promos are invisible');
});

test('updatePromo toggles isActive for the owner, 403 for another salon, 404 unknown', async () => {
    const mine = await PromoCode.findOne({ where: { code: 'SAVE20' } });

    const res = mockRes();
    await updatePromo(mockReq({
        user: { role: 'salon', salonId: salonA.id },
        params: { id: String(mine.id) },
        body: { isActive: false },
    }), res);
    assert.equal(res.statusCode, 200);
    await mine.reload();
    assert.equal(mine.isActive, false);

    const foreign = mockRes();
    await updatePromo(mockReq({
        user: { role: 'salon', salonId: salonB.id },
        params: { id: String(mine.id) },
        body: { isActive: true },
    }), foreign);
    assert.equal(foreign.statusCode, 403);
    await mine.reload();
    assert.equal(mine.isActive, false, 'foreign PATCH must not change the row');

    const missing = mockRes();
    await updatePromo(mockReq({
        user: { role: 'salon', salonId: salonA.id },
        params: { id: '999999' },
        body: { isActive: true },
    }), missing);
    assert.equal(missing.statusCode, 404);
});

test('deletePromo soft-deletes (isActive=false, row kept), 403 for another salon', async () => {
    const mine = await PromoCode.findOne({ where: { code: 'ONLYATA' } });

    const foreign = mockRes();
    await deletePromo(mockReq({
        user: { role: 'salon', salonId: salonB.id },
        params: { id: String(mine.id) },
    }), foreign);
    assert.equal(foreign.statusCode, 403);

    const res = mockRes();
    await deletePromo(mockReq({
        user: { role: 'salon', salonId: salonA.id },
        params: { id: String(mine.id) },
    }), res);
    assert.equal(res.statusCode, 200);

    const row = await PromoCode.findOne({ where: { code: 'ONLYATA' } });
    assert.ok(row, 'row still exists after soft delete');
    assert.equal(row.isActive, false);

    // A soft-deleted code can no longer be redeemed.
    const dead = await resolvePromo('ONLYATA', salonA.id, 1000);
    assert.equal(dead.ok, false);
});

// ── Validation schemas ───────────────────────────────────────────────────

test('paymentCreateSchema accepts optional promoCode, trimming + uppercasing it', () => {
    const parsed = paymentCreateSchema.parse({
        serviceId: 1, salonId: 2, staffId: 3,
        dateSelect: '2026-09-01', time: '10:00', duration: 60,
        promoCode: '  save20 ',
    });
    assert.equal(parsed.promoCode, 'SAVE20');

    const absent = paymentCreateSchema.safeParse({
        serviceId: 1, salonId: 2, staffId: 3,
        dateSelect: '2026-09-01', time: '10:00', duration: 60,
    });
    assert.ok(absent.success);
    assert.equal(absent.data.promoCode, undefined);
});

test('promoCreateSchema happy path coerces numbers and uppercases the code', () => {
    const parsed = promoCreateSchema.parse({
        code: 'welcome10', discountType: 'percent', discountValue: '10',
        maxDiscountAmount: '150', minOrderAmount: '250', usageLimit: '50',
        validFrom: '2026-01-01', validUntil: '2026-12-31',
    });
    assert.equal(parsed.code, 'WELCOME10');
    assert.equal(parsed.discountValue, 10);
    assert.equal(parsed.maxDiscountAmount, 150);
});

test('promoCreateSchema rejects short codes, bad characters, >100 percent, inverted windows, bad dates', () => {
    const base = { code: 'OKCODE', discountType: 'percent', discountValue: 10 };
    const cases = [
        [{ ...base, code: 'AB' }, /3-20/],                       // too short
        [{ ...base, code: 'BAD CHAR' }, /letters, numbers/],     // space not allowed
        [{ ...base, code: 'NO!CODE' }, /letters, numbers/],
        [{ ...base, discountValue: 150 }, /cannot exceed 100/],  // percent > 100
        [{ ...base, validFrom: '2026-12-31', validUntil: '2026-01-01' }, /validUntil/],
        [{ ...base, validFrom: '31/12/2026' }, /YYYY-MM-DD/],
        [{ code: 'NEGVAL', discountType: 'flat', discountValue: -5 }, /greater than zero/],
    ];
    for (const [body, pattern] of cases) {
        const r = promoCreateSchema.safeParse(body);
        assert.equal(r.success, false, JSON.stringify(body));
        assert.match(r.error.issues[0].message, pattern);
    }
});

test('promoUpdateSchema strips immutable fields and validates window ordering', () => {
    const stripped = promoUpdateSchema.safeParse({ code: 'HACKED', isActive: false });
    assert.ok(stripped.success);
    assert.equal(stripped.data.code, undefined); // schema-level immutability
    assert.equal(stripped.data.isActive, false);

    const badWindow = promoUpdateSchema.safeParse({
        validFrom: '2026-12-31', validUntil: '2026-01-01',
    });
    assert.equal(badWindow.success, false);

    const good = promoUpdateSchema.parse({ usageLimit: '25' });
    assert.equal(good.usageLimit, 25);
});
