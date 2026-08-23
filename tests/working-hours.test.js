const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const StaffServices = require('../models/StaffServices');
const User = require('../models/userModel');
const Appointment = require('../models/appointmentModel');

// Stub the Cashfree gateway BEFORE paymentController is required — the
// controller destructures createOrder at module load. Counts calls so the
// closed-day payment test can prove the gateway was never touched.
const cashfree = require('../services/cashfreeServices');
let orderCalls = 0;
cashfree.createOrder = async () => {
    orderCalls += 1;
    return 'stub-session-id';
};
const { processPayment } = require('../controllers/paymentController');

const { appointmentChecker, rescheduleAppointment } = require('../controllers/appointmentController');
const {
    validateSalonHours,
    parseWeeklyHours,
    getEffectiveWeeklyHours,
} = require('../services/availabilityService');
const { getHours, updateHours } = require('../controllers/salonWorkingHoursController');
const { validate, weeklyHoursSchema } = require('../utils/validators');

// Minimal req/res stubs for invoking the controllers directly.
const mockReq = (overrides = {}) => ({ user: {}, query: {}, params: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// Run weeklyHoursSchema validation middleware against a body; returns the
// next(err) error (null when the middleware passed) plus pass/fail.
const runMw = (body) => {
    let err = null;
    let ok = false;
    validate(weeklyHoursSchema)(mockReq({ body }), {}, (e) => { if (e) err = e; else ok = true; });
    return { err, ok };
};

// Local-time helpers — date strings are compared/parsed as local calendar
// days everywhere downstream (validateSalonHours, reschedule).
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Next occurrence of weekday n (0=Sun..6=Sat), pushed out a further week so
// fixtures are always >24h away regardless of run time.
const nextDow = (n) => {
    const d = new Date();
    do { d.setDate(d.getDate() + 1); } while (d.getDay() !== n);
    d.setDate(d.getDate() + 7);
    return ymd(d);
};

// Canonical schedule used across tests: Sunday closed, Monday a narrow
// 10:00–12:00 window, Tue–Sat 09:00–17:00. The salon's LEGACY columns stay
// wide open all week 08:00–20:00, so any enforcement that fires proves the
// weekly schedule overrides them (not just re-testing the old gate).
const WH_SCHEDULE = {
    0: { open: '08:00', close: '20:00', closed: true },
    1: { open: '10:00', close: '12:00', closed: false },
    2: { open: '09:00', close: '17:00', closed: false },
    3: { open: '09:00', close: '17:00', closed: false },
    4: { open: '09:00', close: '17:00', closed: false },
    5: { open: '09:00', close: '17:00', closed: false },
    6: { open: '09:00', close: '17:00', closed: false },
};
const fullBody = () => ({ weeklyHours: JSON.parse(JSON.stringify(WH_SCHEDULE)) });

let whSalon, legacySalon, editorSalon, corruptSalon;
let whService, whStaff, customer;

before(async () => {
    await sequelize.sync({ force: true });

    whSalon = await Salons.create({
        name: 'HoursWH', email: 'wh@t.com', password: 'x', phoneNumber: '1', address: 'a', pricing: 'Moderate',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
        openingTime: '08:00', closingTime: '20:00',
        weeklyHours: JSON.stringify(WH_SCHEDULE), // preset directly for enforcement tests
    });
    // Legacy salon: weeklyHours stays NULL → must behave exactly like before
    // this feature (default workingDays are Mon-Sat, 09:00–20:00 window).
    legacySalon = await Salons.create({
        name: 'HoursLegacy', email: 'lg@t.com', password: 'x', phoneNumber: '2', address: 'b', pricing: 'Premium',
        openingTime: '09:00', closingTime: '17:00',
    });
    // Salon driven through the GET/PUT endpoints; starts with no schedule.
    editorSalon = await Salons.create({
        name: 'HoursEditor', email: 'ed@t.com', password: 'x', phoneNumber: '3', address: 'c', pricing: 'Affordable',
        workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
        openingTime: '08:30', closingTime: '18:30',
    });
    // Hand-corrupted column value — must degrade to legacy, never throw.
    corruptSalon = await Salons.create({
        name: 'HoursCorrupt', email: 'co@t.com', password: 'x', phoneNumber: '4', address: 'd', pricing: 'Moderate',
        openingTime: '09:00', closingTime: '17:00',
        weeklyHours: '{"0":{"open":"09:00"', // truncated JSON
    });

    whService = await Services.create({ name: 'Cut WH', price: 100, duration: 30, salonId: whSalon.id });
    whStaff = await Staff.create({ name: 'SWH', email: 'swh@t.com', password: 'x', phoneNumber: '5', salonId: whSalon.id });
    await StaffServices.create({ staffId: whStaff.id, serviceId: whService.id });

    customer = await User.create({
        name: 'Cust', email: 'cust-wh@t.com', password: 'x', phoneNumber: '5550001111',
    });

    // A confirmed booking far in the future at the weekly-hours salon, so it
    // passes canReschedule and only the closed-day gate can stop the move.
    await Appointment.create({
        staffId: whStaff.id, salonId: whSalon.id, serviceId: whService.id, userId: customer.id,
        date: ymd(new Date(Date.now() + 8 * 24 * 3600 * 1000)),
        time: '11:30', endTime: '12:00', status: 'confirmed',
    });
});

after(async () => { await sequelize.close(); });

// ── weeklyHoursSchema middleware (invoked directly, like gallery/promos) ──

test('weeklyHoursSchema accepts a full canonical payload unchanged', () => {
    const body = fullBody();
    const { err, ok } = runMw(body);
    assert.equal(err, null);
    assert.ok(ok);
});

test('weeklyHoursSchema rejects a missing day with 400', () => {
    const body = fullBody();
    delete body.weeklyHours[3];
    const { err, ok } = runMw(body);
    assert.equal(ok, false);
    assert.equal(err.status, 400);
    assert.match(err.message, /expected/i); // zod's missing-key shape
});

test('weeklyHoursSchema rejects open>=close on an open day with 400', () => {
    for (const [open, close] of [['17:00', '09:00'], ['12:00', '12:00']]) {
        const body = fullBody();
        body.weeklyHours[2] = { open, close, closed: false };
        const { err, ok } = runMw(body);
        assert.equal(ok, false, `expected rejection for ${open}-${close}`);
        assert.equal(err.status, 400);
        assert.match(err.message, /after opening time/i);
    }
});

test('weeklyHoursSchema rejects bad time formats with 400', () => {
    for (const bad of ['9:00', '24:00', '12:60', '0900', '', '12:00pm']) {
        const body = fullBody();
        body.weeklyHours[4] = { open: bad, close: '17:00', closed: false };
        const { err, ok } = runMw(body);
        assert.equal(ok, false, `expected rejection for open=${JSON.stringify(bad)}`);
        assert.equal(err.status, 400);
        assert.match(err.message, /HH:mm/i);
    }
});

test('weeklyHoursSchema rejects a non-closed day missing its times with 400', () => {
    const body = fullBody();
    body.weeklyHours[5] = { closed: false }; // no open/close
    const { err, ok } = runMw(body);
    assert.equal(ok, false);
    assert.equal(err.status, 400);
    assert.match(err.message, /open time is required/i);

    const half = fullBody(); // one bound present is still incomplete
    half.weeklyHours[5] = { open: '09:00', closed: false };
    const { ok: ok2, err: err2 } = runMw(half);
    assert.equal(ok2, false);
    assert.match(err2.message, /close time is required/i);
});

test('weeklyHoursSchema tolerates omitted times on CLOSED days and non-boolean closed fails', () => {
    const body = fullBody();
    body.weeklyHours[0] = { closed: true }; // times ignored on closed days
    const { err, ok } = runMw(body);
    assert.equal(err, null);
    assert.ok(ok);

    const bad = fullBody();
    bad.weeklyHours[0] = { open: '08:00', close: '20:00', closed: 'yes' };
    const r = runMw(bad);
    assert.equal(r.ok, false);
    assert.equal(r.err.status, 400);
    assert.match(r.err.message, /closed must be/i);
});

// ── GET /hours — merged 7-day defaults when the column is NULL ───────────

test('GET hours returns merged 7-day defaults when weeklyHours is null', async () => {
    const res = mockRes();
    await getHours(mockReq({ user: { role: 'salon', salonId: editorSalon.id } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.salonId, editorSalon.id);

    const wh = res.body.weeklyHours;
    assert.deepEqual(Object.keys(wh).sort(), ['0', '1', '2', '3', '4', '5', '6']);
    for (let i = 0; i < 7; i++) {
        // Defaults derive from the legacy single-window columns: Mon-Sat
        // workingDays → Sunday closed, everyone else 08:30–18:30.
        assert.deepEqual(wh[String(i)], i === 0
            ? { open: '08:30', close: '18:30', closed: true }
            : { open: '08:30', close: '18:30', closed: false });
    }
});

// ── PUT /hours round-trip ────────────────────────────────────────────────

test('PUT then GET hours round-trips the canonical form to the DB row', async () => {
    const putRes = mockRes();
    const body = fullBody();
    body.weeklyHours[6] = { open: '10:00', close: '16:00', closed: false };
    await updateHours(mockReq({ user: { role: 'salon', salonId: editorSalon.id }, body }), putRes);
    assert.equal(putRes.statusCode, 200);
    assert.deepEqual(putRes.body.weeklyHours, body.weeklyHours);

    // Really persisted, byte-for-byte the canonical object.
    await editorSalon.reload();
    assert.deepEqual(JSON.parse(editorSalon.weeklyHours), body.weeklyHours);

    // And read back verbatim through GET (no defaults bleeding in).
    const getRes = mockRes();
    await getHours(mockReq({ user: { role: 'salon', salonId: editorSalon.id } }), getRes);
    assert.equal(getRes.statusCode, 200);
    assert.deepEqual(getRes.body.weeklyHours, body.weeklyHours);
});

// ── Enforcement: availability checker ────────────────────────────────────

test('checker blocks a booking on a day the weekly schedule closes', async () => {
    const res = mockRes();
    await appointmentChecker(mockReq({
        body: {
            dateSelect: nextDow(0), // Sunday — closed:true
            time: '11:00', salonId: whSalon.id, serviceId: whService.id, duration: 30,
        },
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Salon is closed on Sunday');
});

test('checker blocks outside the per-day window even when inside the legacy window', async () => {
    // Monday 14:00 sits inside the LEGACY 08:00–20:00 window but outside this
    // Monday's weekly 10:00–12:00 — proving the weekly schedule governs.
    const res = mockRes();
    await appointmentChecker(mockReq({
        body: {
            dateSelect: nextDow(1),
            time: '14:00', salonId: whSalon.id, serviceId: whService.id, duration: 30,
        },
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Outside working hours');

    // Ending past closing is the same story (10:45 + 30min ends 11:15? no —
    // use 11:45 → ends 12:15 > 12:00).
    const res2 = mockRes();
    await appointmentChecker(mockReq({
        body: {
            dateSelect: nextDow(1),
            time: '11:45', salonId: whSalon.id, serviceId: whService.id, duration: 30,
        },
    }), res2);
    assert.equal(res2.statusCode, 400);
    assert.equal(res2.body.message, 'Outside working hours');
});

test('checker still succeeds within the weekly window; existing fields intact plus informational weeklyHours', async () => {
    const res = mockRes();
    await appointmentChecker(mockReq({
        body: {
            dateSelect: nextDow(1),
            time: '11:00', salonId: whSalon.id, serviceId: whService.id, duration: 30,
        },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.availableStaff.length, 1); // pre-existing field
    assert.equal(typeof res.body.slotStepMinutes, 'number'); // pre-existing field
    // New informational field: full merged schedule.
    assert.deepEqual(Object.keys(res.body.weeklyHours).length, 7);
    assert.equal(res.body.weeklyHours['0'].closed, true);
    assert.equal(res.body.weeklyHours['1'].open, '10:00');
});

// ── Enforcement: payment path (checker bypass attempt) ───────────────────

test('payment path blocks a closed-day order without ever calling the gateway', async () => {
    const beforeCalls = orderCalls;
    const res = mockRes();
    await processPayment(mockReq({
        user: { userId: customer.id },
        body: {
            serviceId: whService.id, salonId: whSalon.id, duration: 30,
            dateSelect: nextDow(0), // Sunday — closed
            time: '11:00', staffId: whStaff.id,
        },
    }), res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Salon is closed on Sunday');
    assert.equal(orderCalls, beforeCalls, 'Cashfree.createOrder must never fire on a blocked slot');
});

test('payment path also blocks outside-window slots', async () => {
    const res = mockRes();
    await processPayment(mockReq({
        user: { userId: customer.id },
        body: {
            serviceId: whService.id, salonId: whSalon.id, duration: 30,
            dateSelect: nextDow(1), // Monday 14:00 outside 10:00–12:00
            time: '14:00', staffId: whStaff.id,
        },
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Outside working hours');
});

// ── Enforcement: reschedule ──────────────────────────────────────────────

test('reschedule into a closed day is blocked and the booking stays untouched', async () => {
    const appt = await Appointment.findOne({ where: { salonId: whSalon.id, status: 'confirmed' } });
    const original = { date: appt.date, time: appt.time };

    const res = mockRes();
    await rescheduleAppointment(mockReq({
        params: { appointmentId: String(appt.id) },
        user: { userId: customer.id },
        body: { dateSelect: nextDow(0), time: '11:00' }, // Sunday — closed
    }), res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Salon is closed on Sunday');
    await appt.reload();
    assert.equal(appt.date, original.date); // untouched
    assert.equal(appt.time, original.time);
});

// ── NULL/corrupt column preserves legacy behavior exactly ────────────────

test('parseWeeklyHours never throws and degrades garbage to null', () => {
    assert.equal(parseWeeklyHours(null), null);
    assert.equal(parseWeeklyHours(undefined), null);
    assert.equal(parseWeeklyHours(''), null);
    assert.equal(parseWeeklyHours('not-json'), null);
    assert.equal(parseWeeklyHours('[1,2,3]'), null);
    assert.equal(parseWeeklyHours('{}'), null); // partial map
    assert.equal(parseWeeklyHours('{"0":{'), null); // malformed JSON
    // Open day with misordered times → unusable → null (hand-edited rows).
    const bad = JSON.parse(JSON.stringify(WH_SCHEDULE));
    bad[3] = { open: '17:00', close: '09:00', closed: false };
    assert.equal(parseWeeklyHours(JSON.stringify(bad)), null);

    // Valid input normalizes to a 7-entry map; unknown junk inside entries
    // is dropped; closed days may omit times.
    assert.deepEqual(
        Object.keys(parseWeeklyHours(JSON.stringify(WH_SCHEDULE))).length, 7
    );
});

test('validateSalonHours keeps byte-identical legacy messages when weeklyHours is null', () => {
    const sunday = nextDow(0), monday = nextDow(1);
    // Default workingDays (Mon-Sat): Sunday rejected by the legacy branch.
    assert.deepEqual(
        validateSalonHours(legacySalon, sunday, '10:00', '10:30'),
        { ok: false, reason: 'The salon is closed on this day' }
    );
    assert.deepEqual(
        validateSalonHours(legacySalon, monday, '07:00', '07:30'),
        { ok: false, reason: 'This salon opens at 09:00' }
    );
    assert.deepEqual(
        validateSalonHours(legacySalon, monday, '16:45', '17:30'),
        { ok: false, reason: 'This salon closes at 17:00' }
    );
    assert.deepEqual(validateSalonHours(legacySalon, monday, '10:00', '10:30'), { ok: true });
});

test('a corrupted weeklyHours value degrades to legacy behavior instead of erroring', async () => {
    await corruptSalon.reload();
    assert.equal(parseWeeklyHours(corruptSalon.weeklyHours), null);
    const monday = nextDow(1);
    assert.deepEqual(validateSalonHours(corruptSalon, monday, '10:00', '10:30'), { ok: true });
    assert.deepEqual(
        validateSalonHours(corruptSalon, monday, '07:00', '07:30'),
        { ok: false, reason: 'This salon opens at 09:00' }
    );
});

test('getEffectiveWeeklyHours merges stored overrides over legacy defaults', () => {
    // Full 7-day map (the only shape parseWeeklyHours accepts) where Monday
    // is closed WITHOUT times — enforcement ignores them, but display still
    // needs bounds, which the merge fills in from the legacy defaults.
    const partial = JSON.parse(JSON.stringify(WH_SCHEDULE));
    partial['1'] = { closed: true };

    const salonRow = { weeklyHours: JSON.stringify(partial), openingTime: '08:30', closingTime: '18:30', workingDays: [] };
    const eff = getEffectiveWeeklyHours(salonRow);

    assert.deepEqual(Object.keys(eff).sort(), ['0', '1', '2', '3', '4', '5', '6']);
    assert.equal(eff['1'].closed, true);
    assert.equal(eff['1'].open, '08:30'); // display fallback from defaults
    assert.equal(eff['0'].closed, true); // stored Sunday closure preserved
    for (const k of ['2', '3', '4', '5', '6']) {
        assert.deepEqual(eff[k], { open: '09:00', close: '17:00', closed: false });
    }

    // A PARTIAL stored map is unusable by design → pure defaults.
    const halfMap = { '1': { closed: true } };
    const def = getEffectiveWeeklyHours({ weeklyHours: JSON.stringify(halfMap), openingTime: '08:30', closingTime: '18:30', workingDays: null });
    for (let i = 0; i < 7; i++) {
        assert.deepEqual(def[String(i)], { open: '08:30', close: '18:30', closed: false });
    }

    // Corrupt raw column → pure defaults too.
    const corrupt = getEffectiveWeeklyHours({ weeklyHours: 'garbage{', openingTime: '08:30', closingTime: '18:30', workingDays: null });
    assert.equal(corrupt['4'].open, '08:30');
});
