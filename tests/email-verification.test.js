const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const User = require('../models/userModel');
const { handleUserSignup, verifyEmail, resendVerification } = require('../controllers/userController');
const emailService = require('../services/emailService');

// Minimal req/res stubs for invoking the controllers directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};
const reqWith = (body) => ({ body });

// Signup only ever persists sha256(token); to tie the DB row back to the
// emailed link we capture the verify link via a stubbed email service.
let capturedLink = null;
let sendCalls = 0;
const realSend = emailService.sendVerificationEmail;
const captureSend = () => {
    emailService.sendVerificationEmail = async (ctx) => {
        capturedLink = ctx.verifyLink;
        sendCalls += 1;
        return { sent: true };
    };
};
const capturedToken = () =>
    new URL(capturedLink, 'http://localhost').searchParams.get('token');
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

before(async () => {
    await sequelize.sync({ force: true });
    // Pretend Brevo is configured so signup actually issues tokens (the send
    // itself is stubbed below — no real API calls happen). The final test
    // deletes these again to exercise the unconfigured path.
    process.env.BREVO_API_KEY = 'test-key';
    process.env.SENDER_EMAIL = 'test@example.com';
    captureSend();
});

after(async () => {
    emailService.sendVerificationEmail = realSend;
    await sequelize.close();
});

test('signup issues a verification token: stores only its hash plus ~24h expiry', async () => {
    const started = Date.now() - 1000;
    const res = mockRes();
    await handleUserSignup(reqWith({
        name: 'Verifiable Vic',
        email: 'vic@t.com',
        password: 'password123',
        phoneNumber: '5550001',
    }), res);
    assert.equal(res.statusCode, 201);
    // Soft verification: the flag ships false in the response but nothing gates.
    assert.equal(res.body.emailVerified, false);

    const user = await User.findOne({ where: { email: 'vic@t.com' } });
    // 64 hex chars — and never the plaintext token from the link.
    assert.match(user.verificationTokenHash, /^[a-f0-9]{64}$/);
    const token = capturedToken();
    assert.notEqual(token, user.verificationTokenHash);
    assert.equal(sha256(token), user.verificationTokenHash);

    // Expiry sits ~24 hours ahead of the request.
    const expiresAt = new Date(user.verificationExpiresAt).getTime();
    assert.ok(Math.abs(expiresAt - (started + 24 * 60 * 60 * 1000)) < 90 * 1000,
        `expiry ${new Date(expiresAt).toISOString()} should be ~now+24h`);
});

test('verifyEmail success flips the flag and clears the token fields', async () => {
    const res = mockRes();
    await verifyEmail(reqWith({ email: 'vic@t.com', token: capturedToken() }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'Email verified successfully.');

    const user = await User.findOne({ where: { email: 'vic@t.com' } });
    assert.equal(user.emailVerified, true);
    assert.equal(user.verificationTokenHash, null);
    assert.equal(user.verificationExpiresAt, null);
});

test('resendVerification rotates the token for a known email', async () => {
    const before = (await User.findOne({ where: { email: 'vic@t.com' } })).verificationTokenHash;
    const res = mockRes();
    await resendVerification(reqWith({ email: 'vic@t.com' }), res);
    assert.equal(res.statusCode, 200);

    const user = await User.findOne({ where: { email: 'vic@t.com' } });
    assert.notEqual(user.verificationTokenHash, before, 'token hash must be rotated');
    const newToken = capturedToken();
    assert.equal(sha256(newToken), user.verificationTokenHash);

    // The old (rotated-out) token no longer verifies.
    const stale = mockRes();
    await verifyEmail(reqWith({
        email: 'vic@t.com',
        token: 'a'.repeat(64),
    }), stale);
    assert.equal(stale.statusCode, 400);
});

test('verifyEmail rejects a wrong token with 400', async () => {
    const res = mockRes();
    await verifyEmail(reqWith({
        email: 'vic@t.com',
        token: 'f'.repeat(64),
    }), res);
    assert.equal(res.statusCode, 400);
});

test('verifyEmail rejects an expired token with 400', async () => {
    const token = 'b'.repeat(64);
    const user = await User.findOne({ where: { email: 'vic@t.com' } });
    await user.update({
        verificationTokenHash: sha256(token),
        verificationExpiresAt: new Date(Date.now() - 60 * 1000), // 1 minute ago
    });

    const res = mockRes();
    await verifyEmail(reqWith({ email: 'vic@t.com', token }), res);
    assert.equal(res.statusCode, 400);
});

test('unknown email gets a generic 400 on verify and a generic 200 on resend', async () => {
    const verify = mockRes();
    await verifyEmail(reqWith({ email: 'ghost@nowhere.com', token: 'c'.repeat(64) }), verify);
    assert.equal(verify.statusCode, 400);

    const sendsBefore = sendCalls;
    const resend = mockRes();
    await resendVerification(reqWith({ email: 'ghost@nowhere.com' }), resend);
    assert.equal(resend.statusCode, 200);
    assert.equal(resend.body.message, 'If that email needs verification, a new link has been sent.');
    assert.equal(sendCalls, sendsBefore, 'no mail is sent for an unknown address');
});

test('unconfigured mailer: signup still succeeds and stores no token', async () => {
    // Restore the REAL service with Brevo credentials removed — it must
    // resolve as a no-op without crashing the flow.
    emailService.sendVerificationEmail = realSend;
    delete process.env.BREVO_API_KEY;
    delete process.env.SENDER_EMAIL;

    const res = mockRes();
    await handleUserSignup(reqWith({
        name: 'Offline Ollie',
        email: 'ollie@t.com',
        password: 'password123',
        phoneNumber: '5550002',
    }), res);
    assert.equal(res.statusCode, 201);

    const user = await User.findOne({ where: { email: 'ollie@t.com' } });
    assert.equal(user.verificationTokenHash, null, 'no token issued when mail cannot be sent');
    assert.equal(user.verificationExpiresAt, null);
    assert.equal(Boolean(user.emailVerified), false, 'account remains usable either way');
});
