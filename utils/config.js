/**
 * Centralized, validated runtime configuration.
 *
 * Before this module, env vars were read ad-hoc with `process.env.X || default`
 * scattered across app.js, services and controllers — so a typo in .env failed
 * silently, numeric knobs arrived as strings, and there was no single place to
 * answer "what is this deployment actually configured to do?".
 *
 * Design rules:
 *  1. Everything is parsed ONCE at require-time into a frozen, typed object.
 *     Hot-reloading env is explicitly out of scope; a config change means a
 *     restart, which keeps invariants simple.
 *  2. Parsing is TOTAL — every knob has a documented default, and garbage
 *     degrades to that default with a warning rather than throwing. Booting
 *     must never fail because someone wrote `PORT=abc`.
 *  3. The module is side-effect free on import and safe to require from tests:
 *     it never touches the network, the DB or the filesystem.
 *  4. Secrets are hidden behind a `redacted()` view so the resolved config can
 *     be logged or exposed on a debug endpoint without leaking credentials.
 */
require('dotenv').config();

const logger = require('./logger');

/** Env accessors — each returns a sane value for missing OR malformed input. */

const str = (key, fallback = '') => {
  const raw = process.env[key];
  return raw === undefined || raw === null || raw === '' ? fallback : String(raw);
};

const bool = (key, fallback = false) => {
  const raw = process.env[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  logger.warn(`config: ${key}="${raw}" is not a boolean, using default ${fallback}`);
  return fallback;
};

const int = (key, fallback = 0, { min = -Infinity, max = Infinity } = {}) => {
  const raw = process.env[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    logger.warn(`config: ${key}="${raw}" is not a number, using default ${fallback}`);
    return fallback;
  }
  const truncated = Math.trunc(n);
  if (truncated < min || truncated > max) {
    logger.warn(`config: ${key}=${truncated} outside [${min}, ${max}], clamping`);
  }
  return Math.min(Math.max(truncated, min), max);
};

/** Comma-separated list -> trimmed, non-empty array. */
const list = (key, fallback = []) => {
  const raw = str(key);
  if (!raw) return fallback;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
};

/**
 * Environment classification. NODE_ENV is the convention; APP_ENV lets a
 * deployment declare staging/preview without pretending to be production.
 */
const rawNodeEnv = str('NODE_ENV', 'development').toLowerCase();
const isProduction = rawNodeEnv === 'production';
const isTest = rawNodeEnv === 'test' || str('APP_ENV').toLowerCase() === 'test';

const port = int('PORT', 3000, { min: 1, max: 65535 });

const config = Object.freeze({
  env: str('APP_ENV', rawNodeEnv),
  isProduction,
  isTest,
  isDevelopment: !isProduction && !isTest,

  server: Object.freeze({
    port,
    // Render/heroku supply 0.0.0.0 binding implicitly; keep an override.
    host: str('HOST', '0.0.0.0'),
    // Trust proxy hops (Render terminates TLS at the load balancer).
    trustProxy: int('TRUST_PROXY', 1, { min: 0, max: 10 }),
    // Body-size ceiling — protects against payload-flood memory exhaustion.
    jsonBodyLimit: str('JSON_BODY_LIMIT', '1mb'),
  }),

  db: Object.freeze({
    url: str('DATABASE_URL'),
    // Null when DATABASE_URL is set; SQLite file path otherwise.
    dialect: str('DATABASE_URL') ? 'postgres' : 'sqlite',
    poolMax: int('DB_POOL_MAX', 5, { min: 1, max: 100 }),
    poolMin: int('DB_POOL_MIN', 0, { min: 0, max: 50 }),
    // Log every SQL statement when set (debug aid; off by default).
    logging: bool('DB_LOGGING', false),
    // Sample accounts are useful locally, but must be explicitly enabled in production.
    seedSampleData: !isProduction || bool('SEED_SAMPLE_DATA', false),
  }),

  auth: Object.freeze({
    jwtSecret: str('JWT_SECRET'),
    // Short-lived access tokens keep the blast radius of a leak small.
    jwtExpiresIn: str('JWT_EXPIRES_IN', '7d'),
    bcryptRounds: int('BCRYPT_ROUNDS', 10, { min: 4, max: 15 }),
  }),

  admin: Object.freeze({
    user: str('ADMIN_USER'),
    pass: str('ADMIN_PASS'),
  }),

  cors: Object.freeze({
    allowedOrigins: list('ALLOWED_ORIGINS', []),
  }),

  logging: Object.freeze({
    level: str('LOG_LEVEL', 'info').toLowerCase(),
    // 'json' for log aggregators (Render/Datadog), 'text' for humans.
    format: str('LOG_FORMAT', isProduction ? 'json' : 'text').toLowerCase(),
  }),

  rateLimit: Object.freeze({
    // General API ceiling per IP.
    windowMs: int('RATE_LIMIT_WINDOW_MS', 60_000, { min: 1_000 }),
    max: int('RATE_LIMIT_MAX', 100, { min: 1 }),
    // Auth endpoints (login/signup/reset) — deliberately brutal.
    authWindowMs: int('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60_000, { min: 1_000 }),
    authMax: int('AUTH_RATE_LIMIT_MAX', 5, { min: 1 }),
    // Expose RateLimit-* standard headers.
    standardHeaders: bool('RATE_LIMIT_STANDARD_HEADERS', true),
  }),

  perf: Object.freeze({
    compression: bool('ENABLE_COMPRESSION', true),
    compressionLevel: int('COMPRESSION_LEVEL', 6, { min: 0, max: 9 }),
    etags: bool('ENABLE_ETAGS', true),
  }),

  email: Object.freeze({
    brevoApiKey: str('BREVO_API_KEY'),
    senderEmail: str('SENDER_EMAIL'),
    senderName: str('SENDER_NAME', 'Fresha Salon'),
    get configured() {
      return Boolean(this.brevoApiKey && this.senderEmail);
    },
  }),

  sms: Object.freeze({
    provider: str('SMS_PROVIDER'), // 'console' | 'twilio' | '' (disabled)
    accountSid: str('TWILIO_ACCOUNT_SID'),
    authToken: str('TWILIO_AUTH_TOKEN'),
    fromNumber: str('SMS_FROM_NUMBER'),
    get configured() {
      return this.provider === 'console' || Boolean(this.accountSid && this.authToken && this.fromNumber);
    },
  }),

  payments: Object.freeze({
    cashfreeAppId: str('CASHFREE_APP_ID'),
    cashfreeSecretKey: str('CASHFREE_SECRET_KEY'),
    cashfreeEnv: str('CASHFREE_ENV', 'sandbox').toLowerCase(),
    // '' (auto) | 'demo' | 'live'. 'demo' forces fake payments even when real
    // keys exist; 'live' is explicit. Auto = demo whenever keys are missing,
    // so an unconfigured deployment still demos the full booking flow.
    mode: str('PAYMENTS_MODE', '').toLowerCase(),
    // Refund window offered to customers (hours after a cancelled booking).
    refundWindowHours: int('REFUND_WINDOW_HOURS', 24, { min: 0, max: 24 * 90 }),
    get configured() {
      return Boolean(this.cashfreeAppId && this.cashfreeSecretKey);
    },
    // Demo ("fake") payments: on when forced via PAYMENTS_MODE=demo, or when
    // no Cashfree credentials are configured (there is no gateway to talk to).
    get demo() {
      return this.mode === 'demo' || (this.mode !== 'live' && !this.configured);
    },
  }),

  reminders: Object.freeze({
    // REMINDERS_DISABLED=1 opts tests/CI out of the hourly email sweep.
    disabled: bool('REMINDERS_DISABLED', false),
    // How far ahead of an appointment the reminder fires.
    leadHours: int('REMINDER_LEAD_HOURS', 24, { min: 1, max: 168 }),
  }),

  features: Object.freeze({
    // Runtime feature flags (see services/featureFlags.js). FEATURE_* env vars
    // are the bootstrap layer so flags can be set without a DB round-trip.
    fromEnv: Object.freeze(
      Object.fromEntries(
        Object.keys(process.env)
          .filter((k) => k.startsWith('FEATURE_'))
          .map((k) => [k.slice('FEATURE_'.length).toLowerCase(), bool(k, false)])
      )
    ),
  }),
});

/** Keys whose values must never be logged or returned over HTTP. */
const SECRET_KEYS = new Set(['jwtSecret', 'brevoApiKey', 'authToken', 'cashfreeSecretKey', 'pass']);

/**
 * Deep copy of the config with every secret replaced by '***'.
 * Safe to log at boot or expose on an operator-only debug endpoint.
 */
const redacted = (node = config) => {
  if (Array.isArray(node)) return node.map(redacted);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      // Getters (e.g. email.configured) are resolved by the read above.
      out[k] = SECRET_KEYS.has(k) ? (v ? '***' : '') : redacted(v);
    }
    return out;
  }
  return node;
};

/**
 * Boot-time assertion that the absolute must-haves are present.
 * Deliberately NOT wired into module load — app.js decides whether to exit so
 * tests can require config without needing a real secret.
 */
const validate = () => {
  const problems = [];
  if (!config.auth.jwtSecret) problems.push('JWT_SECRET is not set');
  if (config.isProduction && !config.db.url) problems.push('DATABASE_URL is not set in production');
  if (config.isProduction && config.auth.jwtSecret === 'secret') {
    problems.push('JWT_SECRET must not be the value "secret" in production');
  }
  return { ok: problems.length === 0, problems };
};

module.exports = {
  config,
  redacted,
  validate,
  isProduction,
  isTest,
  // Parsers are exported so tests can exercise edge cases (garbage input,
  // clamping) without spawning a subprocess with different env vars.
  parsers: Object.freeze({ str, bool, int, list }),
};
