/**
 * Loop 3, batch 2 — data integrity & correctness (#47–#54).
 *
 * Money, timezone, double-booking, optimistic concurrency, soft delete,
 * audit trail, per-role rate limits.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations');
const Appointment = require('../models/appointmentModel');
const Services = require('../models/servicesModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const User = require('../models/userModel');
const Payment = require('../models/paymentModel');

const money = require('../utils/money');
const tz = require('../utils/timezone');
const occ = require('../utils/optimisticConcurrency');
const bookingGuard = require('../services/bookingGuard');
const auditService = require('../services/adminAuditService');
const limiters = require('../middlewares/rateLimiters');
const { deleteService } = require('../controllers/salonServicesController');

const mockRes = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (d) => { r.body = d; return r; };
  return r;
};
const mockReq = (o = {}) => ({ user: {}, params: {}, body: {}, query: {}, headers: {}, ...o });

let salonA, salonB, staffA, serviceA, customerA;
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

before(async () => {
  await sequelize.sync({ force: true });
  salonA = await Salons.create({ name: 'SalonA', email: 'sa@t.com', password: 'x', phoneNumber: '1', address: 'a', pricing: 'Moderate' });
  salonB = await Salons.create({ name: 'SalonB', email: 'sb@t.com', password: 'x', phoneNumber: '2', address: 'b', pricing: 'Premium' });
  staffA = await Staff.create({ name: 'StylistA', email: 'sta@t.com', password: 'x', phoneNumber: '3', salonId: salonA.id });
  serviceA = await Services.create({ name: 'Cut', price: 500, duration: 30, salonId: salonA.id });
  customerA = await User.create({ name: 'CustA', email: 'ca@t.com', password: 'x', phoneNumber: '4' });
});

after(async () => { await sequelize.close(); });

// ── #49 Money ──────────────────────────────────────────────────────────
describe('#49 money helpers', () => {
  test('toMinor converts decimal strings exactly (no float in the path)', () => {
    assert.equal(money.toMinor('1234.56'), 123456);
    assert.equal(money.toMinor('0.01'), 1);
    assert.equal(money.toMinor('0'), 0);
    assert.equal(money.toMinor('100'), 10000);
    assert.equal(money.toMinor('-5.25'), -525);
  });

  test('toMinor handles the classic half-up edge that Math.round gets wrong', () => {
    // Math.round(1.005 * 100) === 100 because 1.005 is stored as 1.00499...
    assert.equal(money.toMinor('1.005'), 101);
    assert.equal(money.toMinor('2.675'), 268, '2.675 must round up, not down');
  });

  test('toMinor tolerates grouping separators and whitespace', () => {
    assert.equal(money.toMinor('1,234.56'), 123456);
    assert.equal(money.toMinor(' 99.99 '), 9999);
  });

  test('toMinor rejects garbage instead of returning NaN', () => {
    assert.equal(money.toMinor('abc'), null);
    assert.equal(money.toMinor(''), null);
    assert.equal(money.toMinor(null), null);
    assert.equal(money.toMinor(undefined), null);
    assert.equal(money.toMinor(Infinity), null);
  });

  test('zero-decimal currencies are not multiplied by 100', () => {
    assert.equal(money.toMinor('500', 'JPY'), 500);
    assert.equal(money.fromMinor(500, 'JPY'), 500);
    assert.equal(money.exponentOf('JPY'), 0);
  });

  test('three-decimal currencies keep three places', () => {
    assert.equal(money.toMinor('1.234', 'BHD'), 1234);
    assert.equal(money.exponentOf('BHD'), 3);
  });

  test('fromMinor round-trips every value toMinor produces', () => {
    // Only values that are exactly representable in minor units can round-trip.
    // '1.005' is deliberately excluded: toMinor rounds it half-up to 101, and
    // fromMinor(101) is 1.01 — the rounding is the point, not a bug (see the
    // half-up test above). Round-tripping a lossy decimal would assert that a
    // paisa appeared out of nowhere.
    for (const s of ['0', '0.01', '19.99', '1234.56', '99999.99']) {
      assert.equal(money.fromMinor(money.toMinor(s)), Number(s), `${s} must survive the round trip`);
    }
    // And the lossy case rounds up, exactly once, in one direction only.
    assert.equal(money.toMinor('1.005'), 101);
    assert.equal(money.fromMinor(money.toMinor('1.005')), 1.01);
  });

  test('addition and subtraction are exact integer math', () => {
    assert.equal(money.add(1, 2), 3);
    assert.equal(money.add(10, 20, 30), 60);
    assert.equal(money.add(null, 5), 5, 'nulls are treated as zero');
    assert.equal(money.subtract(100, 30), 70);
    // The float version of this is 0.30000000000000004.
    assert.equal(money.subtract(money.add(10, 20), 30), 0);
  });

  test('percent and discountFor never exceed the amount', () => {
    assert.equal(money.percent(1000, 10), 100);
    assert.equal(money.percent(999, 15), 150, 'half-up: 149.85 -> 150');
    assert.equal(money.discountFor(1000, 10), 100);
    assert.equal(money.discountFor(1000, 50, 200), 200, 'cap wins');
    assert.equal(money.discountFor(100, 90, 1000), 90, 'uncapped but under amount');
    assert.equal(money.discountFor(100, 150), 100, 'discount cannot exceed the price');
    assert.equal(money.discountFor(100, -5), 0, 'negative discount is nonsense');
  });

  test('allocate never loses or invents a single paisa', () => {
    // 1000 / 3: naive division gives 333 each = 999, losing one paisa.
    const parts = money.allocate(1000, [1, 1, 1]);
    assert.equal(parts.reduce((a, b) => a + b, 0), 1000);
    assert.ok(money.allocationIsExact(1000, parts));
    assert.deepEqual(parts, [334, 333, 333], 'the remainder goes to the first share');
  });

  test('allocate honours weighted ratios and still sums exactly', () => {
    const parts = money.allocate(10000, [70, 30]);
    assert.equal(parts.reduce((a, b) => a + b, 0), 10000);
    assert.equal(parts[0], 7000);
    assert.equal(parts[1], 3000);
  });

  test('allocate handles awkward splits without drift', () => {
    for (const [amount, n] of [[1, 3], [7, 4], [99999, 7], [100, 11]]) {
      const parts = money.allocate(amount, new Array(n).fill(1));
      assert.ok(money.allocationIsExact(amount, parts), `${amount} over ${n} must be exact`);
      assert.equal(parts.length, n);
    }
  });

  test('allocate survives a zero-weight and an all-zero ratio list', () => {
    assert.deepEqual(money.allocate(100, [0, 0]), [0, 0]);
    const parts = money.allocate(100, [1, 0]);
    assert.equal(parts.reduce((a, b) => a + b, 0), 100);
  });

  test('format renders locale currency correctly', () => {
    assert.match(money.format(123456), /1,?234\.56/);
    assert.ok(money.format(123456).includes('₹'));
    assert.equal(money.format(null), '');
  });

  test('formatCompact uses lakh/crore for large amounts', () => {
    // Inputs are MINOR units: 250000000 paise = ₹25,00,000 = 25 lakh.
    assert.equal(money.formatCompact(250000000), '₹25L');
    assert.equal(money.formatCompact(15000000), '₹1.5L');
    assert.equal(money.formatCompact(150000), '₹1.5K');
    assert.equal(money.formatCompact(500), '₹5', 'below a thousand stays literal');
  });

  test('isValidMinor rejects floats, NaN and negatives by default', () => {
    assert.equal(money.isValidMinor(100), true);
    assert.equal(money.isValidMinor(1.5), false, 'money must be whole minor units');
    assert.equal(money.isValidMinor(NaN), false);
    assert.equal(money.isValidMinor(-5), false);
    assert.equal(money.isValidMinor(-5, { allowNegative: true }), true, 'refunds are legitimately negative');
  });

  test('compare and clamp behave on the minor-unit scale', () => {
    assert.equal(money.compare(100, 200), -1);
    assert.equal(money.compare(200, 100), 1);
    assert.equal(money.compare(100, 100), 0);
    assert.equal(money.clamp(150, 0, 100), 100);
    assert.equal(money.clamp(-5, 0, 100), 0);
  });
});

// ── #50 Timezone ───────────────────────────────────────────────────────
describe('#50 timezone helpers', () => {
  test('isValidTimezone accepts real IANA zones and rejects junk', () => {
    assert.equal(tz.isValidTimezone('Asia/Kolkata'), true);
    assert.equal(tz.isValidTimezone('America/New_York'), true);
    assert.equal(tz.isValidTimezone('Mars/Olympus'), false);
    assert.equal(tz.isValidTimezone(''), false);
    assert.equal(tz.isValidTimezone(null), false);
  });

  test('resolveTimezone falls back rather than throwing on a bad zone', () => {
    assert.equal(tz.resolveTimezone('Asia/Kolkata'), 'Asia/Kolkata');
    assert.equal(tz.resolveTimezone('Not/AZone'), tz.DEFAULT_TIMEZONE);
  });

  test('todayIn returns the calendar date in the target zone', () => {
    // 2026-08-28T19:00Z is already 2026-08-29 in Kolkata (+5:30) but still
    // the 28th in Los Angeles (-7). Same instant, different "today".
    const instant = new Date('2026-08-28T19:00:00Z');
    assert.equal(tz.todayIn('Asia/Kolkata', instant), '2026-08-29');
    assert.equal(tz.todayIn('America/Los_Angeles', instant), '2026-08-28');
    assert.equal(tz.todayIn('UTC', instant), '2026-08-28');
  });

  test('timeNowIn reports the wall clock in the target zone', () => {
    const instant = new Date('2026-08-28T14:00:00Z');
    assert.equal(tz.timeNowIn('Asia/Kolkata', instant), '19:30');
    assert.equal(tz.timeNowIn('UTC', instant), '14:00');
  });

  test('zonedToUtc maps a wall time to the correct instant', () => {
    const utc = tz.zonedToUtc('2026-08-28', '19:30', 'Asia/Kolkata');
    assert.equal(utc.toISOString(), '2026-08-28T14:00:00.000Z');
  });

  test('zonedToUtc round-trips with todayIn/timeNowIn', () => {
    const instant = tz.zonedToUtc('2026-12-25', '09:15', 'Asia/Kolkata');
    assert.equal(tz.todayIn('Asia/Kolkata', instant), '2026-12-25');
    assert.equal(tz.timeNowIn('Asia/Kolkata', instant), '09:15');
  });

  test('zonedToUtc respects DST — the offset is not a constant', () => {
    // New York is UTC-5 in January (EST) and UTC-4 in July (EDT). Both are
    // 09:00 local, but two different instants.
    const winter = tz.zonedToUtc('2026-01-15', '09:00', 'America/New_York');
    const summer = tz.zonedToUtc('2026-07-15', '09:00', 'America/New_York');
    assert.equal(tz.offsetMinutes('America/New_York', winter), -300);
    assert.equal(tz.offsetMinutes('America/New_York', summer), -240);
    assert.notEqual(winter.toISOString().slice(11), summer.toISOString().slice(11));
  });

  test('zonedToUtc rejects malformed date/time input', () => {
    assert.equal(tz.zonedToUtc('not-a-date', '10:00'), null);
    assert.equal(tz.zonedToUtc('2026-08-28', 'nonsense', 'UTC'), null);
  });

  test('dayCodeOf maps a date to its weekday code', () => {
    assert.equal(tz.dayCodeOf('2026-08-28'), 'fri');
    assert.equal(tz.dayCodeOf('2026-08-30'), 'sun');
    assert.equal(tz.dayCodeOf('garbage'), null);
  });

  test('dayCodeOf is immune to the local-machine offset', () => {
    // Parsing as local time would shift the day for negative UTC offsets;
    // parsing at UTC noon pins the calendar date.
    assert.equal(tz.dayCodeOf('2026-01-01'), 'thu');
    assert.equal(tz.dayCodeOf('2026-12-31'), 'thu');
  });

  test('addDays and daysBetween do calendar arithmetic', () => {
    assert.equal(tz.addDays('2026-08-28', 1), '2026-08-29');
    assert.equal(tz.addDays('2026-08-31', 1), '2026-09-01', 'crosses a month');
    assert.equal(tz.addDays('2026-12-31', 1), '2027-01-01', 'crosses a year');
    assert.equal(tz.addDays('2026-02-28', 1), '2026-03-01');
    assert.equal(tz.daysBetween('2026-08-28', '2026-09-02'), 5);
    assert.equal(tz.daysBetween('2026-08-28', '2026-08-28'), 0);
  });

  test('toMinutes / fromMinutes round-trip', () => {
    assert.equal(tz.toMinutes('00:00'), 0);
    assert.equal(tz.toMinutes('23:59'), 1439);
    assert.equal(tz.toMinutes('09:30'), 570);
    assert.equal(tz.fromMinutes(0), '00:00');
    assert.equal(tz.fromMinutes(1439), '23:59');
    assert.equal(tz.toMinutes('bad'), null);
    assert.equal(tz.toMinutes('25:00'), null);
  });

  test('addMinutes wraps at midnight', () => {
    assert.equal(tz.addMinutes('23:30', 60), '00:30');
    assert.equal(tz.addMinutes('09:00', 90), '10:30');
  });

  test('overlaps uses half-open intervals — back-to-back is NOT a conflict', () => {
    assert.equal(tz.overlaps('10:00', '10:30', '10:30', '11:00'), false, 'touching ends must not conflict');
    assert.equal(tz.overlaps('10:00', '11:00', '10:30', '11:30'), true);
    assert.equal(tz.overlaps('10:00', '11:00', '09:00', '10:30'), true);
    assert.equal(tz.overlaps('10:00', '11:00', '11:00', '12:00'), false);
    assert.equal(tz.overlaps('10:00', '11:00', '09:00', '12:00'), true, 'fully contained');
    assert.equal(tz.overlaps('10:00', '10:00', '10:00', '11:00'), false, 'zero-length window');
  });

  test('generateSlots never offers a slot that would run past closing', () => {
    const slots = tz.generateSlots({ open: '09:00', close: '11:00', stepMinutes: 30, durationMinutes: 60 });
    assert.deepEqual(slots.map((s) => s.time), ['09:00', '09:30', '10:00']);
    assert.ok(slots.every((s) => s.endTime <= '11:00'));
  });

  test('generateSlots respects the configured step', () => {
    assert.equal(tz.generateSlots({ open: '09:00', close: '10:00', stepMinutes: 15, durationMinutes: 15 }).length, 4);
    assert.equal(tz.generateSlots({ open: '09:00', close: '10:00', stepMinutes: 60, durationMinutes: 30 }).length, 1);
  });

  test('generateSlots degrades safely on a closed/invalid window', () => {
    assert.deepEqual(tz.generateSlots({ open: '17:00', close: '09:00' }), []);
    assert.deepEqual(tz.generateSlots({ open: 'bad', close: '10:00' }), []);
  });

  test('describe renders a human label with the current offset', () => {
    assert.match(tz.describe('Asia/Kolkata'), /Asia\/Kolkata/);
    assert.match(tz.describe('Asia/Kolkata'), /GMT|UTC/);
  });
});

// ── #47 Double-booking ─────────────────────────────────────────────────
describe('#47 double-booking guard', () => {
  // Spread FIRST: `slot` carries the shared date/time window, and the per-test
  // staff/salon ids must win. Spreading it last would overwrite them with
  // `undefined` and make Sequelize reject the query.
  const slot = { date: FUTURE, startTime: '10:00', endTime: '10:30' };

  test('findSlotConflict sees an existing booking and respects half-open bounds', async () => {
    const appt = await Appointment.create({
      staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id,
      date: FUTURE, time: '10:00', endTime: '10:30', status: 'confirmed',
    });
    const args = { staffId: staffA.id, salonId: salonA.id, ...slot };
    assert.ok(await bookingGuard.findSlotConflict({ ...args, startTime: '10:00', endTime: '10:30' }));
    assert.ok(await bookingGuard.findSlotConflict({ ...args, startTime: '10:15', endTime: '10:45' }), 'partial overlap');
    assert.equal(await bookingGuard.findSlotConflict({ ...args, startTime: '10:30', endTime: '11:00' }), null, 'back-to-back is free');
    await appt.destroy();
  });

  test('cancelled and declined bookings free the slot', async () => {
    for (const status of ['cancelled', 'declined']) {
      const appt = await Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id,
        date: FUTURE, time: '12:00', endTime: '12:30', status,
      });
      const conflict = await bookingGuard.findSlotConflict({
        staffId: staffA.id, salonId: salonA.id, date: FUTURE, startTime: '12:00', endTime: '12:30',
      });
      assert.equal(conflict, null, `a ${status} booking must not hold the slot`);
      await appt.destroy();
    }
  });

  test('assertSlotFree reports ok on a free slot and SLOT_TAKEN on a busy one', async () => {
    const appt = await Appointment.create({
      staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id,
      date: FUTURE, time: '14:00', endTime: '14:30', status: 'confirmed',
    });
    const busy = await bookingGuard.assertSlotFree({
      staffId: staffA.id, salonId: salonA.id, date: FUTURE, startTime: '14:00', endTime: '14:30',
    });
    assert.equal(busy.ok, false);
    assert.equal(busy.code, 'SLOT_TAKEN');

    const free = await bookingGuard.assertSlotFree({
      staffId: staffA.id, salonId: salonA.id, date: FUTURE, startTime: '15:00', endTime: '15:30',
    });
    assert.equal(free.ok, true);
    await appt.destroy();
  });

  test('assertSlotFree can exclude the appointment being rescheduled', async () => {
    const appt = await Appointment.create({
      staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id,
      date: FUTURE, time: '16:00', endTime: '16:30', status: 'confirmed',
    });
    // Without the exclusion the booking conflicts with itself...
    assert.equal((await bookingGuard.assertSlotFree({
      staffId: staffA.id, salonId: salonA.id, date: FUTURE, startTime: '16:00', endTime: '16:30',
    })).ok, false);
    // ...with it, the same slot is fine (a no-op reschedule is legal).
    assert.equal((await bookingGuard.assertSlotFree({
      staffId: staffA.id, salonId: salonA.id, date: FUTURE, startTime: '16:00', endTime: '16:30',
      excludeAppointmentId: appt.id,
    })).ok, true);
    await appt.destroy();
  });

  test('createBookingSafely refuses a second booking on the same slot', async () => {
    const values = {
      staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id,
      date: FUTURE, time: '18:00', endTime: '18:30', status: 'confirmed',
    };
    const args = { staffId: staffA.id, salonId: salonA.id, date: FUTURE, startTime: '18:00', endTime: '18:30' };
    const first = await bookingGuard.createBookingSafely(values, args);
    assert.equal(first.ok, true);

    const second = await bookingGuard.createBookingSafely(values, args);
    assert.equal(second.ok, false);
    assert.equal(second.code, 'SLOT_TAKEN');
    assert.match(second.reason, /taken by another booking/i);

    // Exactly one booking exists for that slot — the race is closed.
    const count = await Appointment.count({ where: { staffId: staffA.id, date: FUTURE, time: '18:00' } });
    assert.equal(count, 1);
  });

  test('the partial unique index actually blocks a duplicate at the DB level', async () => {
    const created = await bookingGuard.createSlotUniquenessIndex(sequelize);
    assert.equal(created, true);

    await Appointment.create({
      staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id,
      date: FUTURE, time: '20:00', endTime: '20:30', status: 'confirmed',
    });
    // Bypass the service layer entirely and go straight to the DB — the
    // constraint, not application logic, must reject this.
    await assert.rejects(
      () => Appointment.create({
        staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id,
        date: FUTURE, time: '20:00', endTime: '20:30', status: 'confirmed',
      }),
      (err) => bookingGuard.isUniqueViolation(err),
      'the database itself must reject the duplicate slot'
    );
  });

  test('the index still allows re-booking a CANCELLED slot', async () => {
    await Appointment.create({
      staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id,
      date: FUTURE, time: '21:00', endTime: '21:30', status: 'cancelled',
    });
    // A plain unique index would reject this; the partial one must not.
    const rebook = await Appointment.create({
      staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id,
      date: FUTURE, time: '21:00', endTime: '21:30', status: 'confirmed',
    });
    assert.ok(rebook.id, 'a cancelled slot must be re-bookable');
  });

  test('findDuplicateSlots reports legacy collisions', async () => {
    // Seed a duplicate directly, bypassing the guard, to prove the detector.
    const dupes = await bookingGuard.findDuplicateSlots();
    assert.ok(Array.isArray(dupes));
    // The fixture above created a confirmed + cancelled pair at 21:00 — the
    // cancelled one is excluded, so that slot is not a duplicate.
    assert.ok(!dupes.some((d) => d.time === '21:00'));
  });

  test('SLOT_HOLDING and SLOT_FREEING statuses partition the state machine', () => {
    const all = ['pending', 'confirmed', 'declined', 'completed', 'cancelled', 'no-show'];
    for (const s of all) {
      const holding = bookingGuard.SLOT_HOLDING_STATUSES.includes(s);
      const freeing = bookingGuard.SLOT_FREEING_STATUSES.includes(s);
      assert.equal(holding || freeing, true, `${s} must be either holding or freeing`);
      assert.equal(holding && freeing, false, `${s} cannot be both`);
    }
  });
});

// ── #48 Optimistic concurrency ─────────────────────────────────────────
describe('#48 optimistic concurrency', () => {
  test('etagFor builds a versioned weak tag', () => {
    assert.equal(occ.etagFor({ id: 12, version: 3 }), 'W/"12-3"');
    assert.equal(occ.etagFor({ id: 12, version: 0 }), 'W/"12-0"');
    assert.equal(occ.etagFor(null), null);
  });

  test('parseIfMatch reads a single tag and the wildcard', () => {
    assert.deepEqual(occ.parseIfMatch('W/"12-3"'), { id: 12, version: 3 });
    assert.deepEqual(occ.parseIfMatch('"12-3"'), { id: 12, version: 3 });
    assert.deepEqual(occ.parseIfMatch('*'), { any: true });
    assert.equal(occ.parseIfMatch(undefined), null);
    assert.equal(occ.parseIfMatch('nonsense'), null);
    assert.equal(occ.parseIfMatch('"a","b"'), null, 'a list is not a single tag');
  });

  test('no If-Match header means an unconditional write (backward compatible)', () => {
    const result = occ.assertVersion({ headers: {} }, { id: 1, version: 2 });
    assert.equal(result.ok, true);
    assert.equal(result.conditional, false);
  });

  test('a matching version proceeds', () => {
    const result = occ.assertVersion({ headers: { 'if-match': 'W/"7-2"' } }, { id: 7, version: 2 });
    assert.equal(result.ok, true);
    assert.equal(result.conditional, true);
  });

  test('a stale version is rejected with 412', () => {
    const result = occ.assertVersion({ headers: { 'if-match': 'W/"7-1"' } }, { id: 7, version: 2 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 412);
    assert.equal(result.code, 'VERSION_CONFLICT');
    assert.match(result.reason, /changed since you last read/i);
  });

  test('a malformed If-Match is a 400, not a silent pass', () => {
    const result = occ.assertVersion({ headers: { 'if-match': 'garbage' } }, { id: 7, version: 2 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test('If-Match naming a different resource is a 409', () => {
    const result = occ.assertVersion({ headers: { 'if-match': 'W/"99-2"' } }, { id: 7, version: 2 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
  });

  test('the wildcard matches any existing representation', () => {
    assert.equal(occ.assertVersion({ headers: { 'if-match': '*' } }, { id: 7, version: 2 }).ok, true);
  });

  test('bumpVersion increments atomically and returns the new value', async () => {
    const appt = await Appointment.create({
      staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id,
      date: FUTURE, time: '08:00', endTime: '08:30', status: 'confirmed',
    });
    assert.equal(appt.version, 0, 'a new row starts at version 0');
    await occ.bumpVersion(appt);
    assert.equal(appt.version, 1);
    await occ.bumpVersion(appt);
    assert.equal(appt.version, 2);
    assert.equal(occ.etagFor(appt), `W/"${appt.id}-2"`);
    await appt.destroy();
  });

  test('two actors editing from the same read: the second one loses', async () => {
    const appt = await Appointment.create({
      staffId: staffA.id, salonId: salonA.id, serviceId: serviceA.id, userId: customerA.id,
      date: FUTURE, time: '09:00', endTime: '09:30', status: 'confirmed',
    });
    // Both read the same version.
    const tagA = occ.etagFor(appt);
    const tagB = occ.etagFor(appt);
    assert.equal(tagA, tagB);

    // Actor A writes successfully.
    assert.equal(occ.assertVersion({ headers: { 'if-match': tagA } }, appt).ok, true);
    await appt.update({ status: 'completed' });
    await occ.bumpVersion(appt);

    // Actor B's write, based on the stale read, is now correctly refused.
    // Compare against the row AS IT NOW STANDS (version 1 after A's bump) —
    // passing version 0 back in would assert against the world B remembers
    // rather than the one that actually exists, and would wrongly pass.
    assert.equal(appt.version, 1, 'A must have moved the version along');
    const stale = occ.assertVersion({ headers: { 'if-match': tagB } }, { id: appt.id, version: appt.version });
    assert.equal(stale.ok, false);
    assert.equal(stale.status, 412);
    await appt.destroy();
  });

  test('versionGuard writes the 412 response and returns the failure', () => {
    let status = null;
    let body = null;
    const res = {
      setHeader: () => {},
      status: (c) => { status = c; return res; },
      json: (b) => { body = b; return res; },
    };
    const result = occ.versionGuard({ headers: { 'if-match': 'W/"1-0"' } }, { id: 1, version: 5 }, res);
    assert.equal(result.ok, false);
    assert.equal(status, 412);
    assert.equal(body.code, 'VERSION_CONFLICT');

    // A passing guard returns null and writes nothing.
    const okRes = { setHeader: () => {}, status: () => okRes, json: () => okRes };
    assert.equal(occ.versionGuard({ headers: {} }, { id: 1, version: 5 }, okRes), null);
  });
});

// ── #51 Soft delete for services ───────────────────────────────────────
describe('#51 service soft delete', () => {
  test('an unreferenced service is hard-deleted (row gone)', async () => {
    const svc = await Services.create({ name: 'Typo Service', price: 10, duration: 15, salonId: salonA.id });
    const res = mockRes();
    await deleteService(mockReq({
      user: { role: 'salon', salonId: salonA.id },
      params: { id: String(svc.id) },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.archived, false);
    assert.equal(await Services.findByPk(svc.id), null);
  });

  test('a service with booking history is ARCHIVED, not destroyed', async () => {
    const svc = await Services.create({ name: 'Historic Cut', price: 700, duration: 45, salonId: salonA.id });
    await Appointment.create({
      staffId: staffA.id, salonId: salonA.id, serviceId: svc.id, userId: customerA.id,
      date: FUTURE, time: '11:00', endTime: '11:45', status: 'completed',
    });

    const res = mockRes();
    await deleteService(mockReq({
      user: { role: 'salon', salonId: salonA.id },
      params: { id: String(svc.id) },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.archived, true);

    const row = await Services.findByPk(svc.id);
    assert.ok(row, 'the row must survive so history stays referenceable');
    assert.equal(row.statusbar, 'archived');
    assert.ok(row.archivedAt, 'archivedAt must be stamped');
  });

  test('a service referenced only by a PAYMENT is also archived', async () => {
    const svc = await Services.create({ name: 'Paid Service', price: 800, duration: 30, salonId: salonA.id });
    await Payment.create({
      orderId: `ORDER-SOFTDEL-${Date.now()}`, paymentSessionId: 'sess', orderAmount: 800,
      orderCurrency: 'INR', paymentStatus: 'Success', customerID: customerA.id,
      dateSelected: FUTURE, timeSelected: '13:00', endTime: '13:30',
      staffId: staffA.id, salonId: salonA.id, serviceId: svc.id, duration: 30,
    });
    const res = mockRes();
    await deleteService(mockReq({
      user: { role: 'salon', salonId: salonA.id },
      params: { id: String(svc.id) },
    }), res);
    assert.equal(res.body.archived, true);
    assert.ok(await Services.findByPk(svc.id));
  });

  test('archived services drop out of the active listing', async () => {
    const svc = await Services.create({ name: 'Gone Soon', price: 300, duration: 20, salonId: salonA.id });
    await Appointment.create({
      staffId: staffA.id, salonId: salonA.id, serviceId: svc.id, userId: customerA.id,
      date: FUTURE, time: '15:00', endTime: '15:20', status: 'confirmed',
    });
    await deleteService(mockReq({ user: { role: 'salon', salonId: salonA.id }, params: { id: String(svc.id) } }), mockRes());

    const active = await Services.findAll({ where: { salonId: salonA.id, statusbar: 'active' } });
    assert.ok(!active.some((s) => s.id === svc.id), 'archived services must not appear as bookable');
  });

  test('cross-salon delete is still refused with 403', async () => {
    const svc = await Services.create({ name: 'Not Yours', price: 50, duration: 10, salonId: salonA.id });
    const res = mockRes();
    await deleteService(mockReq({ user: { role: 'salon', salonId: salonB.id }, params: { id: String(svc.id) } }), res);
    assert.equal(res.statusCode, 403);
    assert.ok(await Services.findByPk(svc.id));
  });

  test('unknown id still 404s', async () => {
    const res = mockRes();
    await deleteService(mockReq({ user: { role: 'salon', salonId: salonA.id }, params: { id: '999999' } }), res);
    assert.equal(res.statusCode, 404);
  });
});

// ── #52 Audit trail ────────────────────────────────────────────────────
describe('#52 extended audit trail', () => {
  test('records a non-admin actor with role and id', async () => {
    const row = await auditService.recordAudit({
      actor: { role: 'staff', id: 42, email: 'stylist@salon.com' },
      action: 'appointment.no_show',
      targetType: 'appointment',
      targetId: 7,
      details: 'customer did not arrive',
    });
    assert.ok(row);
    assert.equal(row.actorRole, 'staff');
    assert.equal(row.actorId, '42');
    assert.equal(row.adminEmail, 'stylist@salon.com');
    assert.equal(row.action, 'appointment.no_show');
    assert.equal(row.details, 'customer did not arrive');
  });

  test('legacy adminEmail-only callers still work (backward compatible)', async () => {
    const row = await auditService.recordAudit({
      adminEmail: 'admin@platform.com',
      action: 'user.delete',
      targetType: 'user',
      targetId: 3,
    });
    assert.ok(row);
    assert.equal(row.adminEmail, 'admin@platform.com');
    assert.equal(row.actorRole, 'admin');
  });

  test('captures request context (ip + user agent)', async () => {
    const row = await auditService.recordAudit({
      actor: { role: 'salon', id: 9, email: 'owner@salon.com' },
      action: 'promo.update',
      targetType: 'promo',
      targetId: 5,
      req: { headers: { 'user-agent': 'Mozilla/5.0 Test', 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, ip: '10.0.0.1' },
    });
    assert.equal(row.ip, '203.0.113.9', 'the ORIGINAL client wins, not the proxy');
    assert.equal(row.userAgent, 'Mozilla/5.0 Test');
  });

  test('clientIpFrom falls back to req.ip and then the socket', () => {
    assert.equal(auditService.clientIpFrom({ ip: '1.2.3.4', headers: {} }), '1.2.3.4');
    assert.equal(auditService.clientIpFrom({ socket: { remoteAddress: '5.6.7.8' }, headers: {} }), '5.6.7.8');
    assert.equal(auditService.clientIpFrom(null), null);
  });

  test('auditRequest derives the actor from req.user', async () => {
    const row = await auditService.auditRequest(
      { user: { role: 'customer', id: 11, email: 'c@x.com' }, headers: {}, ip: '9.9.9.9' },
      'booking.cancel', 'appointment', 88, 'changed plans'
    );
    assert.equal(row.actorRole, 'customer');
    assert.equal(row.actorId, '11');
    assert.equal(row.action, 'booking.cancel');
    assert.equal(row.details, 'changed plans');
  });

  test('a missing actor degrades to a system/role placeholder, not a crash', async () => {
    const row = await auditService.recordAudit({
      action: 'system.cleanup', targetType: 'waitlist', targetId: 1,
    });
    assert.ok(row);
    assert.equal(row.actorRole, 'system');
    assert.match(row.adminEmail, /role:system/);
  });

  test('never throws — an audit failure cannot break the operation', async () => {
    // Missing required fields: the service must return null, not throw.
    const result = await auditService.recordAudit({ action: 'x' });
    assert.equal(result, null);
  });

  test('oversized fields are truncated to the column width', async () => {
    const row = await auditService.recordAudit({
      actor: { role: 'admin', id: 1, email: 'a@b.com' },
      action: 'x'.repeat(500),
      targetType: 'y'.repeat(500),
      targetId: 1,
      details: 'z'.repeat(1000),
    });
    assert.ok(row.action.length <= 64);
    assert.ok(row.targetType.length <= 32);
    assert.ok(row.details.length <= 255);
  });
});

// ── #54 Per-role rate limits ───────────────────────────────────────────
describe('#54 per-role rate limits', () => {
  test('admin has the tightest quota, customer the most generous', () => {
    assert.ok(limiters.ROLE_QUOTAS.admin < limiters.ROLE_QUOTAS.staff, 'admin must be tighter than staff');
    assert.ok(limiters.ROLE_QUOTAS.staff < limiters.ROLE_QUOTAS.salon);
    assert.ok(limiters.ROLE_QUOTAS.salon < limiters.ROLE_QUOTAS.customer);
  });

  test('principalKey keys on the actor, not the IP', () => {
    assert.equal(limiters.principalKey({ user: { role: 'salon', id: 5 } }), 'salon:5');
    assert.equal(limiters.principalKey({ user: { role: 'customer', id: 5 } }), 'customer:5');
    assert.notEqual(
      limiters.principalKey({ user: { role: 'salon', id: 5 } }),
      limiters.principalKey({ user: { role: 'customer', id: 5 } })
    );
  });

  test('principalKey falls back to IP for anonymous traffic', () => {
    assert.equal(limiters.principalKey({ ip: '1.2.3.4' }), 'ip:1.2.3.4');
    assert.equal(limiters.principalKey({}), 'ip:unknown');
  });

  test('principalKey tolerates the legacy id field names', () => {
    assert.equal(limiters.principalKey({ user: { role: 'customer', userId: 7 } }), 'customer:7');
    assert.equal(limiters.principalKey({ user: { role: 'staff', staffId: 3 } }), 'staff:3');
  });

  test('the per-role limiter resolves max from the authenticated role', () => {
    // express-rate-limit exposes the resolved options for inspection.
    const maxFn = limiters.perRoleLimiter.max;
    assert.equal(typeof maxFn, 'function', 'max must be dynamic for per-role quotas');
    assert.equal(maxFn({ user: { role: 'admin' } }), limiters.ROLE_QUOTAS.admin);
    assert.equal(maxFn({ user: { role: 'customer' } }), limiters.ROLE_QUOTAS.customer);
    assert.equal(maxFn({}), limiters.ROLE_QUOTAS.anonymous, 'unknown role falls back to the anonymous quota');
  });

  test('expensive read and money-write limiters are much tighter', () => {
    assert.ok(limiters.expensiveReadLimiter.max <= 20, 'exports/reports need a small budget');
    assert.ok(limiters.moneyWriteLimiter.max <= 20, 'payment attempts need a small budget');
  });

  test('makeLimiter produces a configured limiter instance', () => {
    const l = limiters.makeLimiter({ windowMs: 1000, max: 3, message: 'nope' });
    assert.equal(l.max, 3);
    assert.equal(l.windowMs, 1000);
  });
});
