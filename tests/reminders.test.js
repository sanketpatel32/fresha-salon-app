const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Appointment = require('../models/appointmentModel');

// Stub the email helper BEFORE reminderService is required (same trick as
// tips stubbed Cashfree). reminderService deliberately calls it through the
// module namespace, so the property is read at call time — the spy below
// records every send and can be swapped for rejecters/the real no-op mid-run.
const emailService = require('../services/emailService');
const realReminderSend = emailService.sendAppointmentReminderEmail;
const reminderCalls = [];
emailService.sendAppointmentReminderEmail = async (toEmail, ctx) => {
    reminderCalls.push({ toEmail, ...ctx });
    return { sent: true };
};

const { appointmentReminderSubject } = require('../services/emailService');
const { pickReminders, runReminderSweep, isSchedulerEnabled, REMINDER_WINDOW_HOURS }
    = require('../services/reminderService');
const { getUpcomingAppointments } = require('../controllers/appointmentController');
const appointmentRoutes = require('../routes/appointmentRoutes');

// Minimal req/res stubs for invoking controllers directly
// (established mock style across the suites).
const mockReq = (overrides = {}) => ({ user: {}, query: {}, params: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

// Local-time helpers: DATEONLY/TIME columns round-trip as plain strings.
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hms = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fromNowH = (hours) => new Date(Date.now() + hours * 3600 * 1000);

let customerA, customerB, salonA, staffA, serviceA;

before(async () => {
    await sequelize.sync({ force: true });
    // Force the mailer unconfigured for this run so any REAL send resolves to
    // the documented no-op instead of a Brevo call (.env ships keys).
    delete process.env.BREVO_API_KEY;
    delete process.env.SENDER_EMAIL;

    customerA = await User.create({ name: 'Ann Upcoming', email: 'ann@t.com', password: 'x', phoneNumber: '1' });
    customerB = await User.create({ name: 'Bob Other', email: 'bob@t.com', password: 'x', phoneNumber: '9' });
    salonA = await Salons.create({
        name: 'Remind Salon', email: 'rs@t.com', password: 'x', phoneNumber: '2', address: 'a', pricing: 'Premium',
        workingDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '00:00', closingTime: '23:59',
    });
    staffA = await Staff.create({ name: 'Stylist Remind', email: 'str@t.com', password: 'x', phoneNumber: '3', salonId: salonA.id });
    serviceA = await Services.create({ name: 'Reminder Cut', price: 100, duration: 30, salonId: salonA.id });
});

after(async () => { await sequelize.close(); });

// Appointment fixture factory; offsets are hours relative to now so every
// row sits exactly where the test intends regardless of wall-clock time.
const mkAppt = async ({ startInHours, status = 'confirmed', userId = customerA.id, reminded = false }) => {
    const start = fromNowH(startInHours);
    return Appointment.create({
        userId,
        salonId: salonA.id,
        staffId: staffA.id,
        serviceId: serviceA.id,
        date: ymd(start),
        time: hms(start),
        endTime: hms(new Date(start.getTime() + 30 * 60 * 1000)),
        status,
        ...(reminded ? { reminderSentAt: new Date() } : {}),
    });
};

const startMsOf = (row) => new Date(`${row.date}T${row.time}`).getTime();

// ── pickReminders: pure window boundaries ─────────────────────────────────

test('pickReminders includes a start EXACTLY at now+24h and excludes now+24h+1ms', () => {
    const now = new Date('2026-08-24T10:00:00');
    const horizon = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 3600 * 1000);
    const justInside = new Date(horizon.getTime() - 1);
    const justOutside = new Date(horizon.getTime() + 1);

    const rows = [
        { date: ymd(justOutside), time: `${hms(justOutside)}.${justOutside.getMilliseconds()}`, reminderSentAt: null },
        { date: ymd(horizon), time: `${hms(horizon)}.${horizon.getMilliseconds()}`, reminderSentAt: null },
        { date: ymd(justInside), time: `${hms(justInside)}.${justInside.getMilliseconds()}`, reminderSentAt: null },
    ];
    const picked = pickReminders(rows, now);
    assert.equal(picked.length, 2, 'exactly-24h and just-inside pass, +1ms fails');
    assert.deepEqual(picked.map((r) => r.date), [ymd(horizon), ymd(justInside)]);
});

test('pickReminders excludes past starts (strictly-after rule) and already-reminded rows', () => {
    const now = new Date('2026-08-24T10:00:00');
    const rows = [
        { date: '2026-08-24', time: '09:59:59', reminderSentAt: null },   // past
        { date: '2026-08-24', time: '10:00:00', reminderSentAt: null },   // start == now -> not strictly after
        { date: '2026-08-24', time: '11:00:00', reminderSentAt: new Date() }, // in window BUT claimed
        { date: '2026-08-24', time: '12:00:00', reminderSentAt: null },   // due
    ];
    const picked = pickReminders(rows, now);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].time, '12:00:00');
});

test('pickReminders skips unparseable slots instead of throwing on garbage rows', () => {
    const now = new Date('2026-08-24T10:00:00');
    const picked = pickReminders([{ date: 'not-a-date', time: 'nope' }, null], now);
    assert.equal(picked.length, 0);
});

// ── appointmentReminderSubject: pure copy helper ──────────────────────────

test('appointmentReminderSubject mentions the salon without sending anything', () => {
    assert.match(appointmentReminderSubject('Remind Salon'), /^Reminder: .*Remind Salon/);
    assert.match(appointmentReminderSubject(), /the salon/, 'falls back to a generic venue');
});

// ── runReminderSweep end-to-end against real SQLite fixtures ─────────────

test('runReminderSweep stamps + emails only in-window live bookings (far/past/wrong-status untouched)', async () => {
    const dueRow = await mkAppt({ startInHours: 23 });
    const farFuture = await mkAppt({ startInHours: 5 * 24 });
    const pastRow = await mkAppt({ startInHours: -1 });
    const cancelled = await mkAppt({ startInHours: 22, status: 'cancelled' });
    const completed = await mkAppt({ startInHours: 21, status: 'completed' });

    reminderCalls.length = 0;
    const NOW = new Date();
    const summary = await runReminderSweep(NOW);

    // Candidates = live (pending|confirmed) unstamped rows within the cheap
    // date prefilter: the due row + the past one. farFuture is cut in SQL;
    // cancelled/completed never even match the status filter.
    assert.equal(summary.candidates, 2);
    assert.equal(summary.due, 1);
    assert.equal(summary.reminded, 1);

    const stamped = await Appointment.findByPk(dueRow.id);
    assert.ok(stamped.reminderSentAt, 'reminderSentAt persisted on the swept booking');
    for (const untouched of [farFuture, pastRow, cancelled, completed]) {
        const row = await Appointment.findByPk(untouched.id);
        assert.equal(row.reminderSentAt, null, `status=${row.status}/past rows stay unstamped`);
    }

    assert.equal(reminderCalls.length, 1);
    assert.deepEqual(reminderCalls[0], {
        toEmail: 'ann@t.com',
        salonName: salonA.name,
        serviceName: serviceA.name,
        date: stamped.date,
        time: stamped.time,
    });
});

test('a second sweep is a no-op for the stamped row (idempotent)', async () => {
    reminderCalls.length = 0;
    const summary = await runReminderSweep(new Date());

    assert.equal(summary.due, 0);
    assert.equal(reminderCalls.length, 0, 'no double-sending across sweeps/restarts');
});

test('an unconfigured mailer still counts as handled: row is stamped, sweep survives', async () => {
    // Swap the spy for the REAL helper while Brevo env is deleted in before()
    // — it must resolve to the documented no-op and still claim the booking.
    emailService.sendAppointmentReminderEmail = realReminderSend;
    const result = await realReminderSend('ann@t.com', { salonName: 'X' });
    assert.deepEqual(result, { sent: false, reason: 'not-configured' });

    const row = await mkAppt({ startInHours: 20 });
    const summary = await runReminderSweep(new Date());
    assert.equal(summary.due, 1);
    const stamped = await Appointment.findByPk(row.id);
    assert.ok(stamped.reminderSentAt, 'stamp lands even when no mail can go out');

    emailService.sendAppointmentReminderEmail = async (toEmail, ctx) => {
        reminderCalls.push({ toEmail, ...ctx });
        return { sent: true };
    };
});

test('claim-first: a rejecting email helper cannot break the sweep or undo the stamp', async () => {
    emailService.sendAppointmentReminderEmail = async () => { throw new Error('smtp exploded'); };
    const row = await mkAppt({ startInHours: 19 });

    const summary = await runReminderSweep(new Date());
    assert.equal(summary.reminded, 1, 'the failure was swallowed, sweep completed');
    const stamped = await Appointment.findByPk(row.id);
    assert.ok(stamped.reminderSentAt, 'at-most-once: stamp precedes the send attempt');

    emailService.sendAppointmentReminderEmail = async (toEmail, ctx) => {
        reminderCalls.push({ toEmail, ...ctx });
        return { sent: true };
    };
});

// ── GET /api/appointment/upcoming ─────────────────────────────────────────

test('upcoming endpoint: only own pending|confirmed future rows, soonest-first, capped at 5', async () => {
    // Nine eligible rows 2h apart — the five soonest are deterministic.
    const eligible = [];
    for (let k = 1; k <= 9; k += 1) {
        eligible.push(await mkAppt({ startInHours: k * 2, status: k % 2 ? 'pending' : 'confirmed' }));
    }
    // Ineligible noise: terminal statuses, a past booking, another customer's.
    await mkAppt({ startInHours: 5, status: 'cancelled' });
    await mkAppt({ startInHours: 7, status: 'completed' });
    await mkAppt({ startInHours: 9, status: 'declined' });
    await mkAppt({ startInHours: -24 });                       // own but past
    const bFuture = await mkAppt({ startInHours: 4, userId: customerB.id }); // foreign

    const res = mockRes();
    await getUpcomingAppointments(mockReq({ user: { userId: customerA.id, role: 'customer' } }), res);

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body), 'bare-array response');
    assert.equal(res.body.length, 5, 'LIMIT 5 enforced');

    const ids = res.body.map((r) => r.id);
    const expectedSoonFive = eligible.slice(0, 5).map((r) => r.id).sort((x, y) => x - y);
    assert.deepEqual([...ids].sort((x, y) => x - y), expectedSoonFive, 'exactly the five soonest own bookings');

    const starts = res.body.map(startMsOf);
    for (let i = 1; i < starts.length; i += 1) {
        assert.ok(starts[i] >= starts[i - 1], 'ordered soonest-first');
    }
    for (const row of res.body) {
        assert.equal(row.userId, customerA.id, "other customers' rows absent");
        assert.ok(['pending', 'confirmed'].includes(row.status), 'terminal statuses excluded');
        assert.ok(startMsOf(row) > Date.now(), 'starts strictly in the future');
    }
    assert.ok(!ids.includes(bFuture.id));
});

test('upcoming endpoint catches same-day rows via the time branch (earlier-today excluded)', async () => {
    // Wipe the slate so this probe is exact: one row ~90s ahead today and one
    // earlier-today slot. The 90s row exercises (date = today AND time > now);
    // an hour-ago slot must be dropped even though its date equals today.
    await Appointment.destroy({ where: {} });
    const upcomingSoon = await mkAppt({ startInHours: 90 / 3600 });
    await mkAppt({ startInHours: -1 });

    const res = mockRes();
    await getUpcomingAppointments(mockReq({ user: { userId: customerA.id, role: 'customer' } }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.map((r) => r.id), [upcomingSoon.id]);
});

test("upcoming scoping: customer B sees only B's rows", async () => {
    const mine = await mkAppt({ startInHours: 30, userId: customerB.id });
    const theirs = await mkAppt({ startInHours: 31, userId: customerA.id });

    const res = mockRes();
    await getUpcomingAppointments(mockReq({ user: { userId: customerB.id, role: 'customer' } }), res);
    const ids = res.body.map((r) => r.id);
    assert.ok(ids.includes(mine.id));
    assert.ok(!ids.includes(theirs.id), "another customer's booking never leaks");
});

test('routes: /api/appointment/upcoming is auth -> roleGuard(customer) -> controller', () => {
    const layer = appointmentRoutes.stack.find((l) => l.route && l.route.path === '/upcoming');
    assert.ok(layer, '/upcoming route should be registered');
    const handlers = layer.route.stack.map((s) => s.handle);
    assert.equal(handlers.length, 3, 'exactly three handlers');
    assert.equal(handlers[0].name, 'isAuth', 'must sit behind authMiddleware');
    assert.equal(handlers[1].name, 'roleGuard', 'must sit behind requireRole(customer)');
    assert.match(handlers[2].name, /^getUpcoming/, 'terminal handler must be its controller');
});

// ── scheduler guard (direct function check — app.js itself binds a port) ──

test('REMINDERS_DISABLED=1 disables scheduling; anything else keeps it on', () => {
    assert.equal(isSchedulerEnabled({}), true, 'unset -> enabled');
    assert.equal(isSchedulerEnabled({ REMINDERS_DISABLED: '0' }), true, 'any other value -> enabled');
    assert.equal(isSchedulerEnabled({ REMINDERS_DISABLED: '1' }), false, '=1 -> disabled');
    assert.equal(typeof isSchedulerEnabled(), 'boolean', 'falls back to process.env safely');
});
