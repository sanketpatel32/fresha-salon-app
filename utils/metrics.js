/**
 * Prometheus-style metrics registry (#44) — no external dependency.
 *
 * /health answers "is it alive?"; metrics answer "is it healthy, and how is it
 * behaving over time?". This is the layer that makes latency regressions and
 * error spikes visible before a user reports them.
 *
 * Supported instrument types:
 *   counter   — monotonically increasing total (requests, errors, bookings)
 *   gauge     — value that goes up and down (in-flight requests, pool size)
 *   histogram — bucketed observations (request duration, payload size)
 *
 * Output is the Prometheus text exposition format (v0.0.4), scrapeable as-is by
 * Prometheus/Grafana/Datadog. A JSON view is exported too for quick eyeballing
 * and for tests, which assert on structure rather than parsing text.
 *
 * Cardinality discipline: labels are limited to low-cardinality values
 * (method, normalized route, status class). Ids and emails must NEVER become
 * labels — a new time series per user is the classic way to melt a monitoring
 * backend.
 */
const { activeRequests } = require('./gracefulShutdown');

/**
 * Default histogram buckets in milliseconds. Hand-tuned for a JSON API: the
 * interesting range is ~5ms..2s, with a coarse tail beyond that.
 */
const DEFAULT_DURATION_BUCKETS = Object.freeze([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]);

const store = {
  counters: new Map(),   // name -> { help, labels: Map(labelKey -> number) }
  gauges: new Map(),     // name -> { help, labels: Map(labelKey -> number) }
  histograms: new Map(), // name -> { help, buckets, labels: Map(labelKey -> {sum,count,buckets}) }
};

/** Stable label serialization: {a:1,b:2} -> 'a="1",b="2"' with sorted keys. */
const serializeLabels = (labels = {}) => {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return entries
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
    .join(',');
};

/** Escape a value for the text exposition format. */
const escapeHelp = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n');

/**
 * Instruments resolve their backing store LAZILY on every operation.
 *
 * This matters: `reset()` clears the maps, so an instrument that captured its
 * Map at creation time would keep incrementing an orphaned entry that no
 * longer appears in /metrics. Resolving per-call keeps module-level
 * instruments (httpRequests, ...) correct across resets.
 */
const counter = (name, help = '') => {
  const resolve = () => {
    if (!store.counters.has(name)) {
      store.counters.set(name, { help: help || name, labels: new Map() });
    }
    return store.counters.get(name);
  };
  return {
    inc(value = 1, labels = {}) {
      if (!Number.isFinite(value) || value < 0) return;
      const c = resolve();
      const key = serializeLabels(labels);
      c.labels.set(key, (c.labels.get(key) || 0) + value);
    },
    get(labels = {}) {
      return resolve().labels.get(serializeLabels(labels)) || 0;
    },
  };
};

const gauge = (name, help = '') => {
  const resolve = () => {
    if (!store.gauges.has(name)) {
      store.gauges.set(name, { help: help || name, labels: new Map() });
    }
    return store.gauges.get(name);
  };
  return {
    set(value, labels = {}) {
      if (!Number.isFinite(value)) return;
      resolve().labels.set(serializeLabels(labels), value);
    },
    inc(value = 1, labels = {}) {
      if (!Number.isFinite(value)) return;
      const g = resolve();
      const key = serializeLabels(labels);
      g.labels.set(key, (g.labels.get(key) || 0) + value);
    },
    dec(value = 1, labels = {}) {
      return this.inc(-value, labels);
    },
    get(labels = {}) {
      return resolve().labels.get(serializeLabels(labels));
    },
  };
};

const histogram = (name, help = '', buckets = DEFAULT_DURATION_BUCKETS) => {
  const resolve = () => {
    if (!store.histograms.has(name)) {
      // Sorted ascending + a +Inf catch-all, as the exposition format requires.
      const sorted = [...new Set([...buckets, Infinity])].sort((a, b) => a - b);
      store.histograms.set(name, { help: help || name, buckets: sorted, labels: new Map() });
    }
    return store.histograms.get(name);
  };
  return {
    observe(value, labels = {}) {
      if (!Number.isFinite(value) || value < 0) return;
      const h = resolve();
      const key = serializeLabels(labels);
      let entry = h.labels.get(key);
      if (!entry) {
        entry = { sum: 0, count: 0, buckets: new Map(h.buckets.map((b) => [b, 0])), labels };
        h.labels.set(key, entry);
      }
      entry.sum += value;
      entry.count += 1;
      for (const b of h.buckets) {
        if (value <= b) entry.buckets.set(b, entry.buckets.get(b) + 1);
      }
    },
  };
};

// ── Built-in instruments ──────────────────────────────────────────────
// Declared eagerly so /metrics is useful even on a freshly booted process.
const httpRequests = counter('http_requests_total', 'Total HTTP requests served');
const httpErrors = counter('http_errors_total', 'Total HTTP responses with status >= 400');
const httpDuration = histogram('http_request_duration_ms', 'HTTP request duration in milliseconds');
const inFlight = gauge('http_requests_in_flight', 'Requests currently being served');

const registerProcessCollectors = () => {
  const mem = gauge('process_resident_memory_bytes', 'Resident set size in bytes');
  const uptime = gauge('process_uptime_seconds', 'Process uptime in seconds');
  const heap = gauge('process_heap_used_bytes', 'V8 heap used in bytes');
  return () => {
    const usage = process.memoryUsage();
    mem.set(usage.rss);
    heap.set(usage.heapUsed);
    uptime.set(Math.round(process.uptime()));
  };
};
const collectProcess = registerProcessCollectors();

/**
 * Express middleware recording one observation per request.
 *
 * `routeOf(req)` normalizes the path so `/api/business/42` doesn't create a
 * distinct time series per salon id — the single most important cardinality
 * guard in the whole module.
 */
const metricsMiddleware = (req, res, next) => {
  const startNs = process.hrtime.bigint();
  inFlight.inc(1);
  res.on('finish', () => {
    try {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      const route = routeOf(req);
      const status = res.statusCode || 0;
      const labels = { method: req.method, route, status: String(status) };
      httpRequests.inc(1, labels);
      httpDuration.observe(durationMs, { method: req.method, route });
      if (status >= 400) httpErrors.inc(1, { method: req.method, route, status: String(status) });
      inFlight.dec(1);
    } catch (_err) { /* metrics must never affect the response */ }
  });
  next();
};

/**
 * Collapse a concrete path into a low-cardinality route pattern.
 * Numeric and UUID segments become :id; the /api prefix is kept.
 */
const routeOf = (req) => {
  // Express 5 exposes the matched layer on req.route for real routes; use it
  // when available since it's exact.
  if (req.route && req.route.path) {
    return `${req.baseUrl || ''}${req.route.path === '/*any' ? '/*' : req.route.path}`;
  }
  const rawPath = (req.baseUrl || '') + (req.path || (req.originalUrl || '').split('?')[0]);
  const segments = rawPath.split('/').map((seg) => {
    if (/^\d+$/.test(seg)) return ':id';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':uuid';
    return seg;
  });
  return segments.join('/');
};

/** Render the registry in Prometheus text exposition format. */
const toPrometheusText = () => {
  const lines = [];
  collectProcess();
  // Live in-flight count comes from the shutdown tracker (single source of truth).
  inFlight.set(activeRequests());

  for (const [name, c] of store.counters) {
    lines.push(`# HELP ${name} ${escapeHelp(c.help)}`);
    lines.push(`# TYPE ${name} counter`);
    for (const [labelKey, value] of c.labels) {
      lines.push(labelKey ? `${name}{${labelKey}} ${value}` : `${name} ${value}`);
    }
  }
  for (const [name, g] of store.gauges) {
    lines.push(`# HELP ${name} ${escapeHelp(g.help)}`);
    lines.push(`# TYPE ${name} gauge`);
    for (const [labelKey, value] of g.labels) {
      lines.push(labelKey ? `${name}{${labelKey}} ${value}` : `${name} ${value}`);
    }
  }
  for (const [name, h] of store.histograms) {
    lines.push(`# HELP ${name} ${escapeHelp(h.help)}`);
    lines.push(`# TYPE ${name} histogram`);
    for (const [, entry] of h.labels) {
      const base = serializeLabels(entry.labels);
      for (const b of h.buckets) {
        const le = b === Infinity ? '+Inf' : String(b);
        const labelBody = base ? `${base},le="${le}"` : `le="${le}"`;
        lines.push(`${name}_bucket{${labelBody}} ${entry.buckets.get(b)}`);
      }
      const sumLabels = base ? `{${base}}` : '';
      lines.push(`${name}_sum${sumLabels} ${entry.sum}`);
      lines.push(`${name}_count${sumLabels} ${entry.count}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

/** Structured view of the same data — easier to assert on in tests. */
const toJSON = () => {
  collectProcess();
  return {
    counters: Object.fromEntries(
      [...store.counters].map(([name, c]) => [name, Object.fromEntries(c.labels)])
    ),
    gauges: Object.fromEntries(
      [...store.gauges].map(([name, g]) => [name, Object.fromEntries(g.labels)])
    ),
    histograms: Object.fromEntries(
      [...store.histograms].map(([name, h]) => [
        name,
        [...h.labels].map(([, e]) => ({
          labels: e.labels,
          count: e.count,
          sum: e.sum,
          buckets: Object.fromEntries([...e.buckets].map(([b, v]) => [String(b), v])),
        })),
      ])
    ),
  };
};

/** Wipe every observation. Used by tests to get a clean slate. */
const reset = () => {
  store.counters.clear();
  store.gauges.clear();
  store.histograms.clear();
};

/** Express handler serving /metrics. */
const metricsHandler = (req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.status(200).send(toPrometheusText());
};

module.exports = {
  counter,
  gauge,
  histogram,
  metricsMiddleware,
  metricsHandler,
  toPrometheusText,
  toJSON,
  reset,
  routeOf,
  serializeLabels,
  DEFAULT_DURATION_BUCKETS,
  httpRequests,
  httpErrors,
  httpDuration,
  inFlight,
};
