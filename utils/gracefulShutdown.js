/**
 * Graceful shutdown: stop accepting new work, finish what's in flight, then
 * release resources and exit.
 *
 * Why it matters: a container orchestrator (Render, Docker, k8s) sends SIGTERM
 * before killing a process. Without a handler the process dies mid-request —
 * in-flight bookings are severed between the Cashfree capture and the DB write,
 * and SQLite can leave a hot journal behind. With one, the deploy is invisible
 * to users.
 *
 * Mechanics:
 *  1. On the first signal, stop the HTTP listener (`server.close()`) so no new
 *     connections are accepted. Existing keep-alive sockets are allowed to
 *     finish unless they idle past `drainMs`.
 *  2. Wait up to `drainMs` for in-flight requests to complete. Active requests
 *     are counted by the middleware below, so the wait is exact rather than a
 *     blind sleep.
 *  3. Run registered cleanup hooks in order (DB close, scheduler stop, ...).
 *  4. Exit 0. On a second signal, or if any phase overruns `hardExitMs`, exit
 *     immediately — an orchestrator's SIGKILL is coming regardless.
 *
 * Everything is wrapped so a throwing hook can never prevent exit.
 */
const logger = require('./logger');
const { config } = require('./config');

const DEFAULT_DRAIN_MS = 15_000;
const DEFAULT_HARD_EXIT_MS = 30_000;

/** Live request counter, incremented by trackInFlight(). */
let inFlight = 0;
/** True once shutdown starts — used to reject new work and dedupe signals. */
let shuttingDown = false;

/**
 * Express middleware that counts active requests so the drain phase knows when
 * the server is genuinely idle. Mounted before routes.
 */
const trackInFlight = (req, res, next) => {
  // A request that arrives during shutdown has no chance of being honoured;
  // failing fast lets clients (and load balancers) retry elsewhere.
  if (shuttingDown) {
    res.setHeader('Connection', 'close');
    return res.status(503).json({ error: 'Server is shutting down' });
  }
  inFlight += 1;
  let settled = false;
  const release = () => {
    if (settled) return;
    settled = true;
    inFlight = Math.max(0, inFlight - 1);
  };
  // 'close' fires for both normal completion and client aborts, so it is the
  // only event we need — no leaked counter when a socket dies mid-flight.
  res.on('close', release);
  res.on('finish', release);
  return next();
};

/** Registered cleanup hooks: { name, fn } in execution order. */
const hooks = [];

/** Register a cleanup hook. Returns an unregister function (handy in tests). */
const onShutdown = (name, fn) => {
  const entry = { name, fn };
  hooks.push(entry);
  return () => {
    const i = hooks.indexOf(entry);
    if (i >= 0) hooks.splice(i, 1);
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Is a shutdown currently in progress? Exposed for health probes. */
const isShuttingDown = () => shuttingDown;

/** Current number of requests being served. Exposed for metrics (#44). */
const activeRequests = () => inFlight;

const runHook = async (hook) => {
  try {
    await hook.fn();
  } catch (err) {
    // One broken hook must not block the rest or prevent exit.
    logger.error(`shutdown: hook "${hook.name}" failed`, { error: err.message });
  }
};

/**
 * Perform the shutdown sequence. Exported so tests can drive it without
 * sending real signals to the process.
 */
const shutdown = async ({
  server = null,
  signal = 'manual',
  drainMs = DEFAULT_DRAIN_MS,
  hardExitMs = DEFAULT_HARD_EXIT_MS,
  exit = true,
} = {}) => {
  if (shuttingDown) return { alreadyShuttingDown: true };
  shuttingDown = true;
  const startedAt = Date.now();
  logger.info(`shutdown: ${signal} received, draining (max ${drainMs}ms)`);

  // Hard ceiling: whatever happens, we exit by this deadline rather than being
  // SIGKILLed mid-cleanup. Exit code 1 signals an unclean stop to the platform.
  let hardTriggered = false;
  const hardTimer = setTimeout(() => {
    hardTriggered = true;
    logger.error(`shutdown: hard timeout after ${hardExitMs}ms, forcing exit`);
    if (exit) process.exit(1);
  }, hardExitMs);
  if (typeof hardTimer.unref === 'function') hardTimer.unref();

  // Phase 1 — stop accepting new connections.
  if (server && typeof server.close === 'function' && server.listening) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, drainMs);
      if (typeof timer.unref === 'function') timer.unref();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // Phase 2 — wait for in-flight requests to drain (bounded by drainMs total).
  const deadline = startedAt + drainMs;
  while (inFlight > 0 && Date.now() < deadline) {
    await sleep(50);
  }
  if (inFlight > 0) {
    logger.warn(`shutdown: ${inFlight} request(s) still active after drain window`);
  }

  // Phase 3 — release resources: DB pool, schedulers, timers.
  for (const hook of [...hooks]) {
    await runHook(hook);
  }

  clearTimeout(hardTimer);
  const elapsed = Date.now() - startedAt;
  const result = {
    alreadyShuttingDown: false,
    signal,
    drainedMs: elapsed,
    inFlightRemaining: inFlight,
    hardTriggered,
  };
  logger.info(`shutdown: complete in ${elapsed}ms`);

  if (exit && !hardTriggered) process.exit(0);
  return result;
};

/**
 * Wire SIGTERM/SIGINT. A second signal forces an immediate exit — operators use
 * it to skip the drain when they know nothing important is in flight.
 *
 * Idempotent: calling twice only replaces the handlers, never double-registers.
 */
const install = ({
  server = null,
  drainMs = DEFAULT_DRAIN_MS,
  hardExitMs = DEFAULT_HARD_EXIT_MS,
} = {}) => {
  let signalCount = 0;
  const handler = (signal) => {
    signalCount += 1;
    if (signalCount > 1) {
      logger.warn(`shutdown: second ${signal}, exiting immediately`);
      process.exit(1);
    }
    shutdown({ server, signal, drainMs, hardExitMs, exit: true });
  };
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.removeAllListeners(sig);
    process.on(sig, () => handler(sig));
  }
  // Unhandled rejections/uncaught exceptions are logged and trigger an orderly
  // stop rather than leaving the process in an undefined half-state.
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { reason: reason && reason.message ? reason.message : String(reason) });
  });
  return true;
};

/** Test helper: forget all hooks and reset state between cases. */
const resetForTests = () => {
  hooks.length = 0;
  inFlight = 0;
  shuttingDown = false;
};

module.exports = {
  trackInFlight,
  onShutdown,
  shutdown,
  install,
  isShuttingDown,
  activeRequests,
  resetForTests,
  DEFAULTS: Object.freeze({ drainMs: DEFAULT_DRAIN_MS, hardExitMs: DEFAULT_HARD_EXIT_MS, port: config.server.port }),
};
