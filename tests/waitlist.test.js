const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Appointment = require('../models/appointmentModel');
const Waitlist = require('../models/waitlistModel');
const Notification = require('../models/notificationModel');
const {
    joinWaitlist,
    getMyWaitlist,
    leaveWaitlist,
    getSalonDayWaitlist,
} = require('../controllers/waitlistController');
const { cancelAppointment } = require('../controllers/appointmentController');
const { validate, waitlistJoinSchema, waitlistDateSchema } = require('../utils/validators');

// Minimal req/res stubs for invoking the controllers directly.
const mockReq = (overrides = {}) => ({ user: {}, params: {}, query: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// Run a zod schema's validation middleware against a payload; returns the
// next(err) error (null when it passed) plus pass/fail.
const runMw = (schema, payload, source = 'body') => {
    let err = null;
    let ok = false;
    validate(schema, source)(
        source === 'query' ? { query: payload } : { body: payload },
        {},
        (e) => { if (e) err = e; else ok = true; }
    );
    return { err, ok };
};

// The cancel->waitlist notify chain is fire-and-forget; poll briefly.
const waitFor = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await fn();
        if (result) return result;
        await new Promise((r) => setTimeout(r, 25));
    }
    return await fn();
};

// Backdate a row's createdAt so "oldest first" is deterministic even when
// inserts land in the same millisecond.
const backdate = (row, minutesAgo) =>
    Waitlist.update(
        { createdAt: new Date(Date.now() - minutesAgo * 60 * 1000) },
        { where: { id: row.id } }
    );

let custA, custB, salonA, salonB, salonClosed;
let serviceA, staffA;

before(async () => {
    await sequelize.sync({ force: true });
    custA = await User.create({ name: 'CustA', email: 'wa@t.com', password: 'x', phoneNumber: '1' });
    custB = await User.create({ name: 'CustB', email: 'wb@t.com', password: 'x', phoneNumber: '2' });
    salonA = await Salons.create({ name: 'BusySalonA', email: 'sa@t.com', password: 'x', phoneNumber: '3', address: 'a', pricing: 'Moderate' });
    salonB = await Salons.create({ name: 'QuietSalonB', email: 'sb@t.com', password: 'x', phoneNumber: '4', address: 'b', pricing: 'Premium' });
    salonClosed = await Salons.create({ name: 'ClosedSalon', email: 'sc@t.com', password: 'x', phoneNumber: '5', address: 'c', pricing: 'Moderate', statusbar: 'inactive' });
    staffA = await Staff.create({ name: 'StylistW', email: 'stw@t.com', password: 'x', phoneNumber: '6', salonId: salonA.id });
    serviceA = await Services.create({ name: 'CutW', price: 100, duration: 30, salonId: salonA.id });
});

after(async () => { await sequelize.close(); });

// ---------- Schema middleware (tested directly, like the gallery suite) ----

test('waitlistJoinSchema rejects garbage salonIds with 400', () => {
    for (const bad of [0, -5, 'abc', null]) {
        const { err, ok } = runMw(waitlistJoinSchema, { salonId: bad, date: '2099-01-01' });
        assert.equal(ok, false, `expected rejection for ${JSON.stringify(bad)}`);
        assert.equal(err.status, 400);
    }
});

test('waitlistJoinSchema rejects malformed dates with 400', () => {
    for (const bad of ['01/02/2026', '2026-1-2', '', 'not-a-date']) {
        const { err, ok } = runMw(waitlistJoinSchema, { salonId: 1, date: bad });
        assert.equal(ok, false, `expected rejection for ${JSON.stringify(bad)}`);
        assert.equal(err.status, 400);
        assert.match(err.message, /date must be YYYY-MM-DD/i);
    }
});

test('waitlistJoinSchema rejects past dates with 400 (today-or-later)', () => {
    const { err, ok } = runMw(waitlistJoinSchema, { salonId: 1, date: '2020-01-01' });
    assert.equal(ok, false);
    assert.equal(err.status, 400);
    assert.equal(err.message, 'Waitlist date must be today or later');
});

test('waitlistJoinSchema rejects out-of-range/non-integer partySize with 400', () => {
    for (const bad of [0, 21, -1, 2.5, 'lots']) {
        const { err, ok } = runMw(waitlistJoinSchema, { salonId: 1, date: '2099-01-01', partySize: bad });
        assert.equal(ok, false, `expected rejection for ${JSON.stringify(bad)}`);
        assert.equal(err.status, 400);
    }
});

test('waitlistJoinSchema coerces ids/partySize and defaults partySize to 1', () => {
    const { ok } = runMw(waitlistJoinSchema, { salonId: '7', date: '2099-01-01' });
    assert.equal(ok, true);
    const parsed = waitlistJoinSchema.parse({ salonId: '7', date: '2099-01-01' });
    assert.equal(parsed.salonId, 7);
    assert.equal(parsed.partySize, 1); // omitted -> explicit default
});

test('waitlistDateSchema requires a well-formed date (query middleware)', () => {
    assert.equal(runMw(waitlistDateSchema, {}, 'query').ok, false); // missing
    assert.equal(runMw(waitlistDateSchema, { date: 'tomorrow' }, 'query').ok, false);
    const good = runMw(waitlistDateSchema, { date: '2099-01-01' }, 'query');
    assert.equal(good.ok, true);
});

// ---------- Join ----------

let d1Row; // custA @ salonA on D1

test('join happy path: 201 with row fields (token userId, waiting, default partySize)', async () => {
    const date = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const res = mockRes();
    await joinWaitlist(mockReq({
        user: { role: 'customer', userId: custA.id },
        body: { salonId: salonA.id, date },
    }), res);
    assert.equal(res.statusCode, 201);
    d1Row = res.body;
    assert.ok(d1Row.id);
    assert.equal(Number(d1Row.userId), Number(custA.id)); // taken from the token, never the body
    assert.equal(Number(d1Row.salonId), Number(salonA.id));
    assert.equal(d1Row.date, date);
    assert.equal(d1Row.partySize, 1); // defaulted
    assert.equal(d1Row.status, 'waiting');
    assert.equal(d1Row.notifiedAt, null);

    // Explicit partySize persists too.
    const res2 = mockRes();
    await joinWaitlist(mockReq({
        user: { role: 'customer', userId: custA.id },
        body: { salonId: salonA.id, date: new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 10), partySize: 4 },
    }), res2);
    assert.equal(res2.statusCode, 201);
    assert.equal(res2.body.partySize, 4);
});

test('duplicate ACTIVE entry (same user+salon+date, waiting) -> 409', async () => {
    const res = mockRes();
    await joinWaitlist(mockReq({
        user: { role: 'customer', userId: custA.id },
        body: { salonId: salonA.id, date: d1Row.date },
    }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.message, 'Already on the waitlist');
});

test('another customer CAN join the same salon+date; rejoin after leaving is allowed', async () => {
    // Different user, identical salon+date -> fine.
    const res = mockRes();
    await joinWaitlist(mockReq({
        user: { role: 'customer', userId: custB.id },
        body: { salonId: salonA.id, date: d1Row.date },
    }), res);
    assert.equal(res.statusCode, 201);
    const bRow = res.body;

    // Soft-leave it...
    const del = mockRes();
    await leaveWaitlist(mockReq({ params: { id: String(bRow.id) }, user: { role: 'customer', userId: custB.id } }), del);
    assert.equal(del.statusCode, 200);
    await bRow.reload();
    assert.equal(bRow.status, 'left');

    // ...and rejoining the same day gets a FRESH queue position (201).
    const rejoin = mockRes();
    await joinWaitlist(mockReq({
        user: { role: 'customer', userId: custB.id },
        body: { salonId: salonA.id, date: d1Row.date },
    }), rejoin);
    assert.equal(rejoin.statusCode, 201);
    assert.notEqual(Number(rejoin.body.id), Number(bRow.id)); // new row, old kept
    assert.equal(rejoin.body.status, 'waiting');
});

test('unknown salon -> 404; inactive salon -> 404 (takes no more names)', async () => {
    const unknown = mockRes();
    await joinWaitlist(mockReq({
        user: { role: 'customer', userId: custA.id },
        body: { salonId: 999999, date: d1Row.date },
    }), unknown);
    assert.equal(unknown.statusCode, 404);
    assert.equal(unknown.body.message, 'Salon not found');

    const inactive = mockRes();
    await joinWaitlist(mockReq({
        user: { role: 'customer', userId: custA.id },
        body: { salonId: salonClosed.id, date: d1Row.date },
    }), inactive);
    assert.equal(inactive.statusCode, 404);
});

test('past date through the controller directly -> 400 with the documented message', async () => {
    const res = mockRes();
    await joinWaitlist(mockReq({
        user: { role: 'customer', userId: custA.id },
        body: { salonId: salonA.id, date: '2020-01-01' },
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Waitlist date must be today or later');
});

// ---------- Customer listing ----------

test('GET /waitlist: legacy bare array, own rows only, newest first', async () => {
    // Backdate the first join so newest-first ordering is unambiguous.
    await backdate(d1Row, 120);
    const res = mockRes();
    await getMyWaitlist(mockReq({ query: {}, user: { role: 'customer', userId: custA.id } }), res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    // custA joined twice (D1 default + D2 partySize 4); nobody else's rows leak in.
    assert.equal(res.body.length, 2);
    assert.ok(res.body.every((r) => Number(r.userId) === Number(custA.id)));
    assert.equal(Number(res.body[0].id) > Number(res.body[1].id), true); // newest first
});

test('GET /waitlist?page=&limit=: envelope with correct meta', async () => {
    const res = mockRes();
    await getMyWaitlist(mockReq({ query: { page: '1', limit: '1' }, user: { role: 'customer', userId: custA.id } }), res);
    assert.ok(!Array.isArray(res.body));
    assert.equal(res.body.data.length, 1);
    assert.deepEqual(
        { page: res.body.page, limit: res.body.limit, total: res.body.total, totalPages: res.body.totalPages },
        { page: 1, limit: 1, total: 2, totalPages: 2 }
    );
});

// ---------- Leave ----------

test('DELETE own row soft-leaves (status=left, row kept); idempotent', async () => {
    const target = await Waitlist.findOne({ where: { userId: custA.id, status: 'waiting' }, order: [['id', 'DESC']] });
    const res = mockRes();
    await leaveWaitlist(mockReq({ params: { id: String(target.id) }, user: { role: 'customer', userId: custA.id } }), res);
    assert.equal(res.statusCode, 200);
    await target.reload();
    assert.equal(target.status, 'left'); // still there, just marked

    const again = mockRes(); // leaving an already-left own row stays 200
    await leaveWaitlist(mockReq({ params: { id: String(target.id) }, user: { role: 'customer', userId: custA.id } }), again);
    assert.equal(again.statusCode, 200);
});

test("DELETE someone else's row -> 404 and untouched; unknown id -> 404", async () => {
    const theirs = await Waitlist.findOne({ where: { userId: custB.id, status: 'waiting' } });
    const res = mockRes();
    await leaveWaitlist(mockReq({ params: { id: String(theirs.id) }, user: { role: 'customer', userId: custA.id } }), res);
    assert.equal(res.statusCode, 404);
    await theirs.reload();
    assert.equal(theirs.status, 'waiting');

    const unknown = mockRes();
    await leaveWaitlist(mockReq({ params: { id: '999999' }, user: { role: 'customer', userId: custA.id } }), unknown);
    assert.equal(unknown.statusCode, 404);
});

// ---------- Cancel hook: opening alerts ----------

// Creates a cancellable future appointment (>24h out, confirmed).
const futureAppt = (customer, daysOut, partySize, dateOverride) => Appointment.create({
    staffId: staffA.id,
    salonId: salonA.id,
    serviceId: serviceA.id,
    userId: customer.id,
    date: dateOverride || new Date(Date.now() + daysOut * 24 * 3600 * 1000).toISOString().slice(0, 10),
    time: '12:00',
    endTime: '12:30',
    status: 'confirmed',
    partySize,
});

test('cancellation notifies the OLDEST matching waiter (flip + notification row)', async () => {
    const appt = await futureAppt(custA, 3, 2); // frees a 2-person capacity on its date
    // Two eligible waiters for salonA on THAT date: wOld queued first.
    const wOld = await Waitlist.create({ salonId: salonA.id, userId: custB.id, date: appt.date, partySize: 1 });
    const wNew = await Waitlist.create({ salonId: salonA.id, userId: custA.id, date: appt.date, partySize: 1 });
    await backdate(wOld, 60);

    const res = mockRes();
    await cancelAppointment(mockReq({ params: { appointmentId: String(appt.id) }, user: { role: 'customer', userId: custA.id } }), res);
    assert.equal(res.statusCode, 200);

    // Oldest entry claimed: status flipped + stamped.
    const notified = await waitFor(() => Waitlist.findByPk(wOld.id).then((r) => (r.status === 'notified' ? r : null)));
    assert.ok(notified, 'oldest waiting entry was notified');
    assert.ok(notified.notifiedAt, 'notifiedAt was stamped');
    await wNew.reload();
    assert.equal(wNew.status, 'waiting'); // the younger entry waits its turn
    assert.equal(wNew.notifiedAt, null);

    // The CUSTOMER behind the entry got the in-app alert, polled async.
    const found = await waitFor(() => Notification.findOne({
        where: { recipientRole: 'customer', recipientId: custB.id, type: 'waitlist.opening' },
    }));
    assert.ok(found, 'waitlist.opening notification was created');
    assert.equal(found.title, 'A slot opened up');
    assert.match(found.body, new RegExp(salonA.name));
    assert.match(found.body, new RegExp(appt.date));
});

test('too-large parties are skipped: next ELIGIBLE entry gets the small freed slot', async () => {
    const appt = await futureAppt(custA, 4, 2); // frees only a 2-top
    const bigFirst = await Waitlist.create({ salonId: salonA.id, userId: custB.id, date: appt.date, partySize: 5 }); // older but doesn't fit
    const fitsSecond = await Waitlist.create({ salonId: salonA.id, userId: custA.id, date: appt.date, partySize: 2 });
    await backdate(bigFirst, 60);

    const res = mockRes();
    await cancelAppointment(mockReq({ params: { appointmentId: String(appt.id) }, user: { role: 'customer', userId: custA.id } }), res);
    assert.equal(res.statusCode, 200);

    const claimed = await waitFor(() => Waitlist.findByPk(fitsSecond.id).then((r) => (r.status === 'notified' ? r : null)));
    assert.ok(claimed, 'the fitting (younger) entry was notified');
    await bigFirst.reload();
    assert.equal(bigFirst.status, 'waiting'); // skipped, NOT blocked, still queued
    assert.equal(bigFirst.notifiedAt, null);
});

test('a cancellation on another date leaves that date\u2019s waiters untouched', async () => {
    const appt = await futureAppt(custA, 5, 2);
    const otherDay = new Date(new Date(appt.date).getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const wrongDay = await Waitlist.create({ salonId: salonA.id, userId: custB.id, date: otherDay, partySize: 1 });

    const openingsBefore = await Notification.count({ where: { type: 'waitlist.opening' } });
    const res = mockRes();
    await cancelAppointment(mockReq({ params: { appointmentId: String(appt.id) }, user: { role: 'customer', userId: custA.id } }), res);
    assert.equal(res.statusCode, 200);

    await wrongDay.reload();
    assert.equal(wrongDay.status, 'waiting');
    assert.equal(wrongDay.notifiedAt, null);
    // Give any (wrong) fire-and-forget hook a beat, then confirm NO new
    // opening alert appeared anywhere.
    await new Promise((r) => setTimeout(r, 250));
    const openingsAfter = await Notification.count({ where: { type: 'waitlist.opening' } });
    assert.equal(openingsAfter, openingsBefore);
});

// ---------- Salon dashboard day sheet ----------

test('salon day sheet: own rows for the date, oldest-first, customer names attached', async () => {
    // Dedicated fixtures with staggered queue positions, on a date NO other
    // test queues for.
    const date = new Date(Date.now() + 240 * 3600 * 1000).toISOString().slice(0, 10);
    const q2 = await Waitlist.create({ salonId: salonA.id, userId: custB.id, date, partySize: 1 });
    const q1 = await Waitlist.create({ salonId: salonA.id, userId: custA.id, date, partySize: 2 });
    await backdate(q1, 90); // q1 is actually the oldest despite insert order

    // A row at ANOTHER salon on the same date — must never leak into salonA.
    const elsewhere = await Waitlist.create({ salonId: salonB.id, userId: custA.id, date, partySize: 1 });

    const res = mockRes();
    await getSalonDayWaitlist(mockReq({ query: { date }, user: { role: 'salon', salonId: salonA.id } }), res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 2); // salonB's row excluded
    assert.deepEqual(res.body.map((r) => r.customerName), ['CustA', 'CustB']); // oldest first
    assert.deepEqual(res.body.map((r) => Number(r.id)), [Number(q1.id), Number(q2.id)]);
    assert.ok(res.body.every((r) => Number(r.salonId) === Number(salonA.id)));

    // Scoping the other way: salonB sees exactly its own row, named.
    const resB = mockRes();
    await getSalonDayWaitlist(mockReq({ query: { date }, user: { role: 'salon', salonId: salonB.id } }), resB);
    assert.equal(resB.statusCode, 200);
    assert.equal(resB.body.length, 1);
    assert.equal(Number(resB.body[0].id), Number(elsewhere.id));
    assert.equal(resB.body[0].customerName, 'CustA');
});

test('salon day sheet: a date with no queue is an empty bare array', async () => {
    const res = mockRes();
    await getSalonDayWaitlist(mockReq({ query: { date: '2098-12-31' }, user: { role: 'salon', salonId: salonA.id } }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, []);
});
