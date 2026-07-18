const { test } = require('node:test');
const assert = require('node:assert');
const { canTransition, canCancel, CANCEL_WINDOW_HOURS } = require('../utils/statusRules');

test('canTransition: legal transitions return true', () => {
    assert.equal(canTransition('pending', 'confirmed'), true);
    assert.equal(canTransition('pending', 'declined'), true);
    assert.equal(canTransition('confirmed', 'completed'), true);
    assert.equal(canTransition('confirmed', 'cancelled'), true);
    assert.equal(canTransition('pending', 'cancelled'), true);
});

test('canTransition: illegal transitions return false', () => {
    assert.equal(canTransition('completed', 'cancelled'), false);
    assert.equal(canTransition('declined', 'confirmed'), false);
    assert.equal(canTransition('cancelled', 'confirmed'), false);
    assert.equal(canTransition('completed', 'pending'), false);
});

test('canTransition: same-status is false (no-op not allowed)', () => {
    assert.equal(canTransition('confirmed', 'confirmed'), false);
});

test('canCancel: cancellable when >24h before start', () => {
    const future = new Date(Date.now() + (CANCEL_WINDOW_HOURS + 2) * 3600 * 1000);
    assert.equal(canCancel('confirmed', future), true);
    assert.equal(canCancel('pending', future), true);
});

test('canCancel: blocked when within 24h of start', () => {
    const soon = new Date(Date.now() + 2 * 3600 * 1000); // 2h away
    assert.equal(canCancel('confirmed', soon), false);
});

test('canCancel: blocked for non-cancellable statuses', () => {
    const future = new Date(Date.now() + (CANCEL_WINDOW_HOURS + 2) * 3600 * 1000);
    assert.equal(canCancel('completed', future), false);
    assert.equal(canCancel('cancelled', future), false);
    assert.equal(canCancel('declined', future), false);
});

test('canCancel: exactly on the boundary is blocked (not > 24h)', () => {
    const onBoundary = new Date(Date.now() + CANCEL_WINDOW_HOURS * 3600 * 1000);
    assert.equal(canCancel('confirmed', onBoundary), false);
});
