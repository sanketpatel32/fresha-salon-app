const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const User = require('../models/userModel');
const Appointment = require('../models/appointmentModel');
const Waitlist = require('../models/waitlistModel');
const RecurringSeries = require('../models/recurringSeriesModel');
// The loyalty award fires an in-app notification; requiring the model here
// means sync() creates its table so the fire-and-forget call doesn't log a
// missing-table error (same reason waitlist.test.js pulls it in).
require('../models/notificationModel');

// Stub the mailer BEFORE reminderService is required — it calls through the
// module object (property read at call time), so the spy counts every send.
const emailService = require('../services/emailService');
let sent = 0;
emailService.sendAppointmentReminderEmail = async () => { sent++; return { sent: true }; };

const { runReminderSweep } = require('../services/reminderService');
const { awardForCompletedAppointment, POINTS_PER_APPOINTMENT } = require('../services/loyaltyService');
const { resolvePromo } = require('../services/paymentService');
const { materializeDueSeries } = require('../services/recurringService');
const PromoCode = require('../models/promoCodeModel');
const { toMinor, fromMinor } = require('../utils/money');
const { localDay, addDays } = require('../utils/timezone');
const {
    validate,
    statusUpdateSchema,
    appointmentCheckSchema,
    paymentCreateSchema,
    rescheduleSchema,
    quoteSchema,
} = require('../utils/validators');

// Minimal req/res stubs for invoking validation middleware directly
// (same style as tips.test.js).
const runMw = (schema, body) => {
    let err = null;
    validate(schema)({ body }, {}, (e) => { if (e) err = e; });
    return err;
};

// Future-slot helpers (>24h out so lead-time gates never bite).
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hms = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const daysFromNow = (days) => new Date(Date.now() + days * 24 * 3600 * 1000);

let salonA, staffA, service500, loyUser, remUser, custC;

before(async () => {
    await sequelize.sync({ force: true });
    // Never let a real Brevo call escape from this run.
    delete process.env.BREVO_API_KEY;
    delete process.env.SENDER_EMAIL;

    salonA = await Salons.create({
        name: 'Regression Salon', email: 'rg@t.com', password: 'x', phoneNumber: '1', address: 'a', pricing: 'Premium',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '00:00', closingTime: '23:59',
    });
    staffA = await Staff.create({ name: 'Stylist Reg', email: 'str@t.com', password: 'x', phoneNumber: '2', salonId: salonA.id });
    service500 = await Services.create({ name: 'Regression Cut', price: 500, duration: 60, salonId: salonA.id });
    await staffA.setServices([service500]);

    loyUser = await User.create({ name: 'Loyal Lou', email: 'loy@t.com', password: 'x', phoneNumber: '3' });
    remUser = await User.create({ name: 'Rem Rae', email: 'rem@t.com', password: 'x', phoneNumber: '4' });
    custC = await User.create({ name: 'Cut Carl', email: 'carl@t.com', password: 'x', phoneNumber: '5' });
});

after(async () => { await sequelize.close(); });

// ── 1. statusUpdateSchema accepts 'no-show' ──────────────────────────────

test("statusUpdateSchema parses status 'no-show' and still rejects invalid statuses", () => {
    // The no-show feature is only reachable over HTTP if the validator lets
    // the status through — it used to 400 before the controller could run.
    const parsed = statusUpdateSchema.parse({ status: 'no-show' });
    assert.equal(parsed.status, 'no-show');
    assert.equal(runMw(statusUpdateSchema, { status: 'no-show' }), null, 'middleware passes no-show');

    // An arbitrary string is still refused with a 400.
    for (const bad of ['nohow', 'NO-SHOW-typo', 'absent', '']) {
        const err = runMw(statusUpdateSchema, { status: bad });
        assert.ok(err, `status=${JSON.stringify(bad)} should be rejected`);
        assert.equal(err.status, 400);
        assert.equal(statusUpdateSchema.safeParse({ status: bad }).success, false);
    }
});

// ── 2. Strict time/date validation on the three slot-bearing schemas ─────

const FUTURE_DATE = () => ymd(daysFromNow(3));

test('appointmentCheckSchema rejects impossible times and calendar-invalid dates, accepts a real future slot', () => {
    const base = { salonId: salonA.id, serviceId: service500.id, duration: 30 };
    for (const time of ['25:00', '9:99', '99:99']) {
        assert.equal(appointmentCheckSchema.safeParse({ ...base, dateSelect: FUTURE_DATE(), time }).success, false,
            `time=${time} must fail strict HH:mm`);
    }
    for (const dateSelect of ['2026-13-45', '2026-02-30']) {
        assert.equal(appointmentCheckSchema.safeParse({ ...base, dateSelect, time: '10:00' }).success, false,
            `dateSelect=${dateSelect} must fail calendar validation`);
    }
    // A genuine future slot still parses.
    const ok = appointmentCheckSchema.safeParse({ ...base, dateSelect: FUTURE_DATE(), time: '10:00' });
    assert.equal(ok.success, true);
    assert.equal(ok.data.time, '10:00');
});

test('paymentCreateSchema rejects impossible times and calendar-invalid dates, accepts a real future slot', () => {
    const base = { serviceId: service500.id, salonId: salonA.id, staffId: staffA.id, duration: 60 };
    for (const time of ['25:00', '9:99', '99:99']) {
        assert.equal(paymentCreateSchema.safeParse({ ...base, dateSelect: FUTURE_DATE(), time }).success, false,
            `time=${time} must fail strict HH:mm`);
    }
    for (const dateSelect of ['2026-13-45', '2026-02-30']) {
        assert.equal(paymentCreateSchema.safeParse({ ...base, dateSelect, time: '10:00' }).success, false,
            `dateSelect=${dateSelect} must fail calendar validation`);
    }
    assert.equal(paymentCreateSchema.safeParse({ ...base, dateSelect: FUTURE_DATE(), time: '23:59' }).success, true,
        'valid future date + in-range HH:mm accepted');
});

test('rescheduleSchema rejects impossible times and calendar-invalid dates, accepts a real future slot', () => {
    // Bad times with a VALID future date: only the time shape is under test.
    for (const time of ['25:00', '9:99', '99:99']) {
        assert.equal(rescheduleSchema.safeParse({ dateSelect: FUTURE_DATE(), time }).success, false,
            `time=${time} must fail strict HH:mm`);
    }
    // Bad dates with a VALID time. '2026-02-30' passes the shape regex but
    // must die on the calendar refine (JS would silently roll it to Mar 2).
    for (const dateSelect of ['2026-13-45', '2026-02-30']) {
        assert.equal(rescheduleSchema.safeParse({ dateSelect, time: '10:00' }).success, false,
            `dateSelect=${dateSelect} must fail calendar validation`);
    }
    assert.equal(rescheduleSchema.safeParse({ dateSelect: FUTURE_DATE(), time: '10:00' }).success, true,
        'valid future date + in-range HH:mm accepted');
});

// ── 3. Tip bounds parity between quoteSchema and paymentCreateSchema ─────

test('quoteSchema tip bounds match /pay: rejects 10001, accepts 10000, rounds dust to 2dp', () => {
    const base = { salonId: salonA.id, serviceId: service500.id };

    // Over-limit is refused with the exact client-facing message.
    const over = quoteSchema.safeParse({ ...base, tipAmount: 10001 });
    assert.equal(over.success, false, 'tipAmount 10001 must be rejected by the quote too');
    const tipIssue = over.error.issues.find((i) => i.path.includes('tipAmount'));
    assert.equal(tipIssue && tipIssue.message, 'Tip cannot exceed 10000');

    // The 10000 boundary itself is fine, on both schemas.
    assert.equal(quoteSchema.parse({ ...base, tipAmount: 10000 }).tipAmount, 10000);
    const payBase = { ...base, staffId: staffA.id, dateSelect: FUTURE_DATE(), time: '10:00', duration: 60 };
    assert.equal(paymentCreateSchema.parse({ ...payBase, tipAmount: 10000 }).tipAmount, 10000);

    // Rounding parity: the same sub-paise dust rounds up identically.
    assert.equal(quoteSchema.parse({ ...base, tipAmount: '49.999' }).tipAmount, 50);
    assert.equal(paymentCreateSchema.parse({ ...payBase, tipAmount: '49.999' }).tipAmount, 50);
});

// ── 4. money.toMinor rounding carry ──────────────────────────────────────

test('money.toMinor carries the rounding overflow into the integer part; fromMinor round-trips', () => {
    // '499.999' → ₹500.00, not ₹499.00: the dropped carry once understated a
    // quote by a whole rupee.
    assert.equal(toMinor('499.999'), 50000);
    assert.equal(toMinor('0.999'), 100);
    assert.equal(toMinor('1.999'), 200);
    assert.equal(toMinor('999.999'), 100000);
    assert.equal(toMinor('-0.999'), -100, 'negative dust carries too');

    // Exact decimal strings never involve a float at all.
    assert.equal(toMinor('1234.56'), 123456);
    assert.equal(toMinor('10'), 1000);

    assert.equal(fromMinor(50000), 500);
});

// ── 5. Waitlist partial unique index ─────────────────────────────────────

test('waitlist: a second active row for the same user+salon+date hits the unique index, but status left is fine', async () => {
    const wUser = await User.create({ name: 'Waitlist Wanda', email: 'wl@t.com', password: 'x', phoneNumber: '6' });
    const wSalon = await Salons.create({
        name: 'Waitlist Salon', email: 'ws@t.com', password: 'x', phoneNumber: '7', address: 'a', pricing: 'Moderate',
    });
    const date = ymd(daysFromNow(7));

    const first = await Waitlist.create({ userId: wUser.id, salonId: wSalon.id, date, partySize: 1, status: 'waiting' });
    assert.ok(first.id);

    // The controller's findOne pre-check is check-then-act; only the DB index
    // stops a double-tap from queueing the same person twice.
    await assert.rejects(
        () => Waitlist.create({ userId: wUser.id, salonId: wSalon.id, date, partySize: 2, status: 'waiting' }),
        (err) => err.name === 'SequelizeUniqueConstraintError',
        'duplicate active waitlist entry must throw a unique-constraint error'
    );

    // A 'left' row for the same tuple is a legitimate soft-leave and must be
    // allowed — the index is PARTIAL on status = 'waiting'.
    const left = await Waitlist.create({ userId: wUser.id, salonId: wSalon.id, date, partySize: 1, status: 'left' });
    assert.ok(left.id, "status 'left' escapes the partial index");
    assert.equal(await Waitlist.count({ where: { userId: wUser.id, salonId: wSalon.id, date } }), 2);
});

// ── 6. Loyalty exactly-once under a stale instance ───────────────────────

test('loyalty: replaying the award on the SAME stale instance awards exactly 10 points total', async () => {
    assert.equal(POINTS_PER_APPOINTMENT, 10, 'the flat award is 10 points');

    const appt = await Appointment.create({
        userId: loyUser.id, salonId: salonA.id, staffId: staffA.id, serviceId: service500.id,
        date: ymd(daysFromNow(2)), time: '10:00', endTime: '11:00', status: 'completed',
    });

    const first = await awardForCompletedAppointment(appt);
    assert.deepEqual(first, { awarded: POINTS_PER_APPOINTMENT });

    // Replay with the SAME in-memory instance, no reload: the stamp the first
    // call set must short-circuit before the balance is touched.
    const second = await awardForCompletedAppointment(appt);
    assert.deepEqual(second, { awarded: 0 });

    // The nastier variant: a truly stale instance from the concurrent
    // double-read window never saw the stamp. Force it by clearing the
    // in-memory field — the atomic conditional UPDATE must still lose.
    appt.pointsAwardedAt = null;
    const third = await awardForCompletedAppointment(appt);
    assert.deepEqual(third, { awarded: 0 });

    await loyUser.reload();
    assert.equal(loyUser.loyaltyPoints, POINTS_PER_APPOINTMENT, 'exactly one award (10), never 20');
    assert.equal(loyUser.lifetimePointsEarned, POINTS_PER_APPOINTMENT);
});

// ── 7. Reminder sweep idempotency ────────────────────────────────────────

test('reminder sweep: two consecutive sweeps send exactly ONE email and stamp reminderSentAt', async () => {
    // Within the 24h window, confirmed, never reminded.
    const start = new Date(Date.now() + 2 * 3600 * 1000);
    const appt = await Appointment.create({
        userId: remUser.id, salonId: salonA.id, staffId: staffA.id, serviceId: service500.id,
        date: ymd(start), time: hms(start), endTime: hms(new Date(start.getTime() + 30 * 60 * 1000)),
        status: 'confirmed',
    });
    assert.equal(appt.reminderSentAt, null, 'precondition: not reminded yet');

    const before = sent;
    const sweep1 = await runReminderSweep();
    assert.equal(sweep1.reminded, 1, 'first sweep claims and sends once');
    assert.equal(sent - before, 1);

    const sweep2 = await runReminderSweep();
    assert.equal(sweep2.reminded, 0, 'second sweep finds nothing to claim');
    assert.equal(sent - before, 1, 'exactly ONE email across both sweeps');

    await appt.reload();
    assert.ok(appt.reminderSentAt, 'reminderSentAt is stamped');
});

// ── 8. Promo end-of-day inclusivity + usage limit ────────────────────────

test('promo validUntil = TODAY (local) is still redeemable through the end of its own day', async () => {
    // Build the day from LOCAL Date parts — toISOString() names a different
    // day for half the planet.
    const todayStr = ymd(new Date());
    await PromoCode.create({
        code: 'EODTODAY', discountType: 'flat', discountValue: 50,
        validFrom: null, validUntil: todayStr,
    });
    // The old comparison expired it at midnight UTC of its own end day.
    const r = await resolvePromo('EODTODAY', salonA.id, 500);
    assert.equal(r.ok, true, `a promo valid THROUGH today must resolve today (${todayStr})`);
    assert.equal(r.discountAmount, 50);
});

test('promo usage limit: usedCount at the cap reports the limit reason verbatim', async () => {
    await PromoCode.create({
        code: 'ONCEONLY-RG', discountType: 'flat', discountValue: 50,
        usageLimit: 1, usedCount: 1,
    });
    const r = await resolvePromo('ONCEONLY-RG', salonA.id, 500);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'Promo code usage limit reached');
});

// ── 9. Recurring series skips past occurrences ───────────────────────────

test('recurring sweep: a back-dated series never books the past and stops rescanning skipped occurrences', async () => {
    const today = localDay();
    // Dedicated fixtures so nothing else's schedule can clash.
    const salonC = await Salons.create({
        name: 'Series Salon', email: 'ss@t.com', password: 'x', phoneNumber: '8', address: 'a', pricing: 'Moderate',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '00:00', closingTime: '23:59',
    });
    const staffC = await Staff.create({ name: 'Stylist Series', email: 'sts@t.com', password: 'x', phoneNumber: '9', salonId: salonC.id });
    const serviceC = await Services.create({ name: 'Series Trim', price: 300, duration: 60, salonId: salonC.id });
    await staffC.setServices([serviceC]);

    // Created DIRECTLY via the model to bypass the "start today or later"
    // schema — occurrences 1-3 (dates -21/-14/-7) are permanently in the past.
    const series = await RecurringSeries.create({
        userId: custC.id, salonId: salonC.id, serviceId: serviceC.id, staffId: staffC.id,
        startDate: addDays(today, -21), time: '10:00', frequency: 'weekly',
        occurrences: 8, occurrencesCreated: 1, partySize: 1, status: 'active',
    });

    const stats1 = await materializeDueSeries({ today, horizonDays: 14 });
    assert.ok(stats1.skipped >= 2, 'the three back-dated occurrences (2 and 3 pending) are skipped, not booked');

    let rows = await Appointment.findAll({ where: { seriesId: series.id }, order: [['occurrenceIndex', 'ASC']] });
    assert.equal(rows.length, 3, 'exactly the today/+7/+14 occurrences materialize');
    for (const row of rows) {
        assert.ok(String(row.date) >= today, `no appointment before today (got ${row.date})`);
        assert.equal(row.status, 'pending', 'occurrences land pending for salon confirmation');
    }
    assert.deepEqual(rows.map((r) => String(r.date)), [today, addDays(today, 7), addDays(today, 14)]);

    // occurrencesCreated advanced past the back-dated indices — a second
    // sweep must start scanning AFTER them instead of re-deciding skip.
    let s = await series.reload();
    assert.ok(s.occurrencesCreated >= 3, `occurrencesCreated advanced past the back-dated occurrences (got ${s.occurrencesCreated})`);

    const stats2 = await materializeDueSeries({ today, horizonDays: 14 });
    assert.equal(stats2.created, 0, 'second sweep creates nothing');
    rows = await Appointment.findAll({ where: { seriesId: series.id } });
    assert.equal(rows.length, 3, 'still exactly three occurrences');
    s = await series.reload();
    assert.equal(s.occurrencesCreated, 3, 'counter stable');
});
