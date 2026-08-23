const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const User = require('../models/userModel');
const Notification = require('../models/notificationModel');
const { handleUserSignup, getMyReferralCode, getLoyaltyBalance } = require('../controllers/userController');
const { generateReferralCode, ensureReferralCode, REFERRAL_ALPHABET, REFERRAL_CODE_LENGTH } = require('../services/referralService');
const { awardReferralBonus, REFERRAL_BONUS_POINTS } = require('../services/loyaltyService');
const authMiddleware = require('../middlewares/authMiddleware');
const userRoutes = require('../routes/userRoutes');
const { customerSignupSchema } = require('../utils/validators');

// Minimal req/res stubs for invoking the controllers directly
// (established mock style across the suites).
const mockReq = (overrides = {}) => ({ user: {}, query: {}, params: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// The referral bonus is fire-and-forget from signup; poll until it lands.
const waitFor = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await fn();
        if (result) return result;
        await new Promise((r) => setTimeout(r, 25));
    }
    return await fn();
};

// Unambiguous alphabet — the format regex must reject every excluded lookalike.
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

let referrer;

before(async () => {
    await sequelize.sync({ force: true });
    referrer = await User.create({ name: 'Rita Referrer', email: 'rita@t.com', password: 'x', phoneNumber: '1' });
});

after(async () => { await sequelize.close(); });

// ── Code generation & lazy assignment ─────────────────────────────────────

test('generateReferralCode emits 8 unambiguous-alphabet characters (never 0/O/1/I)', () => {
    for (let i = 0; i < 50; i++) {
        const code = generateReferralCode();
        assert.equal(code.length, REFERRAL_CODE_LENGTH);
        assert.match(code, CODE_RE, `code ${code} must use only ${REFERRAL_ALPHABET}`);
        for (const banned of ['0', 'O', '1', 'I']) {
            assert.ok(!code.includes(banned), `code ${code} must not contain ${banned}`);
        }
    }
});

test('GET /referral assigns a code lazily and is idempotent (same value twice)', async () => {
    // Fresh user with no code yet.
    const u = await User.create({ name: 'Lazy Larry', email: 'larry@t.com', password: 'x', phoneNumber: '2' });
    assert.equal(u.referralCode, null, 'starts without a code');

    const res1 = mockRes();
    await getMyReferralCode(mockReq({ user: { userId: u.id, role: 'customer' } }), res1);
    assert.equal(res1.statusCode, 200);
    assert.match(res1.body.referralCode, CODE_RE);
    assert.ok(!('referralUrl' in res1.body), 'no APP_URL convention set -> URL omitted');

    const res2 = mockRes();
    await getMyReferralCode(mockReq({ user: { userId: u.id, role: 'customer' } }), res2);
    assert.equal(res2.body.referralCode, res1.body.referralCode, 'second read returns the SAME code');

    // Persisted on the row itself.
    await u.reload();
    assert.equal(u.referralCode, res1.body.referralCode);
});

test('GET /referral builds a shareable signup URL when APP_URL is configured', async () => {
    process.env.APP_URL = 'https://salon.example.com/';
    try {
        const u = await User.create({ name: 'Url Uma', email: 'uma@t.com', password: 'x', phoneNumber: '3' });
        const res = mockRes();
        await getMyReferralCode(mockReq({ user: { userId: u.id, role: 'customer' } }), res);
        assert.equal(res.statusCode, 200);
        assert.match(res.body.referralUrl,
            /^https:\/\/salon\.example\.com\/user\/signup\?ref=[A-HJ-NP-Z2-9]{8}$/,
            'trailing slash stripped, frontend signup route + ref param');
    } finally {
        delete process.env.APP_URL;
    }
});

// ── Signup with a valid referral code ─────────────────────────────────────

test('signup citing a valid code links referredByUserId and credits BOTH users exactly 100', async () => {
    const code = await ensureReferralCode(referrer);

    const res = mockRes();
    await handleUserSignup(mockReq({
        body: {
            name: 'Newbie Nora',
            email: 'nora@t.com',
            password: 'password123',
            phoneNumber: '5550028',
            referralCode: code,
        },
    }), res);
    assert.equal(res.statusCode, 201);

    const newbie = await User.findOne({ where: { email: 'nora@t.com' } });
    assert.equal(newbie.referredByUserId, referrer.id, 'new row points at the code owner');

    // Fire-and-forget bonus lands for both sides.
    const bothCredited = await waitFor(async () => {
        await referrer.reload();
        await newbie.reload();
        return Number(referrer.loyaltyPoints) === REFERRAL_BONUS_POINTS
            && Number(newbie.loyaltyPoints) === REFERRAL_BONUS_POINTS;
    });
    assert.ok(bothCredited, 'both balances reach exactly 100');
    assert.equal(Number(referrer.lifetimePointsEarned), REFERRAL_BONUS_POINTS);
    assert.equal(Number(newbie.lifetimePointsEarned), REFERRAL_BONUS_POINTS);

    // One notification per party (fire-and-forget, polled like #27's tests).
    const notices = await waitFor(() => Notification.findAll({
        where: { type: 'referral.bonus' },
    }));
    assert.equal(notices.length, 2, 'referrer and referred each notified once');
});

test('resolution is case-insensitive: lowercase input matches the uppercase stored code', async () => {
    const code = await ensureReferralCode(referrer);

    // Direct controller call bypasses the zod schema's toUpperCase, so this
    // exercises the controller's own normalization too.
    const res = mockRes();
    await handleUserSignup(mockReq({
        body: {
            name: 'Casey Carol', email: 'carol@t.com', password: 'password123',
            phoneNumber: '5550029', referralCode: code.toLowerCase(),
        },
    }), res);
    assert.equal(res.statusCode, 201);

    const carol = await User.findOne({ where: { email: 'carol@t.com' } });
    assert.equal(carol.referredByUserId, referrer.id, 'lowercase citation still links');
});

// ── Bad codes never block signup ──────────────────────────────────────────

test('unknown / garbage / empty codes: signup succeeds unlinked with no bonus', async () => {
    await referrer.reload(); // earlier tests credited via SQL increments
    const baseline = Number(referrer.loyaltyPoints);
    const badCodes = ['ZZZZZZZZ', '!@#$%^&*', '   ', ''];

    for (const [i, bad] of badCodes.entries()) {
        const res = mockRes();
        await handleUserSignup(mockReq({
            body: {
                name: `Unlinked Ulf ${i}`, email: `ulf${i}@t.com`,
                password: 'password123', phoneNumber: `555004${i}`,
                referralCode: bad,
            },
        }), res);
        assert.equal(res.statusCode, 201, `signup survives code "${bad}"`);
        const ulf = await User.findOne({ where: { email: `ulf${i}@t.com` } });
        assert.equal(ulf.referredByUserId, null, `"${bad}" must not link`);
    }

    await referrer.reload();
    assert.equal(Number(referrer.loyaltyPoints), baseline, 'no bonus from any bad code');
});

test('self-referral-by-email guard: a cited code owned by the same email never links or pays', async () => {
    // The signup email differs from the stored one only in CASE, so the 409
    // duplicate check (case-sensitive in SQLite) passes and the guard is what
    // actually stops the self-referral.
    const gail = await User.create({
        name: 'Guard Gail', email: 'GuardGail@t.com', password: 'x', phoneNumber: '7777',
    });
    const code = await ensureReferralCode(gail);

    const res = mockRes();
    await handleUserSignup(mockReq({
        body: {
            name: 'Gail Again', email: 'guardgail@t.com', password: 'password123',
            phoneNumber: '5550031', referralCode: code,
        },
    }), res);
    assert.equal(res.statusCode, 201);

    const again = await User.findOne({ where: { email: 'guardgail@t.com' } });
    assert.equal(again.referredByUserId, null, 'same email -> not linked');
    await gail.reload();
    assert.equal(Number(gail.loyaltyPoints), 0, 'owner balance untouched by her own code');
    assert.equal(Number(again.loyaltyPoints), 0);
});

// ── awardReferralBonus never-throw contract ───────────────────────────────

test('awardReferralBonus resolves { awarded: 0 } instead of throwing when the ledger fails', async () => {
    const originalIncrement = User.increment;
    User.increment = () => Promise.reject(new Error('db exploded'));
    let outcome;
    try {
        outcome = await awardReferralBonus(999001, 999002); // must NOT throw
    } finally {
        User.increment = originalIncrement;
    }
    assert.deepEqual(outcome, { awarded: 0 });
});

test('awardReferralBonus guards degenerate ids (missing / identical)', async () => {
    assert.deepEqual(await awardReferralBonus(null, null), { awarded: 0 });
    assert.deepEqual(await awardReferralBonus(undefined, 5), { awarded: 0 });
    assert.deepEqual(await awardReferralBonus(7, 7), { awarded: 0 }, 'self-bonus refused');
});

test('a failing ledger cannot break signup: account created + linked, bonus silently missed', async () => {
    const originalIncrement = User.increment;
    User.increment = () => Promise.reject(new Error('db exploded'));
    let res;
    try {
        res = mockRes();
        await handleUserSignup(mockReq({
            body: {
                name: 'Tough Tina', email: 'tina@t.com', password: 'password123',
                phoneNumber: '5550033', referralCode: await ensureReferralCode(referrer),
            },
        }), res);
    } finally {
        User.increment = originalIncrement;
    }

    assert.equal(res.statusCode, 201, 'signup must survive the bonus failure');
    const tina = await User.findOne({ where: { email: 'tina@t.com' } });
    assert.ok(tina.referredByUserId, 'link persisted even though the payout blew up');
    assert.equal(Number(tina.loyaltyPoints), 0, 'no points under a broken ledger (documented under-award)');
});

// ── Schema rules ──────────────────────────────────────────────────────────

test('customerSignupSchema rejects >12-char referral codes and normalizes good ones', () => {
    const base = {
        name: 'Schema Sam', email: 'sam@t.com', password: 'password123', phoneNumber: '5550034',
    };

    const tooLong = customerSignupSchema.safeParse({ ...base, referralCode: 'A'.repeat(13) });
    assert.equal(tooLong.success, false, '13 chars rejected');

    const exact = customerSignupSchema.safeParse({ ...base, referralCode: 'abcdefgh2345' }); // 12 chars
    assert.equal(exact.success, true, '12 chars accepted at the boundary');
    assert.equal(exact.data.referralCode, 'ABCDEFGH2345', 'trimmed + uppercased into canonical form');

    const padded = customerSignupSchema.safeParse({ ...base, referralCode: '  ab12cd34  ' });
    assert.equal(padded.success, true);
    assert.equal(padded.data.referralCode, 'AB12CD34');

    const omitted = customerSignupSchema.safeParse(base);
    assert.equal(omitted.success, true);
    assert.ok(!('referralCode' in omitted.data), 'optional: absent stays absent');
});

// ── Loyalty endpoint exposes the code (#28 item 5) ────────────────────────

test('GET /loyalty now carries referralCode (lazily assigned, stable across reads)', async () => {
    const u = await User.create({ name: 'Dual Dana', email: 'dana@t.com', password: 'x', phoneNumber: '5550035' });

    const res1 = mockRes();
    await getLoyaltyBalance(mockReq({ user: { userId: u.id, role: 'customer' } }), res1);
    assert.equal(res1.statusCode, 200);
    assert.deepEqual(Object.keys(res1.body).sort(), ['lifetimePointsEarned', 'points', 'referralCode'],
        'points payload extended with the code');
    assert.match(res1.body.referralCode, CODE_RE);

    const res2 = mockRes();
    await getLoyaltyBalance(mockReq({ user: { userId: u.id, role: 'customer' } }), res2);
    assert.equal(res2.body.referralCode, res1.body.referralCode, 'lazy assignment is stable');
});

// ── Guarding & wiring ─────────────────────────────────────────────────────

test('auth scoping: the customer-only role guard rejects salon tokens on /referral', () => {
    const guard = authMiddleware.requireRole('customer');
    const denied = mockRes();
    let nextCalled = false;
    guard({ user: { role: 'salon', salonId: 1 } }, denied, () => { nextCalled = true; });
    assert.equal(denied.statusCode, 403);
    assert.equal(nextCalled, false);
});

test('routes: /api/user/referral is wired as auth -> roleGuard(customer) -> controller', () => {
    const layer = userRoutes.stack.find((l) => l.route && l.route.path === '/referral');
    assert.ok(layer, '/referral route should be registered');
    const handlers = layer.route.stack.map((s) => s.handle);
    assert.equal(handlers.length, 3, 'exactly three handlers');
    assert.equal(handlers[0].name, 'isAuth', 'must sit behind authMiddleware');
    assert.equal(handlers[1].name, 'roleGuard', 'must sit behind requireRole(customer)');
    assert.match(handlers[2].name, /^get/, 'terminal handler must be its controller');
});
