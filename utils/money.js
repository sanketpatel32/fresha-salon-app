/**
 * Money helpers (#49) — integer minor units, never floats.
 *
 * The bug this exists to prevent: 0.1 + 0.2 === 0.30000000000000004. A booking
 * platform adds, discounts, tips, splits and sums money constantly, and a
 * float error that survives into a ledger is a reconciliation incident.
 *
 * Rule: ALL money in the system is an integer count of the currency's smallest
 * unit (paise for INR, cents for USD). Decimals are converted at the edges —
 * parsed on input, formatted on output — and nowhere in between.
 *
 * This module is dependency-free and side-effect free: pure functions only, so
 * it's trivially testable and safe to use anywhere.
 */

/** Number of minor units per major unit, by ISO 4217 code. */
const CURRENCY_EXPONENTS = Object.freeze({
  INR: 2, USD: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2, SGD: 2, CHF: 2,
  // Zero-decimal currencies — a JPY amount of 500 means 500 yen, not 5.
  JPY: 0, KRW: 0, VND: 0,
  // Three-decimal currencies.
  BHD: 3, KWD: 3, JOD: 3, TND: 3,
});

const DEFAULT_CURRENCY = 'INR';
const DEFAULT_EXPONENT = 2;

/** Minor units per major unit for a currency code (defaults to 2). */
const exponentOf = (currency = DEFAULT_CURRENCY) =>
  CURRENCY_EXPONENTS[String(currency).toUpperCase()] ?? DEFAULT_EXPONENT;

/**
 * Convert a major-unit amount (1234.56) to minor units (123456).
 *
 * String input is preferred and handled exactly; numeric input is rounded
 * half-up via epsilon correction so 1.005 -> 101 rather than 100 (a naive
 * Math.round(1.005 * 100) gives 100 because 1.005 is really 1.00499...).
 */
const toMinor = (amount, currency = DEFAULT_CURRENCY) => {
  if (amount === null || amount === undefined || amount === '') return null;
  const exponent = exponentOf(currency);
  const factor = 10 ** exponent;

  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) return null;
    // Shift the float error out before rounding: (1.005 * 100 + eps) -> 100.5
    return Math.round((amount * factor) + Number.EPSILON * Math.abs(amount) * factor);
  }

  const str = String(amount).trim().replace(/[,\s]/g, '');
  if (str === '' || !/^-?\d*\.?\d*$/.test(str)) return null;

  // Exact decimal-string path: split on the point and pad/truncate manually so
  // no float is ever involved. This is what makes "1234.56" land on 123456
  // exactly, every time.
  const negative = str.startsWith('-');
  const body = negative ? str.slice(1) : str;
  const [intPart = '0', fracPart = ''] = body.split('.');
  const { digits: rounded, carry } = roundFractionUp(fracPart, exponent);
  // The carry must propagate into the integer part: "499.999" rounds to
  // ₹500.00, not ₹499.00 — dropping it once understated a quote by a rupee.
  const totalInt = Number(intPart || '0') + carry;
  const digits = `${totalInt}${rounded}`.replace(/^0+(?=\d)/, '');
  const value = Number(digits === '' ? '0' : digits);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
};

/**
 * Round a fractional digit string to `exponent` places, half-up. Returns
 * { digits, carry } — carry is 1 when rounding overflowed the fraction
 * (e.g. "999" at 2dp → digits "00", carry 1).
 */
const roundFractionUp = (fracPart, exponent) => {
  if (exponent === 0) return { digits: '', carry: 0 };
  const truncated = fracPart.slice(0, exponent).padEnd(exponent, '0');
  const nextDigit = Number(fracPart.charAt(exponent) || '0');
  if (nextDigit < 5) return { digits: truncated, carry: 0 };
  // Half-up: increment the truncated value; overflow past the fraction width
  // is the carry into the integer part.
  const bumped = (Number(truncated || '0') + 1);
  const limit = 10 ** exponent;
  if (bumped >= limit) return { digits: String(bumped - limit).padStart(exponent, '0'), carry: 1 };
  return { digits: String(bumped).padStart(exponent, '0'), carry: 0 };
};

/** Convert minor units (123456) back to a major-unit number (1234.56). */
const fromMinor = (minor, currency = DEFAULT_CURRENCY) => {
  if (minor === null || minor === undefined) return null;
  const exponent = exponentOf(currency);
  const value = Number(minor) / 10 ** exponent;
  // Kill float dust from the division: 123456/100 -> 1234.56 exactly here, but
  // three-decimal currencies can produce 1.2340000000000002.
  return Math.round(value * 10 ** exponent) / 10 ** exponent;
};

/** Integer addition of minor-unit amounts. Ignores nulls (treated as 0). */
const add = (...amounts) => amounts.reduce((acc, a) => acc + (a || 0), 0);

/** Subtract later amounts from the first. Result may be negative — callers
 * that need a floor clamp it themselves (nothing ships a negative charge). */
const subtract = (a, ...rest) => {
  const total = rest.reduce((acc, x) => acc + (x || 0), 0);
  return (a || 0) - total;
};

/**
 * Multiply by a scalar with banker's-free half-up rounding.
 * Used for taxes and percentage discounts.
 */
const multiply = (amount, factor) => Math.round((amount || 0) * factor);

/**
 * Take `percent` of an amount (percent = 10 means 10%).
 * Half-up to the nearest minor unit.
 */
const percent = (amount, pct) => Math.round(((amount || 0) * pct) / 100);

/**
 * Apply a percentage discount capped at `maxDiscount` minor units.
 * Returns the discount actually applied (never more than the amount).
 */
const discountFor = (amount, pct, maxDiscount = null) => {
  let d = percent(amount, pct);
  if (maxDiscount !== null && maxDiscount !== undefined && d > maxDiscount) d = maxDiscount;
  if (d > (amount || 0)) d = amount || 0;
  if (d < 0) d = 0;
  return d;
};

/**
 * Split an amount into `n` parts without losing or inventing a single unit.
 *
 * The classic bug: 1000 / 3 = 333.33 each = 999.99, so one paisa vanishes.
 * Here the remainder is distributed one unit at a time across the first parts,
 * so the parts always sum EXACTLY to the original.
 *
 * @param {number} amount  Minor units.
 * @param {number[]} [ratios]  Relative weights; defaults to equal shares.
 */
const allocate = (amount, ratios) => {
  const total = Math.trunc(amount || 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);

  let weights;
  if (!ratios || ratios.length === 0) {
    weights = [1];
  } else {
    weights = ratios.map((r) => Math.max(0, Number(r) || 0));
  }
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  if (sumWeights <= 0) return weights.map(() => 0);

  const shares = weights.map((w) => Math.floor((abs * w) / sumWeights));
  let remainder = abs - shares.reduce((a, b) => a + b, 0);

  // Hand out the leftover units to the largest fractional remainders first, so
  // the distribution is as fair as integer math allows.
  const order = weights
    .map((w, i) => ({ i, frac: (abs * w) / sumWeights - Math.floor((abs * w) / sumWeights) }))
    .sort((a, b) => b.frac - a.frac)
    .map((o) => o.i);
  let k = 0;
  while (remainder > 0 && order.length > 0) {
    shares[order[k % order.length]] += 1;
    remainder -= 1;
    k += 1;
  }

  return shares.map((s) => s * sign);
};

/** True when every part sums exactly to the whole. */
const allocationIsExact = (amount, parts) =>
  parts.reduce((a, b) => a + b, 0) === Math.trunc(amount || 0);

/**
 * Format minor units for display, e.g. 123456 -> "₹1,234.56".
 * Uses Intl for locale-correct grouping and symbol placement.
 */
const CURRENCY_SYMBOLS = Object.freeze({ INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' });

const format = (minor, { currency = DEFAULT_CURRENCY, locale = 'en-IN', symbol = null } = {}) => {
  if (minor === null || minor === undefined) return '';
  const major = fromMinor(minor, currency);
  const exponent = exponentOf(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: String(currency).toUpperCase(),
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(major);
  } catch (_err) {
    // Unknown currency code — fall back to a symbol + grouped number.
    const sym = symbol ?? CURRENCY_SYMBOLS[String(currency).toUpperCase()] ?? `${String(currency).toUpperCase()} `;
    return `${sym}${major.toFixed(exponent)}`;
  }
};

/** Compact display for dashboards: 150000 -> "₹1.5K", 2500000 -> "₹25L". */
const formatCompact = (minor, { currency = DEFAULT_CURRENCY } = {}) => {
  const major = fromMinor(minor, currency) || 0;
  const sym = CURRENCY_SYMBOLS[String(currency).toUpperCase()] ?? '';
  const abs = Math.abs(major);
  const sign = major < 0 ? '-' : '';
  // Indian numbering: lakh (1e5) and crore (1e7) are the familiar units here.
  if (abs >= 1e7) return `${sign}${sym}${(abs / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `${sign}${sym}${(abs / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
  if (abs >= 1e3) return `${sign}${sym}${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `${sign}${sym}${abs}`;
};

/** Are two minor-unit amounts equal? (Guards against null/undefined.) */
const equals = (a, b) => (a || 0) === (b || 0);

/** Compare: -1 if a<b, 0 if equal, 1 if a>b. */
const compare = (a, b) => {
  const x = a || 0;
  const y = b || 0;
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Clamp into [min, max] minor units. */
const clamp = (amount, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Math.min(Math.max(amount || 0, min), max);

/** Is this a plausible minor-unit integer? (Rejects NaN/floats/negatives.) */
const isValidMinor = (value, { allowNegative = false } = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (!Number.isInteger(value)) return false;
  return allowNegative ? true : value >= 0;
};

module.exports = {
  toMinor,
  fromMinor,
  add,
  subtract,
  multiply,
  percent,
  discountFor,
  allocate,
  allocationIsExact,
  format,
  formatCompact,
  equals,
  compare,
  clamp,
  isValidMinor,
  exponentOf,
  CURRENCY_EXPONENTS,
  CURRENCY_SYMBOLS,
  DEFAULT_CURRENCY,
};
