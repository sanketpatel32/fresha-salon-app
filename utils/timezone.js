/**
 * Timezone helpers (#50) — salon-local date/time correctness.
 *
 * The app stores appointments as a DATEONLY `date` ("2026-08-28") plus a TIME
 * `time` ("19:30") — deliberately wall-clock, not an instant. That's the right
 * model for a booking ("3pm Saturday" means 3pm on the salon's wall clock),
 * but it means every comparison against "now" has to ask: now WHERE?
 *
 * Getting this wrong is subtle and user-visible: a server in UTC deciding
 * "today" for a salon in Asia/Kolkata (UTC+5:30) will roll over at the wrong
 * moment, so `/staff/today` shows tomorrow's list for five and a half hours and
 * the 24-hour reminder window is misaligned.
 *
 * Everything here is built on the Intl API (in Node's core), which carries the
 * real IANA tz database including DST rules — so "add 24 hours" and "same time
 * tomorrow" are genuinely different operations and this module keeps them apart.
 */

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** Cached DateTimeFormatters — constructing them is comparatively expensive. */
const formatterCache = new Map();
const getFormatter = (timeZone, options) => {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, ...options });
    formatterCache.set(key, f);
  }
  return f;
};

/**
 * Is this a valid IANA timezone identifier?
 * Uses Intl's own validation, so it can never drift from the runtime's tz data.
 */
const isValidTimezone = (tz) => {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (_err) {
    return false;
  }
};

/** Resolve a possibly-invalid timezone to a safe one, logging nothing. */
const resolveTimezone = (tz, fallback = DEFAULT_TIMEZONE) =>
  isValidTimezone(tz) ? tz : fallback;

/**
 * The calendar date "right now" in a timezone, as YYYY-MM-DD.
 *
 * Note the 'en-CA' locale above: it formats as YYYY-MM-DD natively, which
 * avoids hand-assembling the string from parts (and the off-by-one month bugs
 * that come with it).
 */
const todayIn = (timeZone = DEFAULT_TIMEZONE, now = new Date()) =>
  getFormatter(resolveTimezone(timeZone), {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

/** Wall-clock time "right now" in a timezone, as HH:mm (24h). */
const timeNowIn = (timeZone = DEFAULT_TIMEZONE, now = new Date()) =>
  getFormatter(resolveTimezone(timeZone), {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);

/** ISO weekday code ('sun'..'sat') for a YYYY-MM-DD date. */
const DAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayCodeOf = (dateString) => {
  // Parse as UTC noon to dodge any local-offset shift changing the day.
  const d = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return DAY_CODES[d.getUTCDay()];
};

/**
 * The UTC instant for a wall-clock date+time in a timezone.
 *
 * This is the hard one. There is no "UTC offset for a timezone" — the offset
 * depends on the date (DST) — so we can't just subtract 5:30. Instead we probe:
 * guess an instant, ask Intl what wall-clock time that instant shows in the
 * zone, measure the error, and correct. Two iterations converge for every real
 * zone (DST shifts are at most a couple of hours).
 *
 * The remaining ambiguity is the DST "spring forward" gap: a wall time that
 * never happened (02:30 on a day when the clock jumps 02:00 -> 03:00). We
 * resolve it FORWARD to the instant after the gap, matching how a wall clock
 * would actually behave — you'd arrive to find it's already 03:30.
 */
const zonedToUtc = (dateString, timeString = '00:00', timeZone = DEFAULT_TIMEZONE) => {
  const tz = resolveTimezone(timeZone);
  const [y, m, d] = String(dateString).split('-').map(Number);
  const [hh, mm] = String(timeString || '00:00').split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;

  // First guess: treat the wall time as if it were UTC.
  //
  // `target` is the wall time we WANT, frozen here and expressed on the same
  // "wall-clock fields read as if UTC" scale that `partsIn` returns, so the two
  // are directly comparable. It must NOT be recomputed from `guess`: measuring
  // the error against a moving guess makes the loop subtract the UTC offset on
  // every pass and diverge (19:30 -> 14:00 -> 08:30 -> 03:00 for IST) instead
  // of converging on the second iteration.
  const target = Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0);
  let guess = target;

  const partsIn = (instant) => {
    const f = getFormatter(tz, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const parts = f.formatToParts(new Date(instant));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    // Intl renders midnight as hour 24 under hour12:false in some ICU versions.
    let hour = get('hour');
    if (hour === 24) hour = 0;
    return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  };

  // Iterate: error = (what the zone shows) - (what we WANT, i.e. `target`).
  // Subtracting it from the guess moves the instant the other way by exactly
  // the zone's offset at that instant, which is what makes this converge.
  //
  // Measuring against `guess` instead of `target` is the bug this loop is
  // shaped to avoid: `shown - guess` is just the offset, so each pass would
  // subtract the offset again and the guess would march 5:30 further west
  // every iteration (19:30 -> 14:00 -> 08:30 -> 03:00 for IST) instead of
  // landing on the first correction.
  for (let i = 0; i < 3; i++) {
    const shown = partsIn(guess);
    const error = shown - target;
    if (error === 0) break;
    guess -= error;
  }
  return new Date(guess);
};

/**
 * Shift a YYYY-MM-DD date by whole days — pure calendar arithmetic, so DST
 * transitions on the day itself can never shift the result.
 */
const addDays = (dateString, days) => {
  const [y, m, d] = String(dateString).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(days || 0), 12));
  return dt.toISOString().slice(0, 10);
};

/**
 * The calendar date "right now" on THIS host, as YYYY-MM-DD.
 *
 * Why this exists when `todayIn()` already does dates: `todayIn` answers "what
 * day is it in Asia/Kolkata?", which is the right question for a salon-local
 * display. This answers a different one — "what day is it in the frame the
 * booking columns are written in?" Appointments store `date` as 'YYYY-MM-DD'
 * and `time` as 'HH:mm', and availabilityService.validateLeadTime() turns them
 * back into an instant with `new Date(`${dateStr}T${startTime}`)`, which
 * JavaScript parses as HOST-LOCAL time. So the host's local clock is the
 * system's frame of record, and anything comparing "today" against a stored
 * date must use it — including on a UTC server like Render, where
 * `todayIn()` and this disagree for five and a half hours a day.
 *
 * The bug this replaced: `now.toISOString().slice(0, 10)` (UTC day) sitting
 * next to `now.getHours()` (local hour). On any host west of UTC in the
 * evening those name two different days, and a rebook search would happily
 * offer 09:00 "today" at 01:47 local — a slot that had already passed.
 */
const localDay = (now = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** Wall-clock time "right now" on THIS host, as HH:mm (24h). See localDay. */
const localTime = (now = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

/** Whole days from `from` to `to` (calendar days, ignoring clock time). */
const daysBetween = (from, to) => {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
};

/** "HH:mm" -> minutes since midnight. Returns null for malformed input. */
const toMinutes = (timeString) => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeString || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

/** Minutes since midnight -> "HH:mm" (zero-padded; wraps modulo 24h). */
const fromMinutes = (minutes) => {
  const total = ((Math.trunc(Number(minutes)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Add minutes to an "HH:mm", wrapping at midnight. */
const addMinutes = (timeString, minutes) => fromMinutes(toMinutes(timeString) + Number(minutes || 0));

/** Does [startA, endA) overlap [startB, endB)? Times are "HH:mm". */
const overlaps = (startA, endA, startB, endB) => {
  const a1 = toMinutes(startA);
  const a2 = toMinutes(endA);
  const b1 = toMinutes(startB);
  const b2 = toMinutes(endB);
  if (a1 === null || a2 === null || b1 === null || b2 === null) return false;
  // A zero-length window occupies no time and can never conflict.
  if (a1 === a2 || b1 === b2) return false;
  return a1 < b2 && b1 < a2;
};

/**
 * Build the slot grid for a window, honouring the salon's configured step.
 * Slots whose duration would run past `close` are omitted — a 60-minute
 * service must not be offered starting at 5 minutes to closing.
 */
const generateSlots = ({ open, close, stepMinutes = 30, durationMinutes = 30 }) => {
  const start = toMinutes(open);
  const end = toMinutes(close);
  if (start === null || end === null || end <= start) return [];
  const step = Math.max(1, Math.trunc(stepMinutes));
  const dur = Math.max(0, Math.trunc(durationMinutes));
  const slots = [];
  for (let t = start; t + dur <= end; t += step) {
    slots.push({ time: fromMinutes(t), endTime: fromMinutes(t + dur) });
  }
  return slots;
};

/**
 * Human-friendly label for a timezone including its current offset, e.g.
 * "Asia/Kolkata (UTC+05:30)". Useful in salon settings UIs.
 */
const describe = (timeZone = DEFAULT_TIMEZONE, now = new Date()) => {
  const tz = resolveTimezone(timeZone);
  const parts = getFormatter(tz, { timeZoneName: 'longOffset' }).formatToParts(now);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value || '';
  return `${tz} (${name})`;
};

/** Current UTC offset in minutes for a timezone at a given instant. */
const offsetMinutes = (timeZone = DEFAULT_TIMEZONE, now = new Date()) => {
  const tz = resolveTimezone(timeZone);
  const f = getFormatter(tz, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = f.formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  // Discard milliseconds so the comparison is exact.
  return Math.round((asUtc - Math.floor(now.getTime() / 1000) * 1000) / 60000);
};

module.exports = {
  DEFAULT_TIMEZONE,
  DAY_CODES,
  isValidTimezone,
  resolveTimezone,
  todayIn,
  timeNowIn,
  localDay,
  localTime,
  dayCodeOf,
  zonedToUtc,
  addDays,
  daysBetween,
  toMinutes,
  fromMinutes,
  addMinutes,
  overlaps,
  generateSlots,
  describe,
  offsetMinutes,
};
