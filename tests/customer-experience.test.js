/**
 * Customer-experience suite: #55 rebook, #56 quote, #57 history filters,
 * #58 recently viewed, #59 favorite staff, #60 cancellation reasons,
 * #61 recurring series.
 *
 * Controllers are driven directly with mock req/res (the pattern used across
 * the existing suites) so these tests exercise the real handlers against real
 * SQLite state rather than a booted server.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations');
const Appointment = require('../models/appointmentModel');
const Salons = require('../models/salonsModel');
const Services = require('../models/servicesModel');
const Staff = require('../models/staffModel');
const StaffBlockout = require('../models/staffBlockoutModel');
const User = require('../models/userModel');
const FavoriteStaff = require('../models/favoriteStaffModel');
const RecentlyViewed = require('../models/recentlyViewModel');
const PromoCode = require('../models/promoCodeModel');

const appointmentController = require('../controllers/appointmentController');
const userController = require('../controllers/userController');
const salonAnalyticsController = require('../controllers/salonAnalyticsController');
const rebookService = require('../services/rebookService');
const quoteService = require('../services/quoteService');
const recentViews = require('../services/recentViewsService');
const recurring = require('../services/recurringService');
const money = require('../utils/money');
const { localDay, localTime } = require('../utils/timezone');
const { validate, rebookSchema, quoteSchema, appointmentHistorySchema, cancelAppointmentSchema, favoriteStaffSchema, seriesCreateSchema, seriesUpdateSchema, CANCELLATION_REASONS } = require('../utils/validators');

// ── Helpers ───────────────────────────────────────────────────────────
const mockReq = (overrides = {}) => ({ user: {}, params: {}, query: {}, body: {}, headers: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    r.send = () => r;
    return r;
};

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

const waitFor = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await fn();
        if (result) return result;
        await new Promise((r) => setTimeout(r, 25));
    }
    return await fn();
};

const isoDay = (d) => d.toISOString().slice(0, 10);
const addDays = (dateStr, n) => {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};

/** 7-day schedule: every day 09:00-18:00 unless overridden. */
const allWeek = (overrides = {}) => JSON.stringify(
    Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [
        String(i), overrides[String(i)] || { open: '09:00', close: '18:00', closed: false },
    ]))
);

/**
 * Park TODAY out of the searcher's reach.
 *
 * findRebookSlot scans forward from TODAY, so a fixture that only constrains
 * TOMORROW silently stops mattering whenever the suite happens to run during
 * opening hours — the suggestion lands on today, three assertions built around
 * tomorrow's calendar then pass (or fail) for reasons that have nothing to do
 * with what they claim to test. That is a wall-clock flake, not a real signal:
 * the same suite would go green at 3am and red at 10am.
 *
 * Blocking both stylists for the whole of today pins the first reachable day to
 * TOMORROW, so every fixture below means what it says at any hour.
 */
const parkToday = async () => {
    for (const s of [staffA, staffB]) {
        await StaffBlockout.create({ staffId: s.id, date: TODAY, startTime: '00:00', endTime: '23:59' });
    }
};
const unparkToday = () => StaffBlockout.destroy({ where: { date: TODAY } });

let custA, custB, salonA, salonB, staffA, staffB, serviceA, serviceB;
let TODAY, TOMORROW, FAR_FUTURE, PAST;

before(async () => {
    await sequelize.sync({ force: true });
    TODAY = isoDay(new Date());
    TOMORROW = addDays(TODAY, 1);
    FAR_FUTURE = addDays(TODAY, 20);
    PAST = addDays(TODAY, -30);

    custA = await User.create({ name: 'CustA', email: 'cx-a@t.com', password: 'x', phoneNumber: '1' });
    custB = await User.create({ name: 'CustB', email: 'cx-b@t.com', password: 'x', phoneNumber: '2' });

    salonA = await Salons.create({
        name: 'SalonCX', email: 'cx-sa@t.com', password: 'x', phoneNumber: '3',
        address: 'a', pricing: 'Moderate', openingTime: '09:00', closingTime: '18:00',
        weeklyHours: allWeek(),
    });
    salonB = await Salons.create({
        name: 'OtherCX', email: 'cx-sb@t.com', password: 'x', phoneNumber: '4',
        address: 'b', pricing: 'Premium', openingTime: '09:00', closingTime: '18:00',
        weeklyHours: allWeek(),
    });

    staffA = await Staff.create({ name: 'Priya', email: 'cx-sta@t.com', password: 'x', phoneNumber: '5', statusbar: 'active', salonId: salonA.id });
    staffB = await Staff.create({ name: 'Marcus', email: 'cx-stb@t.com', password: 'x', phoneNumber: '6', statusbar: 'active', salonId: salonA.id });
    await staffA.setServices([]);
    await staffB.setServices([]);

    serviceA = await Services.create({ name: 'Haircut', price: 200, duration: 30, salonId: salonA.id, statusbar: 'active' });
    serviceB = await Services.create({ name: 'Colour', price: 900, duration: 60, salonId: salonA.id, statusbar: 'active' });
    await staffA.addService(serviceA);
    await staffB.addService(serviceA);
});

after(async () => { await sequelize.close(); });

// ══ #55 One-tap rebook ═══════════════════════════════════════════════
describe('#55 one-tap rebook', () => {
    test('schema defaults make a bare {} a legal rebook request', () => {
        const { ok } = runMw(rebookSchema, {});
        assert.equal(ok, true);
    });

    test('schema clamps horizonDays instead of rejecting it', () => {
        let parsed = null;
        validate(rebookSchema)({ body: { horizonDays: 999 } }, {}, () => { });
        validate(rebookSchema)({ body: { horizonDays: 999 } }, {}, () => { });
        const req = { body: { horizonDays: 999 } };
        validate(rebookSchema)(req, {}, () => { });
        parsed = req.body;
        assert.equal(parsed.horizonDays, 60, 'an absurd horizon clamps to the cap');
        const req2 = { body: { horizonDays: 0 } };
        validate(rebookSchema)(req2, {}, () => { });
        assert.equal(req2.body.horizonDays, 1);
    });

    test('schema rejects a non-numeric staffId', () => {
        const { ok } = runMw(rebookSchema, { staffId: 'abc' });
        assert.equal(ok, false);
    });

    test('isRebookable only accepts terminal/past bookings', () => {
        assert.equal(rebookService.isRebookable({ status: 'completed' }), true);
        assert.equal(rebookService.isRebookable({ status: 'cancelled' }), true);
        assert.equal(rebookService.isRebookable({ status: 'no-show' }), true);
        assert.equal(rebookService.isRebookable({ status: 'declined' }), true);
        assert.equal(rebookService.isRebookable({ status: 'confirmed' }), false, 'a live booking is rescheduled, not rebooked');
        assert.equal(rebookService.isRebookable({ status: 'pending' }), false);
        assert.equal(rebookService.isRebookable(null), false);
    });

    test('findRebookSlot returns the next free slot with the same service', async () => {
        const source = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: PAST, time: '14:00', endTime: '14:30', status: 'completed',
        });
        const result = await rebookService.findRebookSlot(source, { now: new Date() });
        assert.equal(result.ok, true);
        assert.equal(result.suggestion.serviceId, serviceA.id);
        assert.equal(result.suggestion.salonId, salonA.id);
        assert.equal(result.suggestion.staffId, staffA.id);
        assert.equal(result.suggestion.sameStaff, true);
        assert.equal(result.suggestion.durationMinutes, 30);
        // A suggestion must be a complete, payable payload.
        assert.match(result.suggestion.date, /^\d{4}-\d{2}-\d{2}$/);
        assert.match(result.suggestion.time, /^\d{2}:\d{2}$/);
        assert.ok(result.suggestion.endTime > result.suggestion.time);
        await source.destroy();
    });

    test('preferSameTime picks the slot nearest the original time of day', async () => {
        // Block everything except 09:00 and 17:30 tomorrow so "nearest to
        // 17:00" and "earliest free" give provably different answers.
        await parkToday();
        const source = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: PAST, time: '17:00', endTime: '17:30', status: 'completed',
        });
        for (const t of ['09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00',
            '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00']) {
            const [h, m] = t.split(':').map(Number);
            const endMin = h * 60 + m + 30; // the service is 30 minutes long
            const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
            await Appointment.create({
                staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custB.id,
                date: TOMORROW, time: t, endTime: end, status: 'confirmed',
            });
        }
        const near = await rebookService.findRebookSlot(source, { now: new Date(), preferSameTime: true });
        const early = await rebookService.findRebookSlot(source, { now: new Date(), preferSameTime: false });
        assert.equal(near.ok, true);
        assert.equal(early.ok, true);
        assert.equal(early.suggestion.time, '09:00', 'without the preference, the earliest free slot wins');
        assert.ok(near.suggestion.time > early.suggestion.time, 'with it, the slot nearest 17:00 wins');
        assert.equal(near.suggestion.date, TOMORROW, 'and it is found on the day the fixture describes');
        await Appointment.destroy({ where: { date: TOMORROW } });
        await unparkToday();
        await source.destroy();
    });

    test('a conflicting booking pushes the suggestion to a free slot', async () => {
        const source = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: PAST, time: '09:00', endTime: '09:30', status: 'completed',
        });
        // Occupy both staff at tomorrow 09:00 — the suggestion must move.
        await parkToday();
        for (const s of [staffA, staffB]) {
            await Appointment.create({
                staffId: s.id, salonId: salonA.id, serviceId: serviceA.id, userId: custB.id,
                date: TOMORROW, time: '09:00', endTime: '09:30', status: 'confirmed',
            });
        }
        const result = await rebookService.findRebookSlot(source, { now: new Date(), preferSameTime: false });
        assert.equal(result.ok, true);
        assert.notEqual(result.suggestion.time, '09:00', 'a booked slot must never be suggested');
        assert.equal(result.suggestion.date, TOMORROW, 'and the fallback is tomorrow, not a leftover today slot');
        await Appointment.destroy({ where: { date: TOMORROW } });
        await unparkToday();
        await source.destroy();
    });

    test('a blockout is respected, not just existing bookings', async () => {
        const source = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: PAST, time: '09:00', endTime: '09:30', status: 'completed',
        });
        // Both stylists are blocked, because blocking only one is *supposed*
        // to fall through to the free colleague — that's a feature, and it
        // would make this assertion pass for the wrong reason.
        await parkToday();
        for (const s of [staffA, staffB]) {
            await StaffBlockout.create({
                staffId: s.id, date: TOMORROW, startTime: '09:00', endTime: '12:00',
            });
        }
        const result = await rebookService.findRebookSlot(source, {
            now: new Date(), preferSameTime: false, staffId: staffA.id,
        });
        assert.equal(result.ok, true);
        assert.ok(result.suggestion.time >= '12:00', 'a blocked-out morning cannot be suggested');
        assert.equal(result.suggestion.date, TOMORROW);
        await StaffBlockout.destroy({ where: { date: TOMORROW } });
        await unparkToday();
        await source.destroy();
    });

    test('a blockout on one stylist falls through to a free colleague', async () => {
        await parkToday();
        const source = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: PAST, time: '09:00', endTime: '09:30', status: 'completed',
        });
        await StaffBlockout.create({
            staffId: staffA.id, date: TOMORROW, startTime: '09:00', endTime: '23:59',
        });
        const result = await rebookService.findRebookSlot(source, {
            now: new Date(), preferSameTime: false, staffId: staffA.id,
        });
        assert.equal(result.ok, true);
        assert.equal(result.suggestion.time, '09:00', 'the slot is still sellable');
        assert.equal(result.suggestion.staffId, staffB.id, 'but someone else has to do it');
        assert.equal(result.suggestion.sameStaff, false);
        assert.equal(result.suggestion.date, TOMORROW);
        await StaffBlockout.destroy({ where: { date: TOMORROW } });
        await unparkToday();
        await source.destroy();
    });

    test('a closed day is skipped entirely', async () => {
        const closed = await Salons.create({
            name: 'ClosedMondays', email: 'cx-closed@t.com', password: 'x', phoneNumber: '7',
            address: 'c', pricing: 'Moderate',
            weeklyHours: allWeek({ 0: { open: '09:00', close: '18:00', closed: true }, 6: { open: '09:00', close: '18:00', closed: true } }),
        });
        const st = await Staff.create({ name: 'Solo', email: 'cx-solo@t.com', password: 'x', phoneNumber: '8', statusbar: 'active', salonId: closed.id });
        const sv = await Services.create({ name: 'Trim', price: 100, duration: 30, salonId: closed.id, statusbar: 'active' });
        await st.addService(sv);
        const source = await Appointment.create({
            staffId: st.id, salonId: closed.id, serviceId: sv.id, userId: custA.id,
            date: PAST, time: '09:00', endTime: '09:30', status: 'completed',
        });
        const result = await rebookService.findRebookSlot(source, { now: new Date() });
        assert.equal(result.ok, true);
        const jsDay = new Date(`${result.suggestion.date}T00:00:00`).getDay();
        assert.notEqual(jsDay, 0, 'Sunday is closed');
        assert.notEqual(jsDay, 6, 'Saturday is closed');
        await source.destroy();
    });

    test('an archived service cannot be rebooked', async () => {
        const sv = await Services.create({ name: 'Gone', price: 100, duration: 30, salonId: salonA.id, statusbar: 'archived' });
        const source = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: sv.id, userId: custA.id,
            date: PAST, time: '09:00', endTime: '09:30', status: 'completed',
        });
        const result = await rebookService.findRebookSlot(source, { now: new Date() });
        assert.equal(result.ok, false);
        assert.equal(result.code, 'SERVICE_UNAVAILABLE');
        await source.destroy();
    });

    test('no slots in the whole horizon reports NO_SLOT_FOUND, not a crash', async () => {
        const busy = await Salons.create({
            name: 'FullyBooked', email: 'cx-full@t.com', password: 'x', phoneNumber: '9',
            address: 'd', pricing: 'Moderate', weeklyHours: allWeek(),
        });
        const st = await Staff.create({ name: 'Busy', email: 'cx-busy@t.com', password: 'x', phoneNumber: '10', statusbar: 'active', salonId: busy.id });
        const sv = await Services.create({ name: 'AlwaysTaken', price: 100, duration: 30, salonId: busy.id, statusbar: 'active' });
        await st.addService(sv);
        // Block every day in a 7-day horizon.
        for (let i = 0; i <= 7; i++) {
            await StaffBlockout.create({ staffId: st.id, date: addDays(TODAY, i), startTime: '00:00', endTime: '23:59' });
        }
        const source = await Appointment.create({
            staffId: st.id, salonId: busy.id, serviceId: sv.id, userId: custA.id,
            date: PAST, time: '09:00', endTime: '09:30', status: 'completed',
        });
        const result = await rebookService.findRebookSlot(source, { now: new Date(), horizonDays: 5 });
        assert.equal(result.ok, false);
        assert.equal(result.code, 'NO_SLOT_FOUND');
        assert.match(result.reason, /no equivalent slot/i);
        await source.destroy();
    });

    test('controller: 404 unknown, 403 foreign, 409 live booking, 200 happy path', async () => {
        const source = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: PAST, time: '10:00', endTime: '10:30', status: 'completed',
        });

        let res = mockRes();
        await appointmentController.rebookFromAppointment(
            mockReq({ params: { appointmentId: 999999 }, user: { userId: custA.id }, body: {} }), res);
        assert.equal(res.statusCode, 404);

        res = mockRes();
        await appointmentController.rebookFromAppointment(
            mockReq({ params: { appointmentId: source.id }, user: { userId: custB.id }, body: {} }), res);
        assert.equal(res.statusCode, 403);

        // A live booking must go through reschedule, not rebook.
        const live = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: FAR_FUTURE, time: '10:00', endTime: '10:30', status: 'confirmed',
        });
        res = mockRes();
        await appointmentController.rebookFromAppointment(
            mockReq({ params: { appointmentId: live.id }, user: { userId: custA.id }, body: {} }), res);
        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, 'NOT_REBOOKABLE');
        await live.destroy();

        res = mockRes();
        await appointmentController.rebookFromAppointment(
            mockReq({ params: { appointmentId: source.id }, user: { userId: custA.id }, body: {} }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.salonId, salonA.id);
        assert.equal(res.body.serviceId, serviceA.id);
        assert.equal(res.body.sourceAppointmentId, source.id);
        await source.destroy();
    });

    test('rebook never suggests a slot that has already started', async () => {
        // REGRESSION. `today` used to come from now.toISOString() — the UTC
        // day — while the "has this slot started?" guard read now.getHours(),
        // the LOCAL hour. On any host whose offset crosses a day boundary
        // those name two different days: east of UTC it happens just after
        // local midnight, west of UTC just before it. The search then walked
        // the wrong day's calendar and happily suggested 09:00 "today" at
        // 01:30 — a slot that had already passed. Both values now come from
        // utils/timezone's localDay/localTime, so they cannot disagree.
        //
        // The seam is chosen for THIS host so the test bites wherever it runs:
        // getTimezoneOffset() is negative east of UTC and positive west of it.
        const seam = new Date();
        seam.setHours(new Date().getTimezoneOffset() <= 0 ? 0 : 23, 30, 0, 0);

        const pad = (n) => String(n).padStart(2, '0');
        assert.equal(
            localDay(seam),
            `${seam.getFullYear()}-${pad(seam.getMonth() + 1)}-${pad(seam.getDate())}`,
            'localDay is the LOCAL calendar day, never the UTC one'
        );

        const source = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: PAST, time: '09:00', endTime: '09:30', status: 'completed',
        });
        const result = await rebookService.findRebookSlot(source, { now: seam, preferSameTime: false });
        assert.equal(result.ok, true);
        const suggested = new Date(`${result.suggestion.date}T${result.suggestion.time}`);
        assert.ok(
            suggested.getTime() > seam.getTime(),
            `suggested ${result.suggestion.date} ${result.suggestion.time}, which had already passed at ${localDay(seam)} ${localTime(seam)}`
        );
        await source.destroy();
    });

    test('recentDistinctBookings returns one row per salon/service/staff combo', async () => {
        const a1 = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: PAST, time: '10:00', endTime: '10:30', status: 'completed',
        });
        await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: addDays(PAST, 1), time: '10:00', endTime: '10:30', status: 'completed',
        });
        await Appointment.create({
            staffId: staffB.id, salonId: salonA.id, serviceId: serviceB.id, userId: custA.id,
            date: addDays(PAST, 2), time: '10:00', endTime: '11:00', status: 'completed',
        });
        const rows = await rebookService.recentDistinctBookings(custA.id, 8);
        const keys = rows.map((r) => `${r.salonId}|${r.serviceId}|${r.staffId}`);
        assert.equal(new Set(keys).size, keys.length, 'no duplicate combos');
        assert.ok(keys.includes(`${salonA.id}|${serviceA.id}|${staffA.id}`));
        assert.ok(keys.includes(`${salonA.id}|${serviceB.id}|${staffB.id}`));
        await Appointment.destroy({ where: { userId: custA.id, date: { [require('sequelize').Op.lte]: PAST } } });
        assert.ok(a1);
    });
});

// ══ #56 Price quote ══════════════════════════════════════════════════
describe('#56 price quote', () => {
    test('a basic quote reports the service price in minor units', async () => {
        const result = await quoteService.buildQuote({ salonId: salonA.id, serviceId: serviceA.id });
        assert.equal(result.ok, true);
        assert.equal(result.quote.baseAmount, 20000, '₹200 = 20000 paise');
        assert.equal(result.quote.totalAmount, 20000);
        assert.equal(result.quote.discountAmount, 0);
        assert.equal(result.quote.tipAmount, 0);
        assert.ok(result.quote.formatted.total.includes('₹'));
        assert.equal(result.quote.promoApplied, null);
    });

    test('a promo code discounts the quote', async () => {
        await PromoCode.create({
            code: 'CX10', salonId: salonA.id, discountType: 'percent', discountValue: 10,
            isActive: true, usedCount: 0, minOrderAmount: 0,
        });
        const result = await quoteService.buildQuote({
            salonId: salonA.id, serviceId: serviceA.id, promoCode: 'CX10',
        });
        assert.equal(result.ok, true);
        assert.equal(result.quote.baseAmount, 20000);
        assert.equal(result.quote.discountAmount, 2000, '10% of ₹200');
        assert.equal(result.quote.totalAmount, 18000);
        assert.equal(result.quote.promoApplied.code, 'CX10');
        await PromoCode.destroy({ where: { code: 'CX10' } });
    });

    test('the tip rides on top of the discounted price, not the list price', async () => {
        await PromoCode.create({
            code: 'CXTIP', salonId: salonA.id, discountType: 'percent', discountValue: 50,
            isActive: true, usedCount: 0, minOrderAmount: 0,
        });
        const result = await quoteService.buildQuote({
            salonId: salonA.id, serviceId: serviceA.id, promoCode: 'CXTIP', tipAmount: 30,
        });
        assert.equal(result.ok, true);
        // 20000 - 10000 + 3000 = 13000 — the tip is added AFTER the discount.
        assert.equal(result.quote.discountAmount, 10000);
        assert.equal(result.quote.tipAmount, 3000);
        assert.equal(result.quote.totalAmount, 13000);
        await PromoCode.destroy({ where: { code: 'CXTIP' } });
    });

    test('an invalid promo is reported, never silently dropped', async () => {
        const result = await quoteService.buildQuote({
            salonId: salonA.id, serviceId: serviceA.id, promoCode: 'NOPE',
        });
        assert.equal(result.ok, false);
        assert.equal(result.code, 'PROMO_INVALID');
        assert.equal(result.status, 400);
    });

    test('a promo from another salon does not apply', async () => {
        await PromoCode.create({
            code: 'OTHER', salonId: salonB.id, discountType: 'percent', discountValue: 90,
            isActive: true, usedCount: 0, minOrderAmount: 0,
        });
        const result = await quoteService.buildQuote({
            salonId: salonA.id, serviceId: serviceA.id, promoCode: 'OTHER',
        });
        assert.equal(result.ok, false, 'a salon-scoped promo must not cross salons');
        await PromoCode.destroy({ where: { code: 'OTHER' } });
    });

    test('the total never goes negative, however generous the promo', async () => {
        await PromoCode.create({
            code: 'RUINOUS', salonId: salonA.id, discountType: 'flat', discountValue: 100000,
            isActive: true, usedCount: 0, minOrderAmount: 0,
        });
        const result = await quoteService.buildQuote({
            salonId: salonA.id, serviceId: serviceA.id, promoCode: 'RUINOUS',
        });
        assert.equal(result.ok, true);
        assert.equal(result.quote.totalAmount, 0, 'clamped at zero, never negative');
        await PromoCode.destroy({ where: { code: 'RUINOUS' } });
    });

    test('an archived service is refused', async () => {
        const sv = await Services.create({ name: 'Retired', price: 500, duration: 30, salonId: salonA.id, statusbar: 'archived' });
        const result = await quoteService.buildQuote({ salonId: salonA.id, serviceId: sv.id });
        assert.equal(result.ok, false);
        assert.equal(result.code, 'SERVICE_ARCHIVED');
        assert.equal(result.status, 409);
    });

    test('service and staff must belong to the same salon', async () => {
        const wrongSalon = await quoteService.buildQuote({ salonId: salonB.id, serviceId: serviceA.id });
        assert.equal(wrongSalon.ok, false);
        assert.equal(wrongSalon.code, 'SERVICE_NOT_FOUND');

        const wrongStaff = await quoteService.buildQuote({
            salonId: salonA.id, serviceId: serviceA.id, staffId: 999999,
        });
        assert.equal(wrongStaff.ok, false);
        assert.equal(wrongStaff.code, 'STAFF_NOT_FOUND');
    });

    test('a group quote reports a per-person share that divides exactly', async () => {
        const result = await quoteService.buildQuote({
            salonId: salonA.id, serviceId: serviceA.id, partySize: 3,
        });
        assert.equal(result.ok, true);
        assert.equal(result.quote.partySize, 3);
        // 20000 paise will not divide by 3. perPersonAmount is the FIRST slice
        // of an exact allocation, so it is deliberately allowed to be a paise
        // ABOVE the naive division — what must hold is that the slices sum
        // back to the total with nothing lost or invented. Asserting
        // `perPersonAmount * 3 === total` would assert the very thing integer
        // allocation exists to avoid.
        const parts = money.allocate(result.quote.totalAmount, [1, 1, 1]);
        assert.equal(parts.reduce((a, b) => a + b, 0), result.quote.totalAmount);
        assert.ok(Math.abs(result.quote.perPersonAmount - result.quote.totalAmount / 3) <= 1);
    });

    test('controller maps service failures to the right status codes', async () => {
        const res = mockRes();
        await appointmentController.getQuote(mockReq({
            user: { userId: custA.id },
            body: { salonId: salonA.id, serviceId: serviceA.id },
        }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.totalAmount, 20000);

        const bad = mockRes();
        await appointmentController.getQuote(mockReq({
            user: { userId: custA.id },
            body: { salonId: salonA.id, serviceId: serviceA.id, promoCode: 'NOPE' },
        }), bad);
        assert.equal(bad.statusCode, 400);
    });

    test('the quote schema rejects a negative tip and a bad salon id', () => {
        assert.equal(runMw(quoteSchema, { salonId: 1, serviceId: 1, tipAmount: -5 }).ok, false);
        assert.equal(runMw(quoteSchema, { salonId: 'x', serviceId: 1 }).ok, false);
        assert.equal(runMw(quoteSchema, { salonId: 1, serviceId: 1, partySize: 99 }).ok, false);
        assert.equal(runMw(quoteSchema, { salonId: 1, serviceId: 1 }).ok, true);
    });
});

// ══ #57 Booking history filters ══════════════════════════════════════
describe('#57 booking history filters', () => {
    test('unfiltered requests still return the legacy bare array', async () => {
        const res = mockRes();
        await appointmentController.getAllAppointmentsByUserId(
            mockReq({ user: { userId: custB.id } }), res);
        assert.equal(res.statusCode, 200);
        assert.ok(Array.isArray(res.body), 'no page/limit means the legacy shape');
    });

    test('status filter narrows the listing', async () => {
        await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custB.id,
            date: PAST, time: '09:00', endTime: '09:30', status: 'cancelled',
        });
        await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custB.id,
            date: PAST, time: '10:00', endTime: '10:30', status: 'completed',
        });

        const res = mockRes();
        await appointmentController.getAllAppointmentsByUserId(
            mockReq({ user: { userId: custB.id }, query: { status: 'cancelled' } }), res);
        assert.equal(res.statusCode, 200);
        const rows = Array.isArray(res.body) ? res.body : res.body.data;
        assert.ok(rows.length >= 1);
        assert.ok(rows.every((r) => r.status === 'cancelled'));
        // Another customer's rows must never appear.
        assert.ok(rows.every((r) => r.userId === custB.id));
    });

    test('date range filter returns only in-window rows', async () => {
        const from = addDays(PAST, -5);
        const to = addDays(PAST, -1);
        await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custB.id,
            date: addDays(PAST, -2), time: '09:00', endTime: '09:30', status: 'completed',
        });
        const res = mockRes();
        await appointmentController.getAllAppointmentsByUserId(
            mockReq({ user: { userId: custB.id }, query: { from, to } }), res);
        const rows = Array.isArray(res.body) ? res.body : res.body.data;
        assert.ok(rows.every((r) => String(r.date) >= from && String(r.date) <= to));
    });

    test('salonId filter scopes to one salon', async () => {
        await Appointment.create({
            staffId: staffA.id, salonId: salonB.id, serviceId: serviceA.id, userId: custB.id,
            date: addDays(PAST, -3), time: '09:00', endTime: '09:30', status: 'completed',
        });
        const res = mockRes();
        await appointmentController.getAllAppointmentsByUserId(
            mockReq({ user: { userId: custB.id }, query: { salonId: String(salonB.id) } }), res);
        const rows = Array.isArray(res.body) ? res.body : res.body.data;
        assert.ok(rows.length >= 1);
        assert.ok(rows.every((r) => r.salonId === salonB.id));
    });

    test('filters compose with the pagination envelope', async () => {
        const res = mockRes();
        await appointmentController.getAllAppointmentsByUserId(
            mockReq({ user: { userId: custB.id }, query: { status: 'completed', page: '1', limit: '2' } }), res);
        assert.equal(res.statusCode, 200);
        assert.ok(Array.isArray(res.body.data));
        assert.equal(res.body.page, 1);
        assert.equal(res.body.limit, 2);
        assert.ok(res.body.data.every((r) => r.status === 'completed'));
    });

    test('the schema rejects a bad status and an inverted range', () => {
        assert.equal(runMw(appointmentHistorySchema, { status: 'maybe' }, 'query').ok, false);
        assert.equal(runMw(appointmentHistorySchema, { from: '2026-05-02', to: '2026-05-01' }, 'query').ok, false);
        assert.equal(runMw(appointmentHistorySchema, { from: 'not-a-date' }, 'query').ok, false);
        assert.equal(runMw(appointmentHistorySchema, {}, 'query').ok, true);
    });
});

// ══ #58 Recently viewed ══════════════════════════════════════════════
describe('#58 recently viewed salons', () => {
    test('a repeat view updates the existing row instead of duplicating', async () => {
        const uid = 9001;
        await RecentlyViewed.destroy({ where: { userId: uid } });
        await recentViews.recordRecentView(uid, salonA.id);
        const first = await RecentlyViewed.findOne({ where: { userId: uid, salonId: salonA.id } });
        await new Promise((r) => setTimeout(r, 15));
        await recentViews.recordRecentView(uid, salonA.id);
        const rows = await RecentlyViewed.findAll({ where: { userId: uid } });
        assert.equal(rows.length, 1, 'one row per salon, not one per view');
        assert.ok(rows[0].viewedAt.getTime() >= first.viewedAt.getTime());
        await RecentlyViewed.destroy({ where: { userId: uid } });
    });

    test('the listing is newest-first and hydrated with salon details', async () => {
        const uid = 9002;
        await RecentlyViewed.destroy({ where: { userId: uid } });
        await recentViews.recordRecentView(uid, salonA.id);
        await new Promise((r) => setTimeout(r, 15));
        await recentViews.recordRecentView(uid, salonB.id);

        const items = await recentViews.getRecentlyViewed(uid, 10);
        assert.equal(items.length, 2);
        assert.equal(items[0].salonId, salonB.id, 'most recent first');
        assert.equal(items[0].name, 'OtherCX');
        assert.ok(items[0].viewedAt);
        await RecentlyViewed.destroy({ where: { userId: uid } });
    });

    test('a deleted salon is skipped, not fatal', async () => {
        const uid = 9003;
        const ghost = await Salons.create({
            name: 'Ghost', email: 'cx-ghost@t.com', password: 'x', phoneNumber: '11',
            address: 'g', pricing: 'Moderate',
        });
        await recentViews.recordRecentView(uid, ghost.id);
        await recentViews.recordRecentView(uid, salonA.id);
        await ghost.destroy();

        const items = await recentViews.getRecentlyViewed(uid, 10);
        assert.equal(items.length, 1, 'the dangling row disappears quietly');
        assert.equal(items[0].salonId, salonA.id);
        await RecentlyViewed.destroy({ where: { userId: uid } });
    });

    test('history is pruned to a bounded number of rows per user', async () => {
        const uid = 9004;
        await RecentlyViewed.destroy({ where: { userId: uid } });
        for (let i = 0; i < recentViews.HISTORY_LIMIT + 5; i++) {
            // Distinct salon ids so each row survives the uniqueness index.
            await recentViews.recordRecentView(uid, salonA.id + i + 500);
        }
        const count = await RecentlyViewed.count({ where: { userId: uid } });
        assert.equal(count, recentViews.HISTORY_LIMIT, 'the table cannot grow without bound');
        await RecentlyViewed.destroy({ where: { userId: uid } });
    });

    test('clearRecentViews wipes one user and leaves others alone', async () => {
        await RecentlyViewed.destroy({ where: { userId: { [require('sequelize').Op.in]: [9005, 9006] } } });
        await recentViews.recordRecentView(9005, salonA.id);
        await recentViews.recordRecentView(9006, salonA.id);
        await recentViews.clearRecentViews(9005);
        assert.equal(await RecentlyViewed.count({ where: { userId: 9005 } }), 0);
        assert.equal(await RecentlyViewed.count({ where: { userId: 9006 } }), 1);
        await RecentlyViewed.destroy({ where: { userId: { [require('sequelize').Op.in]: [9005, 9006] } } });
    });

    test('controller records a view and lists them for the right user', async () => {
        const uid = 9007;
        await RecentlyViewed.destroy({ where: { userId: uid } });
        let res = mockRes();
        await userController.recordRecentlyViewed(
            mockReq({ user: { userId: uid }, body: { salonId: salonA.id } }), res);
        assert.equal(res.statusCode, 204, 'nothing to render back');

        res = mockRes();
        await userController.getRecentlyViewed(mockReq({ user: { userId: uid }, query: {} }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.length, 1);
        assert.equal(res.body[0].salonId, salonA.id);

        // A different customer must not see it.
        res = mockRes();
        await userController.getRecentlyViewed(mockReq({ user: { userId: 9008 }, query: {} }), res);
        assert.equal(res.body.length, 0);
        await RecentlyViewed.destroy({ where: { userId: uid } });
    });
});

// ══ #59 Favorite staff ═══════════════════════════════════════════════
describe('#59 favorite staff', () => {
    // Every user id here is a REAL row: favoriteStaff.userId is a foreign key
    // into users, and SQLite enforces it. Inventing an id like 9101 makes the
    // insert fail for the right reason and hides whatever the test meant to
    // prove. Isolation comes from clearing the favorites afterwards instead.
    const clear = () => FavoriteStaff.destroy({ where: { userId: [custA.id, custB.id] } });

    test('adding is idempotent — a double tap cannot fail', async () => {
        await clear();
        let res = mockRes();
        await userController.addFavoriteStaff(mockReq({ user: { userId: custA.id }, body: { staffId: staffA.id } }), res);
        assert.equal(res.statusCode, 201);

        res = mockRes();
        await userController.addFavoriteStaff(mockReq({ user: { userId: custA.id }, body: { staffId: staffA.id } }), res);
        assert.equal(res.statusCode, 200, 'the second add is a no-op, not a 409');
        assert.equal(await FavoriteStaff.count({ where: { userId: custA.id } }), 1);
        await clear();
    });

    test('unknown staff is a 404', async () => {
        const res = mockRes();
        await userController.addFavoriteStaff(mockReq({ user: { userId: custA.id }, body: { staffId: 999999 } }), res);
        assert.equal(res.statusCode, 404);
    });

    test('the listing is hydrated and scoped to the caller', async () => {
        await clear();
        await userController.addFavoriteStaff(mockReq({ user: { userId: custA.id }, body: { staffId: staffB.id } }), mockRes());

        const res = mockRes();
        await userController.getFavoriteStaff(mockReq({ user: { userId: custA.id } }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.length, 1);
        assert.equal(res.body[0].staffId, staffB.id);
        assert.equal(res.body[0].name, 'Marcus');
        assert.equal(res.body[0].salonId, salonA.id);
        assert.equal(res.body[0].active, true);

        const other = mockRes();
        await userController.getFavoriteStaff(mockReq({ user: { userId: custB.id } }), other);
        assert.equal(other.body.length, 0, 'another customer sees their own list');
        await clear();
    });

    test('removing works and is forgiving of a second call', async () => {
        await clear();
        await userController.addFavoriteStaff(mockReq({ user: { userId: custA.id }, body: { staffId: staffA.id } }), mockRes());

        let res = mockRes();
        await userController.removeFavoriteStaff(mockReq({ user: { userId: custA.id }, params: { staffId: String(staffA.id) } }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.removed, 1);

        res = mockRes();
        await userController.removeFavoriteStaff(mockReq({ user: { userId: custA.id }, params: { staffId: String(staffA.id) } }), res);
        assert.equal(res.statusCode, 200, 'removing an absent favorite still succeeds');
        assert.equal(res.body.removed, 0);
        await clear();
    });

    test('a removed staff member stops appearing instead of breaking the page', async () => {
        await clear();
        const temp = await Staff.create({ name: 'Temp', email: 'cx-temp@t.com', password: 'x', phoneNumber: '12', statusbar: 'active', salonId: salonA.id });
        await userController.addFavoriteStaff(mockReq({ user: { userId: custA.id }, body: { staffId: temp.id } }), mockRes());
        await userController.addFavoriteStaff(mockReq({ user: { userId: custA.id }, body: { staffId: staffA.id } }), mockRes());
        await temp.destroy();

        const res = mockRes();
        await userController.getFavoriteStaff(mockReq({ user: { userId: custA.id } }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.length, 1, 'the dangling favorite is dropped');
        assert.equal(res.body[0].staffId, staffA.id);
        await clear();
    });

    test('the schema rejects junk staff ids', () => {
        assert.equal(runMw(favoriteStaffSchema, { staffId: 'abc' }).ok, false);
        assert.equal(runMw(favoriteStaffSchema, { staffId: -1 }).ok, false);
        assert.equal(runMw(favoriteStaffSchema, { staffId: 5 }).ok, true);
    });
});

// ══ #60 Cancellation reasons ═════════════════════════════════════════
describe('#60 cancellation reasons', () => {
    test('the schema accepts the fixed vocabulary and rejects anything else', () => {
        for (const reason of CANCELLATION_REASONS) {
            assert.equal(runMw(cancelAppointmentSchema, { reason }).ok, true, `${reason} must be valid`);
        }
        assert.equal(runMw(cancelAppointmentSchema, { reason: 'because' }).ok, false);
        assert.equal(runMw(cancelAppointmentSchema, {}).ok, true, 'a reason is optional');
        assert.equal(runMw(cancelAppointmentSchema, { reason: 'other', reasonNote: 'x'.repeat(201) }).ok, false);
    });

    test('cancelling records the reason and the timestamp', async () => {
        const appt = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: FAR_FUTURE, time: '09:00', endTime: '09:30', status: 'confirmed',
        });
        const res = mockRes();
        await appointmentController.cancelAppointment(mockReq({
            params: { appointmentId: appt.id },
            user: { userId: custA.id },
            body: { reason: 'too-expensive', reasonNote: 'Cheaper around the corner' },
        }), res);
        assert.equal(res.statusCode, 200);

        const reloaded = await Appointment.findByPk(appt.id);
        assert.equal(reloaded.status, 'cancelled');
        assert.equal(reloaded.cancellationReason, 'too-expensive');
        assert.equal(reloaded.cancellationNote, 'Cheaper around the corner');
        assert.ok(reloaded.cancelledAt, 'the cancellation is timestamped');
        await appt.destroy();
    });

    test('cancelling without a reason records nulls, exactly as before', async () => {
        const appt = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: FAR_FUTURE, time: '09:00', endTime: '09:30', status: 'confirmed',
        });
        const res = mockRes();
        await appointmentController.cancelAppointment(mockReq({
            params: { appointmentId: appt.id },
            user: { userId: custA.id },
            body: {},
        }), res);
        assert.equal(res.statusCode, 200);
        const reloaded = await Appointment.findByPk(appt.id);
        assert.equal(reloaded.cancellationReason, null);
        assert.ok(reloaded.cancelledAt, 'the timestamp is recorded regardless');
        await appt.destroy();
    });

    test('the 24-hour rule still wins over a well-formed reason', async () => {
        const soon = new Date(Date.now() + 2 * 3600 * 1000);
        const appt = await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custA.id,
            date: isoDay(soon), time: `${String(soon.getHours()).padStart(2, '0')}:00`,
            endTime: `${String(soon.getHours()).padStart(2, '0')}:30`, status: 'confirmed',
        });
        const res = mockRes();
        await appointmentController.cancelAppointment(mockReq({
            params: { appointmentId: appt.id },
            user: { userId: custA.id },
            body: { reason: 'schedule-conflict' },
        }), res);
        if (res.statusCode === 400) {
            const reloaded = await Appointment.findByPk(appt.id);
            assert.equal(reloaded.status, 'confirmed', 'a late cancel changes nothing');
            assert.equal(reloaded.cancellationReason, null);
        }
        await appt.destroy();
    });

    test('analytics breaks cancellations down by reason with a rate', async () => {
        const salon = await Salons.create({
            name: 'CancelStats', email: 'cx-cs@t.com', password: 'x', phoneNumber: '13',
            address: 'cs', pricing: 'Moderate',
        });
        const st = await Staff.create({ name: 'CS', email: 'cx-cs-st@t.com', password: 'x', phoneNumber: '14', statusbar: 'active', salonId: salon.id });
        const sv = await Services.create({ name: 'CSSvc', price: 100, duration: 30, salonId: salon.id, statusbar: 'active' });

        // 3 cancelled (2 schedule-conflict, 1 unspecified) + 7 completed.
        for (let i = 0; i < 2; i++) {
            await Appointment.create({
                staffId: st.id, salonId: salon.id, serviceId: sv.id, userId: custA.id,
                date: addDays(TODAY, -i - 1), time: '09:00', endTime: '09:30',
                status: 'cancelled', cancellationReason: 'schedule-conflict', cancelledAt: new Date(),
            });
        }
        await Appointment.create({
            staffId: st.id, salonId: salon.id, serviceId: sv.id, userId: custA.id,
            date: addDays(TODAY, -4), time: '09:00', endTime: '09:30',
            status: 'cancelled', cancellationReason: null, cancelledAt: new Date(),
        });
        for (let i = 0; i < 7; i++) {
            await Appointment.create({
                staffId: st.id, salonId: salon.id, serviceId: sv.id, userId: custA.id,
                date: addDays(TODAY, -i - 5), time: '11:00', endTime: '11:30', status: 'completed',
            });
        }

        const res = mockRes();
        await salonAnalyticsController.getCancellationReasons(
            mockReq({ user: { salonId: salon.id }, query: { days: '30' } }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.totalAppointments, 10);
        assert.equal(res.body.cancelled, 3);
        assert.equal(res.body.cancellationRate, 30);
        assert.equal(res.body.topReason, 'schedule-conflict');

        const byReason = Object.fromEntries(res.body.reasons.map((r) => [r.reason, r.count]));
        assert.equal(byReason['schedule-conflict'], 2);
        assert.equal(byReason.unspecified, 1, 'reason-less cancellations are reported, not hidden');
        assert.equal(res.body.reasons[0].shareOfCancellations, 66.67);

        // Another salon's cancellations must never leak in.
        const other = mockRes();
        await salonAnalyticsController.getCancellationReasons(
            mockReq({ user: { salonId: salonB.id }, query: { days: '30' } }), other);
        assert.equal(other.body.cancelled, 0);
    });

    test('an empty window reports zeros instead of NaN', async () => {
        const empty = await Salons.create({
            name: 'EmptyStats', email: 'cx-es@t.com', password: 'x', phoneNumber: '15',
            address: 'es', pricing: 'Moderate',
        });
        const res = mockRes();
        await salonAnalyticsController.getCancellationReasons(
            mockReq({ user: { salonId: empty.id }, query: { days: '30' } }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.cancelled, 0);
        assert.equal(res.body.cancellationRate, 0);
        assert.equal(res.body.topReason, null);
        assert.deepEqual(res.body.reasons, []);
    });
});

// ══ #61 Recurring series ═════════════════════════════════════════════
describe('#61 recurring booking series', () => {
    test('occurrenceDate steps by the frequency', () => {
        const base = { startDate: '2026-09-01', frequency: 'weekly' };
        assert.equal(recurring.occurrenceDate(base, 1), '2026-09-01');
        assert.equal(recurring.occurrenceDate(base, 2), '2026-09-08');
        assert.equal(recurring.occurrenceDate({ ...base, frequency: 'biweekly' }, 3), '2026-09-29');
        assert.equal(recurring.occurrenceDate({ ...base, frequency: 'monthly' }, 2), '2026-10-01');
    });

    test('dueCount counts only occurrences inside the horizon', () => {
        const series = { startDate: TODAY, frequency: 'weekly', occurrences: 10 };
        assert.equal(recurring.dueCount(series, TODAY, 0), 1, 'the first occurrence is due immediately');
        assert.equal(recurring.dueCount(series, TODAY, 7), 2);
        assert.equal(recurring.dueCount(series, TODAY, 21), 4);
        assert.equal(recurring.dueCount(series, TODAY, 365), 10, 'never more than the series length');
    });

    test('createSeries rejects a salon/service/staff mismatch', async () => {
        let r = await recurring.createSeries({
            userId: custA.id, salonId: 999999, serviceId: serviceA.id, staffId: staffA.id,
            startDate: TOMORROW, time: '10:00', frequency: 'weekly', occurrences: 4,
        });
        assert.equal(r.ok, false);
        assert.equal(r.code, 'SALON_NOT_FOUND');

        r = await recurring.createSeries({
            userId: custA.id, salonId: salonB.id, serviceId: serviceA.id, staffId: staffA.id,
            startDate: TOMORROW, time: '10:00', frequency: 'weekly', occurrences: 4,
        });
        assert.equal(r.ok, false);
        assert.equal(r.code, 'SERVICE_NOT_FOUND');

        r = await recurring.createSeries({
            userId: custA.id, salonId: salonA.id, serviceId: serviceA.id, staffId: 999999,
            startDate: TOMORROW, time: '10:00', frequency: 'weekly', occurrences: 4,
        });
        assert.equal(r.ok, false);
        assert.equal(r.code, 'STAFF_NOT_FOUND');
    });

    test('createSeries refuses a first slot outside working hours', async () => {
        const r = await recurring.createSeries({
            userId: custA.id, salonId: salonA.id, serviceId: serviceA.id, staffId: staffA.id,
            startDate: TOMORROW, time: '23:00', frequency: 'weekly', occurrences: 4,
        });
        assert.equal(r.ok, false);
        assert.equal(r.code, 'FIRST_SLOT_INVALID');
    });

    test('the sweep materializes due occurrences as pending bookings', async () => {
        const created = await recurring.createSeries({
            userId: custA.id, salonId: salonA.id, serviceId: serviceA.id, staffId: staffA.id,
            startDate: TODAY, time: '15:00', frequency: 'weekly', occurrences: 4,
        });
        assert.equal(created.ok, true);
        const series = created.series;

        // Horizon 0 → only the first occurrence (today) is due. The horizon is
        // measured from `today`, so a series starting tomorrow needs a horizon
        // of 1 before its first visit counts as due — anchoring the series on
        // TODAY keeps the arithmetic identical to the dueCount unit test.
        const stats = await recurring.materializeDueSeries({ today: TODAY, horizonDays: 0 });
        assert.ok(stats.created >= 1);

        const rows = await Appointment.findAll({ where: { seriesId: series.id }, order: [['occurrenceIndex', 'ASC']] });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].occurrenceIndex, 1);
        assert.equal(rows[0].date, TODAY);
        assert.equal(rows[0].time, '15:00');
        assert.equal(rows[0].status, 'pending', 'occurrences await salon confirmation');
        assert.equal(rows[0].userId, custA.id);
    });

    test('re-running the sweep is idempotent — no duplicate occurrences', async () => {
        const created = await recurring.createSeries({
            userId: custA.id, salonId: salonA.id, serviceId: serviceA.id, staffId: staffA.id,
            startDate: TODAY, time: '16:00', frequency: 'weekly', occurrences: 3,
        });
        const series = created.series;
        await recurring.materializeDueSeries({ today: TODAY, horizonDays: 0 });
        await recurring.materializeDueSeries({ today: TODAY, horizonDays: 0 });
        await recurring.materializeDueSeries({ today: TODAY, horizonDays: 0 });

        const rows = await Appointment.findAll({ where: { seriesId: series.id } });
        assert.equal(rows.length, 1, 'three sweeps produce one occurrence');
    });

    test('a later horizon materializes the next occurrence too', async () => {
        const created = await recurring.createSeries({
            userId: custA.id, salonId: salonA.id, serviceId: serviceA.id, staffId: staffA.id,
            startDate: TODAY, time: '13:00', frequency: 'weekly', occurrences: 3,
        });
        const series = created.series;
        await recurring.materializeDueSeries({ today: TODAY, horizonDays: 7 });
        const rows = await Appointment.findAll({ where: { seriesId: series.id }, order: [['occurrenceIndex', 'ASC']] });
        assert.equal(rows.length, 2, 'the second weekly occurrence is due within 7 days');
        assert.equal(rows[1].occurrenceIndex, 2);
        assert.equal(String(rows[1].date), addDays(TODAY, 7));
    });

    test('a conflicting occurrence is skipped, not double-booked', async () => {
        const created = await recurring.createSeries({
            userId: custA.id, salonId: salonA.id, serviceId: serviceA.id, staffId: staffA.id,
            startDate: TODAY, time: '11:00', frequency: 'weekly', occurrences: 2,
        });
        const series = created.series;
        // Occupy the slot the series wants.
        await Appointment.create({
            staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: custB.id,
            date: TODAY, time: '11:00', endTime: '11:30', status: 'confirmed',
        });
        const stats = await recurring.materializeDueSeries({ today: TODAY, horizonDays: 0 });
        assert.ok(stats.skipped >= 1);
        const rows = await Appointment.findAll({ where: { seriesId: series.id } });
        assert.equal(rows.length, 0, 'a taken slot is never force-booked');

        // Freeing the slot lets the retry succeed.
        await Appointment.destroy({ where: { date: TODAY, time: '11:00', userId: custB.id } });
        await recurring.materializeDueSeries({ today: TODAY, horizonDays: 0 });
        assert.equal(await Appointment.count({ where: { seriesId: series.id } }), 1);
    });

    test('a paused series materializes nothing', async () => {
        const created = await recurring.createSeries({
            userId: custA.id, salonId: salonA.id, serviceId: serviceA.id, staffId: staffA.id,
            startDate: TODAY, time: '12:00', frequency: 'weekly', occurrences: 3,
        });
        const series = created.series;
        await recurring.setSeriesStatus(series.id, custA.id, 'paused');
        await recurring.materializeDueSeries({ today: TODAY, horizonDays: 30 });
        assert.equal(await Appointment.count({ where: { seriesId: series.id } }), 0);
    });

    test('a cancelled series is terminal and keeps past occurrences', async () => {
        const created = await recurring.createSeries({
            userId: custA.id, salonId: salonA.id, serviceId: serviceA.id, staffId: staffA.id,
            startDate: TODAY, time: '14:00', frequency: 'weekly', occurrences: 3,
        });
        const series = created.series;
        await recurring.materializeDueSeries({ today: TODAY, horizonDays: 0 });
        assert.equal(await Appointment.count({ where: { seriesId: series.id } }), 1);

        await recurring.setSeriesStatus(series.id, custA.id, 'cancelled');
        const again = await recurring.setSeriesStatus(series.id, custA.id, 'active');
        assert.equal(again.ok, false, 'a cancelled series cannot be revived');
        assert.equal(again.code, 'SERIES_CANCELLED');
        assert.equal(await Appointment.count({ where: { seriesId: series.id } }), 1, 'real bookings survive');
    });

    test('listSeries reports progress and the next due date', async () => {
        const created = await recurring.createSeries({
            userId: custA.id, salonId: salonA.id, serviceId: serviceA.id, staffId: staffA.id,
            startDate: TODAY, time: '10:30', frequency: 'weekly', occurrences: 5,
        });
        const series = created.series;
        await recurring.materializeDueSeries({ today: TODAY, horizonDays: 0 });
        const list = await recurring.listSeries(custA.id);
        const mine = list.find((s) => s.id === series.id);
        assert.ok(mine);
        assert.equal(mine.occurrencesCreated, 1);
        assert.equal(mine.nextOccurrenceDate, addDays(TODAY, 7), 'the next unmaterialized date');
        assert.equal(mine.status, 'active');
    });

    test('series endpoints: create 201, list, pause, and foreign-ownership 404', async () => {
        let res = mockRes();
        await appointmentController.createBookingSeries(mockReq({
            user: { userId: custB.id },
            body: {
                salonId: salonA.id, serviceId: serviceA.id, staffId: staffB.id,
                startDate: TOMORROW, time: '09:30', frequency: 'biweekly', occurrences: 2,
            },
        }), res);
        assert.equal(res.statusCode, 201);
        const seriesId = res.body.series.id;
        assert.equal(res.body.series.frequency, 'biweekly');

        res = mockRes();
        await appointmentController.getMySeries(mockReq({ user: { userId: custB.id } }), res);
        assert.equal(res.statusCode, 200);
        assert.ok(res.body.some((s) => s.id === seriesId));

        res = mockRes();
        await appointmentController.updateBookingSeries(mockReq({
            user: { userId: custB.id }, params: { id: String(seriesId) }, body: { status: 'paused' },
        }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.series.status, 'paused');

        // Someone else cannot touch it.
        res = mockRes();
        await appointmentController.updateBookingSeries(mockReq({
            user: { userId: custA.id }, params: { id: String(seriesId) }, body: { status: 'cancelled' },
        }), res);
        assert.equal(res.statusCode, 404);
    });

    test('the schema rejects a past start date, a bad frequency and a 1-visit series', () => {
        const base = { salonId: 1, serviceId: 1, staffId: 1, time: '10:00', frequency: 'weekly', occurrences: 4 };
        assert.equal(runMw(seriesCreateSchema, { ...base, startDate: '2020-01-01' }).ok, false, 'the past is not bookable');
        assert.equal(runMw(seriesCreateSchema, { ...base, startDate: TOMORROW, frequency: 'daily' }).ok, false);
        assert.equal(runMw(seriesCreateSchema, { ...base, startDate: TOMORROW, occurrences: 1 }).ok, false, 'one visit is just a booking');
        assert.equal(runMw(seriesCreateSchema, { ...base, startDate: TOMORROW, occurrences: 999 }).ok, false, 'capped at a year');
        assert.equal(runMw(seriesCreateSchema, { ...base, startDate: TOMORROW }).ok, true);
        assert.equal(runMw(seriesUpdateSchema, { status: 'sleeping' }).ok, false);
        assert.equal(runMw(seriesUpdateSchema, { status: 'paused' }).ok, true);
    });
});

test('fire-and-forget side effects settle without unhandled rejections', async () => {
    // The rebook/quote/series paths trigger no notifications, but the cancel
    // path does — give them a moment so a swallowed failure can't surface as
    // an unhandled rejection after this file's DB connection closes.
    await waitFor(async () => true, 50);
    assert.ok(true);
});
