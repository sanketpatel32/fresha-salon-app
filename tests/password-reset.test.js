const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const User = require('../models/userModel');
const { forgotPassword, resetPassword } = require('../controllers/userController');
const emailService = require('../services/emailService');

// Minimal req/res stubs for invoking the controller directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};
const reqWith = (body) => ({ body });

// The controller only persists sha256(token); to tie the DB row back to the
// emailed link we capture the reset link via a stubbed email service.
let capturedLink = null;
const realSend = emailService.sendPasswordResetEmail;
const captureSend = () => {
    emailService.sendPasswordResetEmail = async (ctx) => {
        capturedLink = ctx.resetLink;
        return { sent: true };
    };
};
const capturedToken = () =>
    new URL(capturedLink, 'http://localhost').searchParams.get('token');
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

let customer;

before(async () => {
    await sequelize.sync({ force: true });
    customer = await User.create({
        name: 'Resettable Rita',
        email: 'rita@t.com',
        phoneNumber: '1',
        password: await bcrypt.hash('oldPassword123', 10),
    });
});

after(async () => {
    emailService.sendPasswordResetEmail = realSend;
    await sequelize.close();
});

test('forgotPassword answers generically for an unknown email', async () => {
    const res = mockRes();
    await forgotPassword(reqWith({ email: 'ghost@nowhere.com' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'If that email exists, a reset link has been sent.');
});

test('forgotPassword answers the same generic message for a known email', async () => {
    const res = mockRes();
    await forgotPassword(reqWith({ email: customer.email }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'If that email exists, a reset link has been sent.');
});

test('forgotPassword stores only the hash plus a ~1h expiry', async () => {
    captureSend();
    const started = Date.now() - 1000;
    const res = mockRes();
    await forgotPassword(reqWith({ email: customer.email }), res);
    assert.equal(res.statusCode, 200);

    await customer.reload();
    // 64 hex chars — and never the plaintext token from the link.
    assert.match(customer.resetTokenHash, /^[a-f0-9]{64}$/);
    const token = capturedToken();
    assert.notEqual(token, customer.resetTokenHash);
    assert.equal(sha256(token), customer.resetTokenHash);

    // Expiry sits ~60 minutes ahead of the request.
    const expiresAt = new Date(customer.resetTokenExpiresAt).getTime();
    assert.ok(Math.abs(expiresAt - (started + 60 * 60 * 1000)) < 90 * 1000,
        `expiry ${new Date(expiresAt).toISOString()} should be ~now+60min`);
});

test('resetPassword rejects a wrong token with 400', async () => {
    const res = mockRes();
    await resetPassword(reqWith({
        email: customer.email,
        token: 'a'.repeat(64),
        newPassword: 'brandNewPass123',
    }), res);
    assert.equal(res.statusCode, 400);
});

test('resetPassword rejects an expired token with 400', async () => {
    const token = 'b'.repeat(64);
    await customer.update({
        resetTokenHash: sha256(token),
        resetTokenExpiresAt: new Date(Date.now() - 60 * 1000), // 1 minute ago
    });

    const res = mockRes();
    await resetPassword(reqWith({
        email: customer.email,
        token,
        newPassword: 'anotherPass123',
    }), res);
    assert.equal(res.statusCode, 400);
});

test('resetPassword rotates the password and clears the token fields', async () => {
    // Issue a fresh token through the real controller path first.
    captureSend();
    await forgotPassword(reqWith({ email: customer.email }), mockRes());

    const res = mockRes();
    await resetPassword(reqWith({
        email: customer.email,
        token: capturedToken(),
        newPassword: 'brandNewPass123',
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'Password updated successfully.');

    await customer.reload();
    assert.equal(customer.resetTokenHash, null);
    assert.equal(customer.resetTokenExpiresAt, null);
    assert.equal(await bcrypt.compare('oldPassword123', customer.password), false, 'old password no longer works');
    assert.equal(await bcrypt.compare('brandNewPass123', customer.password), true, 'new password works');
});

test('unconfigured email service must not crash forgotPassword', async () => {
    delete process.env.BREVO_API_KEY;   // .env ships these empty already;
    delete process.env.SENDER_EMAIL;    // deleting makes the no-op explicit.
    emailService.sendPasswordResetEmail = realSend;

    const res = mockRes();
    await forgotPassword(reqWith({ email: customer.email }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'If that email exists, a reset link has been sent.');
});
