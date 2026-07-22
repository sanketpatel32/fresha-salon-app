/**
 * Minimal structured logger — no external dependency.
 *
 * Replaces raw console.log/console.error with leveled, timestamped output.
 * Keeps the deploy footprint small (no winston/pino) while giving every log
 * line a consistent shape: [LEVEL timestamp] message.
 *
 * Levels mirror the syslog convention: error > warn > info > debug.
 * Set LOG_LEVEL=debug in .env to see debug output; default is info.
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const configuredLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[configuredLevel] ?? LEVELS.info;

const pad = (n) => String(n).padStart(2, '0');
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const log = (level, message, meta) => {
  if (LEVELS[level] > threshold) return;
  const prefix = `[${level.toUpperCase()} ${stamp()}]`;
  if (meta !== undefined) {
    // Use console methods directly so output isn't double-wrapped.
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](prefix, message, meta);
  } else {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](prefix, message);
  }
};

module.exports = {
  error: (msg, meta) => log('error', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
};
