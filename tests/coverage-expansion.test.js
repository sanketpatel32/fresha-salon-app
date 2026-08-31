/**
 * Coverage expansion — PURE-UNIT tests for the utility layer.
 *
 * No database, no sequelize, no sync: only the dependency-free helpers in
 * utils/ (timezone, money, statusRules, pagination) plus the exported
 * constants of utils/validators (which itself only needs zod + timezone).
 *
 * Focuses on edges the existing suites (data-integrity, statusRules,
 * pagination) don't already assert.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const tz = require('../utils/timezone');
const money = require('../utils/money');
const {
  canTransition, canCancel, canReschedule, CANCEL_WINDOW_HOURS,
} = require('../utils/statusRules');
const {
  paginateQuery, buildMeta, DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT,
} = require('../utils/pagination');
const { CANCELLATION_REASONS, SERVICE_CATEGORIES } = require('../utils/validators');

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// ── utils/timezone ─────────────────────────────────────────────────────
describe('timezone.localDay', () => {
  test('localDay formats the host-local calendar day as zero-padded YYYY-MM-DD', () => {
    assert.match(tz.localDay(), ISO_DAY, 'the default "now" must still be YYYY-MM-DD');
    // Single-digit month and day must be padded: 2027-03-09, not 2027-3-9.
    assert.equal(tz.localDay(new Date(2027, 2, 9, 0, 5)), '2027-03-09');
    assert.equal(tz.localDay(new Date(2026, 0, 31, 23, 59, 59)), '2026-01-31');
    assert.equal(tz.localDay(new Date(2026, 11, 31)), '2026-12-31');
    // Midnight of Jan 1 is the padding edge on both fields at once.
    assert.equal(tz.localDay(new Date(2026, 0, 1, 0, 0, 0)), '2026-01-01');
  });

  test('localDay reads the HOST clock, not UTC (end of a UTC day is still the local day)', () => {
    // 2026-07-14T23:30 LOCAL is already 2026-07-15 in UTC — the helper must
    // report the local frame the booking columns are written in.
    const lateEvening = new Date(2026, 6, 14, 23, 30);
    assert.equal(tz.localDay(lateEvening), '2026-07-14');
  });
});

describe('timezone.addDays', () => {
  test('crosses month and year boundaries (Jan 31 +1, Dec 31 +1, backwards over New Year)', () => {
    assert.equal(tz.addDays('2026-01-31', 1), '2026-02-01', 'Jan 31 +1 is Feb 1, never Jan 32');
    assert.equal(tz.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(tz.addDays('2026-12-31', 31), '2027-01-31');
    assert.equal(tz.addDays('2026-01-01', -1), '2025-12-31');
    assert.match(tz.addDays('2026-01-31', 1), ISO_DAY);
  });

  test('handles leap years: 2028 yes, 2100 no (century rule)', () => {
    assert.equal(tz.addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(tz.addDays('2026-02-28', 1), '2026-03-01', '2026 is not a leap year');
    // 2100 is divisible by 100 but not 400 — NOT a leap year.
    assert.equal(tz.addDays('2100-02-28', 1), '2100-03-01');
  });

  test('pure calendar arithmetic via the UTC-noon anchor — DST transitions never shift the result', () => {
    // US 2026: spring forward Mar 8, fall back Nov 1. Adding one calendar day
    // across either transition is still exactly the next date, because the
    // arithmetic happens at a fixed 12:00Z anchor instead of a local instant.
    assert.equal(tz.addDays('2026-03-07', 1), '2026-03-08');
    assert.equal(tz.addDays('2026-03-08', 1), '2026-03-09');
    assert.equal(tz.addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(tz.addDays('2026-11-01', 1), '2026-11-02');
    // Zero and missing day counts are identity.
    assert.equal(tz.addDays('2026-06-15', 0), '2026-06-15');
    assert.equal(tz.addDays('2026-06-15'), '2026-06-15');
  });
});

describe('timezone.toMinutes / fromMinutes', () => {
  test('round-trip every minute of the day, including the 00:00 and 23:59 extremes', () => {
    assert.equal(tz.toMinutes('00:00'), 0);
    assert.equal(tz.toMinutes('23:59'), 1439);
    for (let m = 0; m < 1440; m++) {
      const hhmm = tz.fromMinutes(m);
      assert.match(hhmm, /^([01]\d|2[0-3]):[0-5]\d$/, `${m} must format as strict HH:mm`);
      assert.equal(tz.toMinutes(hhmm), m, `${hhmm} must round-trip to ${m}`);
    }
  });

  test('accepts a lenient single-digit hour ("9:59") and normalizes it back to padded form', () => {
    assert.equal(tz.toMinutes('9:59'), 599);
    assert.equal(tz.fromMinutes(599), '09:59', 'output is always zero-padded');
    // Seconds are tolerated (DB TIME strings can carry them) but ignored.
    assert.equal(tz.toMinutes('09:30:00'), 570);
    assert.equal(tz.toMinutes('09:30:45'), 570);
  });

  test('rejects malformed and out-of-range times with null', () => {
    assert.equal(tz.toMinutes('24:00'), null, 'hour 24 does not exist on a 24h clock');
    assert.equal(tz.toMinutes('12:60'), null);
    assert.equal(tz.toMinutes('09:5'), null, 'minutes must be two digits');
    assert.equal(tz.toMinutes('9:9'), null);
    assert.equal(tz.toMinutes('-1:00'), null);
    assert.equal(tz.toMinutes('0930'), null);
    assert.equal(tz.toMinutes(null), null);
    assert.equal(tz.toMinutes(''), null);
  });

  test('fromMinutes wraps into the 24h day rather than clamping', () => {
    assert.equal(tz.fromMinutes(1440), '00:00', 'one full day wraps to midnight');
    assert.equal(tz.fromMinutes(1441), '00:01');
    assert.equal(tz.fromMinutes(-1), '23:59', 'negative counts back from midnight');
    assert.equal(tz.fromMinutes(90.9), '01:30', 'fractions are truncated, not rounded');
  });
});

describe('timezone.overlaps', () => {
  test('half-open intervals: [10:00,11:00) vs an 11:00 start is NOT a conflict, vs 10:30 it is', () => {
    assert.equal(tz.overlaps('10:00', '11:00', '11:00', '12:00'), false, 'B starting at A end');
    assert.equal(tz.overlaps('09:00', '10:00', '10:00', '11:00'), false, 'mirror: B ending at A start');
    assert.equal(tz.overlaps('10:00', '11:00', '10:30', '11:30'), true, 'partial overlap inside');
    assert.equal(tz.overlaps('10:00', '11:00', '10:00', '11:00'), true, 'identical windows overlap');
  });

  test('zero-length windows and malformed input never report a conflict', () => {
    assert.equal(tz.overlaps('10:00', '11:00', '10:30', '10:30'), false, 'zero-length B');
    assert.equal(tz.overlaps('10:30', '10:30', '10:00', '11:00'), false, 'zero-length A');
    assert.equal(tz.overlaps('junk', '11:00', '10:00', '11:00'), false);
    assert.equal(tz.overlaps('10:00', 'junk', '10:00', '11:00'), false);
    assert.equal(tz.overlaps('10:00', '11:00', 'junk', '12:00'), false);
    assert.equal(tz.overlaps('10:00', '11:00', '10:00', 'junk'), false);
  });
});

describe('timezone.generateSlots', () => {
  test('a 15-minute step produces the documented grid with open, step-aligned start times', () => {
    const slots = tz.generateSlots({ open: '09:00', close: '10:00', stepMinutes: 15, durationMinutes: 30 });
    assert.deepEqual(slots, [
      { time: '09:00', endTime: '09:30' },
      { time: '09:15', endTime: '09:45' },
      { time: '09:30', endTime: '10:00' }, // 09:45 + 30 would end past 10:00 → omitted
    ]);
  });

  test('slots never start before open nor end after close, on step/window shapes that do not divide evenly', () => {
    const configs = [
      { open: '09:00', close: '10:50', stepMinutes: 30, durationMinutes: 30 }, // non-divisible window
      { open: '08:00', close: '13:00', stepMinutes: 45, durationMinutes: 45 }, // 45-min grid
      { open: '09:00', close: '10:00' }, // defaults: step 30, duration 30
    ];
    for (const cfg of configs) {
      const step = cfg.stepMinutes ?? 30;
      const slots = tz.generateSlots(cfg);
      assert.ok(slots.length > 0, `${cfg.open}-${cfg.close} must have slots`);
      assert.equal(slots[0].time, cfg.open, 'the grid starts exactly at open');
      for (const s of slots) {
        assert.ok(s.time >= cfg.open, `${s.time} must not start before ${cfg.open}`);
        assert.ok(s.endTime <= cfg.close, `${s.endTime} must not end after ${cfg.close}`);
      }
      for (let i = 1; i < slots.length; i++) {
        const gap = tz.toMinutes(slots[i].time) - tz.toMinutes(slots[i - 1].time);
        assert.equal(gap, step, `consecutive slots must be ${step} minutes apart`);
      }
    }
    // The non-divisible window truncates: 10:30 + 30 = 11:00 > 10:50 close.
    assert.deepEqual(
      tz.generateSlots({ open: '09:00', close: '10:50', stepMinutes: 30, durationMinutes: 30 })
        .map((s) => s.time),
      ['09:00', '09:30', '10:00'],
    );
  });

  test('a duration longer than the whole window yields no slots', () => {
    // A 90-minute service cannot start in a 60-minute window at all.
    assert.deepEqual(
      tz.generateSlots({ open: '09:00', close: '10:00', stepMinutes: 30, durationMinutes: 90 }),
      [],
    );
  });
});

describe('timezone.daysBetween', () => {
  test('same day is 0, adjacent days are 1 (and -1 backwards), month boundary included', () => {
    assert.equal(tz.daysBetween('2026-08-28', '2026-08-28'), 0);
    assert.equal(tz.daysBetween('2026-08-28', '2026-08-29'), 1);
    assert.equal(tz.daysBetween('2026-08-29', '2026-08-28'), -1, 'reversed args count backwards');
    assert.equal(tz.daysBetween('2026-08-31', '2026-09-01'), 1);
  });

  test('counts calendar days exactly across DST transitions and leap February', () => {
    // US 2026: clocks spring forward Mar 8 and fall back Nov 1. The noon-anchored
    // parse means those 23- and 25-hour days still count as exactly one day.
    assert.equal(tz.daysBetween('2026-03-07', '2026-03-09'), 2, 'across spring forward');
    assert.equal(tz.daysBetween('2026-10-31', '2026-11-02'), 2, 'across fall back');
    // Leap year: Feb 28 → Mar 1 is two days in 2028, two in 2026 as well
    // (Feb 29 doesn't exist) — but 2028's Feb 28 → Feb 29 is one.
    assert.equal(tz.daysBetween('2028-02-28', '2028-03-01'), 2);
    assert.equal(tz.daysBetween('2028-02-28', '2028-02-29'), 1);
  });

  test('returns null for unparseable input instead of NaN', () => {
    assert.equal(tz.daysBetween('garbage', '2026-08-28'), null);
    assert.equal(tz.daysBetween('2026-08-28', ''), null);
  });
});

// ── utils/money ────────────────────────────────────────────────────────
describe('money.allocate', () => {
  test('an equal 3-way split of 1000 sums back to exactly 1000 (no lost paisa)', () => {
    const parts = money.allocate(1000, [1, 1, 1]);
    assert.equal(parts.reduce((a, b) => a + b, 0), 1000);
    assert.ok(money.allocationIsExact(1000, parts));
    assert.deepEqual(money.allocate(1000, [1, 1]), [500, 500], 'even splits are trivially exact');
  });

  test('weighted ratios split proportionally with the remainder handed out fairly', () => {
    // 100 over [1,2]: floor gives 33/66, the leftover unit goes to the larger
    // fractional remainder (the 2-share) → 33/67.
    assert.deepEqual(money.allocate(100, [1, 2]), [33, 67]);
    const parts = money.allocate(10000, [70, 30]);
    assert.deepEqual(parts, [7000, 3000]);
  });

  test('single-part and empty-ratio calls return the whole amount in one part', () => {
    assert.deepEqual(money.allocate(999), [999], 'no ratios defaults to one share');
    assert.deepEqual(money.allocate(999, []), [999], 'empty ratio list is treated the same');
  });

  test('a zero amount splits to all zeros whatever the ratios', () => {
    assert.deepEqual(money.allocate(0, [3, 7]), [0, 0]);
    assert.deepEqual(money.allocate(0, [1, 1, 1]), [0, 0, 0]);
  });

  test('negative amounts keep the sign and still split exactly', () => {
    const parts = money.allocate(-1000, [1, 1, 1]);
    assert.equal(parts.reduce((a, b) => a + b, 0), -1000);
    assert.deepEqual(parts, [-334, -333, -333]);
    assert.ok(money.allocationIsExact(-1000, parts));
  });

  test('fractional minor-unit inputs are truncated before splitting', () => {
    assert.deepEqual(money.allocate(100.99, [1, 1]), [50, 50], '100.99 paise → 100, then split');
  });

  test('exact-sum property holds across a grid of amounts and ratio sets', () => {
    const amounts = [0, 1, 2, 7, 97, 1000, 99999];
    const ratioSets = [[1], [1, 1], [1, 1, 1], [2, 3], [1, 0], [1, 2, 3, 4]];
    for (const amount of amounts) {
      for (const ratios of ratioSets) {
        const parts = money.allocate(amount, ratios);
        assert.equal(parts.length, ratios.length);
        assert.ok(parts.every((p) => Number.isInteger(p)), 'parts are whole minor units');
        assert.equal(
          parts.reduce((a, b) => a + b, 0), Math.trunc(amount),
          `${amount} over [${ratios}] must re-sum exactly`,
        );
      }
    }
  });
});

describe('money.format', () => {
  test('123456 minor units renders as ₹1,234.56, with Indian 3-then-2 grouping for larger values', () => {
    assert.equal(money.format(123456), '₹1,234.56');
    assert.equal(money.format(12345678), '₹1,23,456.78', 'en-IN groups as lakh/crore, not millions');
  });

  test('JPY is zero-decimal: no fraction digits ever appear', () => {
    const s = money.format(500, { currency: 'JPY' });
    assert.ok(s.includes('¥'));
    assert.ok(!s.includes('.'), 'a zero-decimal currency must never print a decimal point');
    assert.ok(s.endsWith('500'), `expected the major amount 500, got ${s}`);
    // Grouping still applies, still without decimals.
    const big = money.format(123456, { currency: 'JPY' });
    assert.ok(!big.includes('.'));
    assert.ok(big.endsWith('1,23,456'), `expected grouped major amount, got ${big}`);
  });

  test('a malformed currency code falls back to code + fixed number instead of throwing', () => {
    // 'XX' is not a well-formed ISO 4217 code, so Intl throws and the module
    // falls back to its own formatting (default exponent 2).
    assert.equal(money.format(100, { currency: 'XX' }), 'XX 1.00');
  });
});

describe('money.formatCompact', () => {
  test('crore band: 1Cr shows one decimal until 10Cr, then none', () => {
    assert.equal(money.formatCompact(1000000000), '₹1.0Cr'); // 1e7 major = 1 crore
    assert.equal(money.formatCompact(1500000000), '₹1.5Cr');
    assert.equal(money.formatCompact(10000000000), '₹10Cr');
  });

  test('lakh and thousand bands, plus literal small amounts', () => {
    assert.equal(money.formatCompact(10000000), '₹1.0L'); // 1 lakh
    assert.equal(money.formatCompact(500000000), '₹50L'); // 50 lakh, ≥10 drops the decimal
    assert.equal(money.formatCompact(1500000), '₹15K');
    assert.equal(money.formatCompact(999), '₹9.99', 'below ₹1000 stays literal');
    assert.equal(money.formatCompact(0), '₹0');
  });

  test('negative amounts carry the sign into every band', () => {
    assert.equal(money.formatCompact(-150000), '-₹1.5K');
    assert.equal(money.formatCompact(-250000000), '-₹25L');
  });
});

describe('money.discountFor', () => {
  test('maxDiscount caps the computed percent', () => {
    assert.equal(money.discountFor(100000, 10, 5000), 5000, '10% of ₹1000 would be ₹100 — capped at ₹50');
    assert.equal(money.discountFor(100000, 10, 50000), 10000, 'cap above the computed value is a no-op');
    assert.equal(money.discountFor(1000, 10, 100), 100, 'cap exactly equal leaves it unchanged');
    assert.equal(money.discountFor(1000, 50, 0), 0, 'a zero cap means no discount');
  });

  test('the discount never exceeds the amount, whatever the percent', () => {
    assert.equal(money.discountFor(200, 500), 200, '500% of 200 is clamped to the amount');
    assert.equal(money.discountFor(1000, 50), 500, 'no cap given → plain percent');
    assert.equal(money.discountFor(null, 25), 0, 'no amount → no discount');
  });

  test('rounds half-up to the nearest minor unit', () => {
    assert.equal(money.discountFor(33, 50), 17, '16.5 rounds up');
  });
});

describe('money.isValidMinor', () => {
  test('accepts whole non-negative integers only', () => {
    assert.equal(money.isValidMinor(0), true);
    assert.equal(money.isValidMinor(1), true);
    assert.equal(money.isValidMinor(123456), true);
  });

  test('rejects floats, negatives, NaN, infinities and non-numbers', () => {
    assert.equal(money.isValidMinor(-0.5), false);
    assert.equal(money.isValidMinor(Infinity), false);
    assert.equal(money.isValidMinor(-Infinity), false);
    assert.equal(money.isValidMinor('100'), false, 'a string is not a minor-unit amount');
    assert.equal(money.isValidMinor(null), false);
    assert.equal(money.isValidMinor(undefined), false);
    assert.equal(money.isValidMinor(true), false);
  });

  test('allowNegative admits negative INTEGERS but still rejects negative floats', () => {
    assert.equal(money.isValidMinor(-500, { allowNegative: true }), true, 'refunds are negative');
    assert.equal(money.isValidMinor(-500.5, { allowNegative: true }), false);
    assert.equal(money.isValidMinor(5, { allowNegative: true }), true);
  });
});

describe('money.subtract', () => {
  test('NOTE: the doc comment says "clamped at 0 by default" but the code does NOT clamp', () => {
    // This asserts what the implementation actually does (an ordinary
    // subtraction). The doc/behavior mismatch is reported to maintainers —
    // see the report accompanying this test file.
    assert.equal(money.subtract(10, 30), -20, 'goes negative: no clamping despite the doc comment');
  });

  test('subtracts multiple rest amounts and treats nulls as zero', () => {
    assert.equal(money.subtract(100, 30, 20), 50);
    assert.equal(money.subtract(50), 50);
    assert.equal(money.subtract(null, 5), -5, 'a null base is 0, still unclamped');
    assert.equal(money.subtract(undefined, undefined), 0);
  });
});

// ── utils/statusRules ──────────────────────────────────────────────────
describe('statusRules transition table', () => {
  const ALL = ['pending', 'confirmed', 'declined', 'completed', 'cancelled', 'no-show'];
  const EXPECTED = {
    pending: ['confirmed', 'declined', 'cancelled'], // no-show needs a confirmation first
    confirmed: ['completed', 'cancelled', 'no-show'],
    declined: [], // terminal
    completed: [], // terminal
    cancelled: [], // terminal
    'no-show': [], // terminal
  };

  test('the full 6x6 matrix matches the table: every allowed and denied pair', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const expected = EXPECTED[from].includes(to);
        assert.equal(
          canTransition(from, to), expected,
          `${from} -> ${to} should be ${expected}`,
        );
      }
    }
  });

  test('key denied rows: completed/cancelled/no-show/declined allow nothing', () => {
    for (const terminal of ['completed', 'cancelled', 'no-show', 'declined']) {
      for (const to of ALL) {
        assert.equal(canTransition(terminal, to), false, `${terminal} is terminal`);
      }
    }
  });

  test('pending cannot jump straight to completed or no-show; confirmed cannot go back to pending/declined', () => {
    assert.equal(canTransition('pending', 'completed'), false);
    assert.equal(canTransition('pending', 'no-show'), false, 'no-show needs a confirmation first');
    assert.equal(canTransition('confirmed', 'pending'), false);
    assert.equal(canTransition('confirmed', 'declined'), false);
  });

  test('confirmed -> no-show IS allowed (the salon marks a missed appointment)', () => {
    assert.equal(canTransition('confirmed', 'no-show'), true);
  });

  test('self-transitions are rejected for every status', () => {
    for (const s of ALL) {
      assert.equal(canTransition(s, s), false, `${s} -> ${s} is a no-op, not a transition`);
    }
  });

  test('unknown statuses reject everything', () => {
    assert.equal(canTransition('nonsense', 'confirmed'), false);
    assert.equal(canTransition('', 'cancelled'), false);
    assert.equal(canTransition(undefined, 'pending'), false);
    assert.equal(canTransition(null, 'cancelled'), false);
    assert.equal(canTransition('pending', 'frobnicated'), false, 'unknown target is also denied');
  });
});

describe('statusRules.canCancel', () => {
  test('the window is exactly 24 hours and opens strictly after it', () => {
    assert.equal(CANCEL_WINDOW_HOURS, 24);
    const windowMs = CANCEL_WINDOW_HOURS * 3600 * 1000;
    assert.equal(canCancel('confirmed', new Date(Date.now() + windowMs + 5000)), true, 'just past 24h');
    assert.equal(canCancel('confirmed', new Date(Date.now() + windowMs - 5000)), false, 'just inside 24h');
  });

  test('a past or unparseable start never satisfies the window', () => {
    assert.equal(canCancel('confirmed', new Date(Date.now() - 3600 * 1000)), false, 'already started');
    assert.equal(canCancel('pending', new Date('not-a-date')), false, 'NaN diff must not pass the >');
  });
});

describe('statusRules.canReschedule', () => {
  // Frozen clock: canReschedule takes an injectable `now`, so boundaries here
  // are exact rather than raced against Date.now().
  const NOW = new Date(2026, 7, 30, 10, 0, 0); // local frame, zero seconds
  const at = (status, msFromNow) => {
    const start = new Date(NOW.getTime() + msFromNow);
    return { status, date: tz.localDay(start), time: tz.localTime(start) };
  };
  const HOUR = 3600 * 1000;

  test('pending and confirmed may reschedule when the start is more than 24h away', () => {
    assert.equal(canReschedule(at('confirmed', 48 * HOUR), NOW), true);
    assert.equal(canReschedule(at('pending', 48 * HOUR), NOW), true);
  });

  test('exactly 24h away is blocked (strictly-greater semantics), 24h+1min is fine', () => {
    assert.equal(canReschedule(at('confirmed', 24 * HOUR), NOW), false, 'the boundary itself fails');
    assert.equal(canReschedule(at('confirmed', 24 * HOUR + 60 * 1000), NOW), true);
    assert.equal(canReschedule(at('confirmed', 23 * HOUR), NOW), false);
    assert.equal(canReschedule(at('confirmed', -HOUR), NOW), false, 'a past appointment cannot move');
  });

  test('terminal statuses, null and shapeless appointments are refused', () => {
    for (const status of ['declined', 'completed', 'cancelled', 'no-show']) {
      assert.equal(canReschedule(at(status, 48 * HOUR), NOW), false, `${status} is terminal`);
    }
    assert.equal(canReschedule(null, NOW), false);
    assert.equal(canReschedule({}, NOW), false);
  });
});

// ── utils/pagination ───────────────────────────────────────────────────
describe('pagination.paginateQuery', () => {
  test('a request with no query object at all gets the defaults and stays legacy', () => {
    const p = paginateQuery({});
    assert.equal(p.requested, false);
    assert.equal(p.page, DEFAULT_PAGE);
    assert.equal(p.limit, DEFAULT_LIMIT);
    assert.equal(p.offset, 0);
  });

  test('page-only and limit-only each opt into the envelope with the other default', () => {
    const byPage = paginateQuery({ query: { page: '4' } });
    assert.equal(byPage.requested, true);
    assert.equal(byPage.page, 4);
    assert.equal(byPage.limit, 10);
    assert.equal(byPage.offset, 30);
    const byLimit = paginateQuery({ query: { limit: '25' } });
    assert.equal(byLimit.requested, true);
    assert.equal(byLimit.page, 1);
    assert.equal(byLimit.limit, 25);
    assert.equal(byLimit.offset, 0);
    // Numeric (non-string) params behave the same as stringified ones.
    assert.deepEqual(paginateQuery({ query: { page: 3, limit: 20 } }), {
      requested: true, page: 3, limit: 20, offset: 40,
    });
  });

  test('limit clamps up to 1 at zero/negative, while page has no upper cap', () => {
    assert.equal(paginateQuery({ query: { limit: '0' } }).limit, 1, 'a zero limit is one row, not zero');
    assert.equal(paginateQuery({ query: { limit: -10 } }).limit, 1);
    // Only LIMITS are capped at MAX_LIMIT; deep pages are legal.
    const deep = paginateQuery({ query: { page: '1000', limit: '10' } });
    assert.equal(deep.page, 1000);
    assert.equal(deep.offset, 9990);
    assert.equal(MAX_LIMIT, 50);
  });

  test('fractional params are truncated toward zero before clamping', () => {
    assert.equal(paginateQuery({ query: { page: '2.9' } }).page, 2, 'not rounded to 3');
    assert.equal(paginateQuery({ query: { limit: '10.9' } }).limit, 10);
  });

  test('empty-string params still opt into the envelope but fall back to defaults', () => {
    const p = paginateQuery({ query: { page: '', limit: '' } });
    assert.equal(p.requested, true, 'detection is on presence, not validity');
    assert.equal(p.page, 1);
    assert.equal(p.limit, 10);
    assert.equal(p.offset, 0);
  });
});

describe('pagination.buildMeta', () => {
  test('totalPages rounds UP to cover the tail (25 items / 10 → 3 pages; 20/7 → 3)', () => {
    assert.deepEqual(buildMeta(3, 10, 25), { page: 3, limit: 10, total: 25, totalPages: 3 });
    assert.equal(buildMeta(1, 7, 20).totalPages, 3, 'ceil(20/7) = 3');
    assert.equal(buildMeta(1, 10, 20).totalPages, 2, 'exact division leaves no empty tail page');
    assert.equal(buildMeta(1, 10, 1).totalPages, 1, 'a single item is one page');
  });

  test('an out-of-range page is echoed verbatim — clamping is the caller\'s job', () => {
    // Page 7 of a 3-page result still reports page: 7; buildMeta is a pure
    // reporter and does not rewrite the request.
    assert.deepEqual(buildMeta(7, 10, 25), { page: 7, limit: 10, total: 25, totalPages: 3 });
  });

  test('a zero limit cannot divide by zero — it is treated as 1', () => {
    assert.equal(buildMeta(1, 0, 25).totalPages, 25);
    assert.equal(buildMeta(1, -5, 25).totalPages, 25);
  });
});

// ── utils/validators constants ─────────────────────────────────────────
describe('validators exported constants', () => {
  test('CANCELLATION_REASONS is exactly the documented seven-reason vocabulary', () => {
    assert.deepEqual(CANCELLATION_REASONS, [
      'schedule-conflict', 'too-expensive', 'found-elsewhere',
      'staff-unavailable', 'no-longer-needed', 'unhappy-with-service', 'other',
    ]);
    assert.equal(new Set(CANCELLATION_REASONS).size, CANCELLATION_REASONS.length, 'no duplicates');
  });

  test('SERVICE_CATEGORIES is the documented set and keeps "Other" as the fallback', () => {
    assert.deepEqual(SERVICE_CATEGORIES, [
      'Hair', 'Spa & Massage', 'Facial & Skin', 'Nails',
      'Makeup', 'Bridal', "Men's Grooming", 'Other',
    ]);
    assert.ok(SERVICE_CATEGORIES.includes('Other'), 'the catch-all category must exist');
    assert.equal(new Set(SERVICE_CATEGORIES).size, SERVICE_CATEGORIES.length);
  });
});
