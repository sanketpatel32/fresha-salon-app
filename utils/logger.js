/**
 * Structured logger — no external dependency.
 *
 * Two output modes, chosen by LOG_FORMAT (see utils/config.js):
 *   - `text` (default in dev)  — human-readable `[LEVEL timestamp] message {meta}`
 *   - `json` (default in prod) — one JSON object per line, for log aggregators
 *
 * The JSON shape is deliberately flat and conventional so Render/Datadog/ELK
 * pick it up without custom parsing:
 *   {"level":"info","time":"2026-08-28T20:47:50.123Z","msg":"...","requestId":"..."}
 *
 * Levels mirror the syslog convention: error > warn > info > debug. Set
 * LOG_LEVEL=debug to see debug output; default is info. Filtering happens
 * BEFORE formatting, so a suppressed level costs nothing.
 *
 * The module is defensive by design: logging must never throw into a request
 * path. Every emit is wrapped, and a serialization failure degrades to a
 * minimal JSON line instead of propagating.
 */
const LEVELS = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });

// Config is the source of truth, but it requires this module — so read the env
// directly here to avoid a require cycle, with the same defaults as config.js.
const rawLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const rawFormat = (process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'text')).toLowerCase();
const threshold = LEVELS[rawLevel] ?? LEVELS.info;
const useJson = rawFormat === 'json';

const pad = (n) => String(n).padStart(2, '0');

/** Human-readable local timestamp: YYYY-MM-DDTHH:mm:ss */
const textStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** ISO-8601 UTC with millis — what every log aggregator expects. */
const jsonStamp = () => new Date().toISOString();

/**
 * Meta is merged into the JSON payload, but meta values that are Error objects
 * don't survive JSON.stringify (their fields are non-enumerable), which would
 * silently drop the very detail that makes an error log useful. Normalize them.
 */
const normalizeMeta = (meta) => {
  if (!meta) return undefined;
  if (meta instanceof Error) {
    return { name: meta.name, message: meta.message, stack: meta.stack };
  }
  if (typeof meta !== 'object') return { value: meta };
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;
  }
  return out;
};

/** Safe stringify: circular refs degrade to '[Circular]' rather than throwing. */
const safeStringify = (obj) => {
  const seen = new WeakSet();
  try {
    return JSON.stringify(obj, (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      // BigInt has no JSON representation; stringify it instead of throwing.
      if (typeof value === 'bigint') return String(value);
      return value;
    });
  } catch (_err) {
    return '{"level":"error","msg":"log serialization failed"}';
  }
};

/**
 * Emit one log record. `bindings` are extra fields attached to every record
 * from a child logger (e.g. a requestId).
 */
const emit = (level, message, meta, bindings) => {
  if (LEVELS[level] > threshold) return;
  try {
    const normalized = normalizeMeta(meta);
    if (useJson) {
      const record = {
        level,
        time: jsonStamp(),
        msg: typeof message === 'string' ? message : safeStringify(message),
        ...(bindings || {}),
        ...(normalized || {}),
      };
      // eslint-disable-next-line no-console
      (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(safeStringify(record));
      return;
    }
    const prefix = `[${level.toUpperCase()} ${textStamp()}]`;
    const parts = bindings && Object.keys(bindings).length > 0 ? [prefix, message, bindings] : [prefix, message];
    // eslint-disable-next-line no-console
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(
      ...parts,
      ...(normalized ? [normalized] : [])
    );
  } catch (_err) {
    // Absolute last resort — never let logging break the caller.
    try {
      // eslint-disable-next-line no-console
      console.error('[LOGGER_FAILURE]', level, message);
    } catch (_ignored) { /* nowhere left to go */ }
  }
};

/** Root logger. */
const logger = {
  error: (msg, meta) => emit('error', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  debug: (msg, meta) => emit('debug', msg, meta),
  /**
   * Child logger whose bindings are merged into every record. Used to stamp a
   * requestId (or module name) across a request's log lines without threading
   * it through every call site.
   */
  child: (bindings) => ({
    error: (msg, meta) => emit('error', msg, meta, bindings),
    warn: (msg, meta) => emit('warn', msg, meta, bindings),
    info: (msg, meta) => emit('info', msg, meta, bindings),
    debug: (msg, meta) => emit('debug', msg, meta, bindings),
  }),
  /** Is a given level currently emitted? Useful for expensive debug paths. */
  isLevelEnabled: (level) => LEVELS[level] <= threshold,
};

module.exports = logger;
module.exports.LEVELS = LEVELS;
module.exports.currentLevel = () => rawLevel;
module.exports.currentFormat = () => (useJson ? 'json' : 'text');
