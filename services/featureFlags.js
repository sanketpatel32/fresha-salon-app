/**
 * Runtime feature flags (#45).
 *
 * Lets behaviour be switched on/off without a deploy, and rolled out
 * progressively (a percentage of users, or a named allowlist) so a risky change
 * can be validated on a small slice before going wide.
 *
 * Resolution order — first match wins:
 *   1. In-memory override (set at runtime via `set()`, e.g. from an admin call)
 *   2. Environment variable `FEATURE_<NAME>`=true/false  (bootstrap layer)
 *   3. Built-in default declared in `define()`
 *
 * Percentage rollout is DETERMINISTIC: the same (flag, subjectKey) pair always
 * lands on the same side of the line, so a user doesn't flip between variants
 * across requests. Bucketing is an FNV-1a hash — fast, dependency-free, and
 * evenly distributed enough for rollout purposes.
 *
 * Calling an undefined flag is a programming error rather than a silent false:
 * in test/development it throws, in production it logs once and returns the
 * fallback. That asymmetry catches typos early without taking prod down.
 */
const crypto = require('node:crypto');
const logger = require('../utils/logger');
const { config, isTest } = require('../utils/config');

/** name(lowercase) -> { default, description, rolloutPct, allowlist } */
const registry = new Map();
/** name(lowercase) -> boolean (runtime override) */
const overrides = new Map();
/** Flags already warned about, so we log each unknown flag only once. */
const warned = new Set();

const normalize = (name) => String(name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/**
 * FNV-1a 32-bit. Chosen over a cryptographic hash because it's ~10x faster and
 * rollout bucketing has no adversarial requirement.
 */
const fnv1a = (str) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // hash * 16777619 with 32-bit overflow emulation
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

/**
 * Declare a flag. Safe to call repeatedly (idempotent) and safe at module load,
 * which is how the built-in flags below are registered.
 *
 * @param {string} name
 * @param {object} [opts]
 * @param {boolean} [opts.default=false]      Value when nothing else is set.
 * @param {number}  [opts.rolloutPct=100]     0..100 share of subjects enabled.
 * @param {Array<string>} [opts.allowlist]    Subject keys always enabled.
 * @param {string} [opts.description]
 */
const define = (name, { default: defaultValue = false, rolloutPct = 100, allowlist = [], description = '' } = {}) => {
  const key = normalize(name);
  registry.set(key, {
    name: key,
    default: Boolean(defaultValue),
    rolloutPct: Math.min(100, Math.max(0, rolloutPct)),
    allowlist: new Set(allowlist.map(String)),
    description,
  });
  return key;
};

/**
 * Is the flag enabled for this subject?
 *
 * @param {string} name        Flag name (case/space-insensitive).
 * @param {object} [context]
 * @param {string|number} [context.key]  Stable subject id for rollout
 *   bucketing (userId, salonId, ...). Omit for a pure global on/off.
 * @param {*} [context.fallback]  Returned for an unknown flag in production.
 */
const isEnabled = (name, context = {}) => {
  const key = normalize(name);
  const def = registry.get(key);

  // 1. Runtime override wins outright.
  if (overrides.has(key)) return overrides.get(key);

  // 2. Environment variable (bootstrap).
  const fromEnv = config.features.fromEnv[key];
  if (fromEnv !== undefined) return fromEnv;

  // 3. Unknown flag — programming error. Loud in dev, quiet in prod.
  if (!def) {
    if (isTest || config.isDevelopment) {
      throw new Error(`Unknown feature flag "${name}" — declare it with featureFlags.define() first`);
    }
    if (!warned.has(key)) {
      warned.add(key);
      logger.warn(`featureFlags: unknown flag "${key}" evaluated (returning false)`);
    }
    return context.fallback !== undefined ? Boolean(context.fallback) : false;
  }

  if (!def.default) return false;

  // Declared on, but maybe only partially rolled out.
  const subjectKey = context.key !== undefined && context.key !== null ? String(context.key) : null;
  if (subjectKey && def.allowlist.has(subjectKey)) return true;
  if (def.rolloutPct >= 100) return true;
  if (def.rolloutPct <= 0) return false;

  // No stable subject key => can't bucket => treat as fully enabled, since the
  // caller explicitly asked for a global check.
  if (!subjectKey) return true;

  const bucket = fnv1a(`${key}:${subjectKey}`) % 100;
  return bucket < def.rolloutPct;
};

/** Force a flag on/off for the lifetime of the process. */
const set = (name, value) => {
  const key = normalize(name);
  overrides.set(key, Boolean(value));
  logger.info(`featureFlags: "${key}" overridden to ${Boolean(value)}`);
  return overrides.get(key);
};

/** Drop a runtime override, reverting to env/default resolution. */
const clear = (name) => {
  const key = normalize(name);
  overrides.delete(key);
};

/** Remove every runtime override (used by tests). */
const resetOverrides = () => {
  overrides.clear();
};

/** Update a declared flag's rollout/allowlist at runtime. */
const configure = (name, { rolloutPct, allowlist, description } = {}) => {
  const key = normalize(name);
  const def = registry.get(key);
  if (!def) return null;
  if (rolloutPct !== undefined) def.rolloutPct = Math.min(100, Math.max(0, rolloutPct));
  if (allowlist !== undefined) def.allowlist = new Set(allowlist.map(String));
  if (description !== undefined) def.description = description;
  return { ...def, allowlist: [...def.allowlist] };
};

/**
 * Snapshot of every flag and its effective value — for an admin/debug endpoint.
 * `source` explains WHY a flag resolved the way it did, which is the first
 * question anyone asks when a flag misbehaves.
 */
const list = () => [...registry.values()].map((def) => {
  let source = 'default';
  if (overrides.has(def.name)) source = 'override';
  else if (config.features.fromEnv[def.name] !== undefined) source = 'env';
  return {
    name: def.name,
    description: def.description,
    enabled: isEnabled(def.name),
    source,
    rolloutPct: def.rolloutPct,
    allowlist: [...def.allowlist],
    default: def.default,
  };
});

/** Stable bucketing helper, exported so tests can assert rollout stability. */
const bucketOf = (name, key) => fnv1a(`${normalize(name)}:${String(key)}`) % 100;

/** SHA-256 based variant assignment — for A/B tests needing many variants. */
const variantOf = (name, key, variants = ['a', 'b']) => {
  const hash = crypto.createHash('sha256').update(`${normalize(name)}:${String(key)}`).digest();
  return variants[hash.readUInt32BE(0) % variants.length];
};

// ── Built-in flags ────────────────────────────────────────────────────
// Declaring them here means an admin listing always shows the full surface,
// even for flags that have never been touched.
define('recurring_bookings', { default: true, description: 'Recurring booking series (#61)' });
define('gift_cards', { default: true, description: 'Gift cards and store credit (#63)' });
define('memberships', { default: true, description: 'Membership plans (#64)' });
define('deposits', { default: true, description: 'Deposit / advance payments (#69)' });
define('service_addons', { default: true, description: 'Service add-ons (#70)' });
define('staff_commission', { default: true, description: 'Staff commission tracking (#71)' });
define('web_push', { default: false, description: 'Web-push notifications (#78)' });
define('sms_notifications', { default: false, description: 'SMS notification channel (#77)' });
define('impersonation', { default: false, description: 'Admin impersonation (#80)' });

module.exports = {
  define,
  isEnabled,
  set,
  clear,
  configure,
  resetOverrides,
  list,
  bucketOf,
  variantOf,
  fnv1a,
  normalize,
  /** Registry size — handy for tests asserting idempotent definition. */
  size: () => registry.size,
};
