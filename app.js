// Import dependencies
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
dotenv.config();

// ── Centralized config (#37) ──────────────────────────────────────────
// Imported first so every later module reads one validated, frozen snapshot
// instead of re-parsing process.env ad hoc.
const { config, redacted, validate: validateConfig } = require('./utils/config');

// JWT_SECRET is mandatory — without it anyone could forge auth tokens.
// Refuse to boot rather than fall back to a known default.
const configCheck = validateConfig();
if (!configCheck.ok) {
  console.error('FATAL: invalid configuration');
  for (const problem of configCheck.problems) console.error(`  - ${problem}`);
  console.error('Generate a JWT secret with:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  console.error('and add it to your .env file (see .env.example).');
  process.exit(1);
}


// Import custom services and routes
const apiroutes = require('./routes/apiRoutes');
const sequelize = require('./utils/database');
const User = require('./models/userModel');
const Appointment = require('./models/appointmentModel');
const Payment = require('./models/paymentModel');
const Salons = require('./models/salonsModel');
const Services = require('./models/servicesModel');
const { ensureColumns } = require('./utils/ensureColumns');
const { isSchedulerEnabled } = require('./services/reminderService');
const { createSlotUniquenessIndex } = require('./services/bookingGuard');
require('./models/associations'); // Import relationships
// #58 / #59 / #61 — tables for recently-viewed salons, favorite staff and
// recurring series. Required here (not just in the services that use them) so
// sequelize.sync() creates them on a fresh database; a model only exists to
// sync() once it has been require()'d somewhere in the process.
require('./models/recentlyViewModel');
require('./models/favoriteStaffModel');
require('./models/recurringSeriesModel');

// Initialize express app
const app = express();

const { requestIdMiddleware, requestLogger, serverTiming, deepHealth } = require('./utils/observability');
const { compression } = require('./utils/compression');
const { metricsMiddleware, metricsHandler } = require('./utils/metrics');
const { trackInFlight, onShutdown, install: installShutdown } = require('./utils/gracefulShutdown');
const logger = require('./utils/logger');

// Trust Render's load balancer so req.protocol and secure cookies are
// reported correctly behind TLS termination.
app.set('trust proxy', config.server.trustProxy);

// Request correlation + access logging run before everything else so every
// response (including helmet/CORS/429 rejections) carries an X-Request-Id
// header and gets exactly one access-log line. Both are pure no-ops on the
// body stream, so the rawBody verify hook and CORS/rate-limit ordering are
// untouched.
app.use(requestIdMiddleware);
app.use(requestLogger);
// Server timing (#42) stamps X-Response-Time / Server-Timing on every response.
app.use(serverTiming);

// In-flight request accounting (#38) — the graceful-drain phase waits on this
// counter rather than sleeping a fixed duration, so deploys never sever a
// booking mid-write.
app.use(trackInFlight);

// Request metrics (#44): count, duration histogram and error rate, labelled by
// method + normalized route (never by id — see utils/metrics.js).
app.use(metricsMiddleware);

// Response compression (#40). Before the routes so everything they emit is
// eligible; skipped automatically for small/binary/no-transform responses.
if (config.perf.compression) {
  app.use(compression({ level: config.perf.compressionLevel }));
}

// Security headers (CSP disabled for the API server — the SPA sets its own).
// Hardened in #41: HSTS, Referrer-Policy, Permissions-Policy and COOP close
// off whole classes of attack that helmet's defaults leave open.
app.use(helmet({
  contentSecurityPolicy: false,
  // HSTS only in production — a localhost dev server advertising a 1-year
  // pin makes it awkward to reach over plain HTTP later.
  hsts: config.isProduction
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  // Never leak the full URL (which can carry reset tokens) to third parties.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Deny every powerful browser feature this app has no use for.
  permissionsPolicy: {
    features: {
      camera: ['none'], microphone: ['none'], geolocation: ['none'],
      payment: ['none'], usb: ['none'], accelerometer: ['none'], gyroscope: ['none'],
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  // Frame-busting: no salon page should ever be embeddable in a foreign iframe.
  frameguard: { action: 'deny' },
  // Legacy but cheap: stops MIME sniffing turning a JSON error into script.
  noSniff: true,
}));

// Permissions-Policy has to be set by hand: helmet REMOVED its
// permissionsPolicy middleware in v7, and unknown options are silently
// ignored rather than rejected — so passing it above would have looked right
// while doing nothing. A booking app needs no camera, mic, geolocation or
// payment APIs, so deny them all at the document level.
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), display-capture=(), encrypted-media=(), '
    + 'geolocation=(), gyroscope=(), magnetometer=(), microphone=(), '
    + 'midi=(), payment=(), usb=(), xr-spatial-tracking=()'
  );
  next();
});

// Body parsing. The verify hook stashes the raw body on req.rawBody so the
// Cashfree webhook handler can verify the signature over the exact bytes
// Cashfree signed, even though express.json() also parsed it.
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: false }));

// CORS — reflect the request origin when credentials are involved so the
// same-origin SPA can call /api. If ALLOWED_ORIGINS is set, restrict to that
// list (for deployments where the frontend is served from a different host).
const allowedOrigins = config.cors.allowedOrigins;
app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  credentials: true,
}));

// General rate limit — config-driven (default 100 requests / minute / IP).
// standardHeaders (#53) emits the RateLimit-Limit/Remaining/Reset trio so
// well-behaved clients can back off instead of guessing.
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: config.rateLimit.standardHeaders ? 'draft-7' : false,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', apiLimiter);

// Stricter rate limit on login endpoints — 5 attempts / 15 minutes / IP,
// to slow brute-force attacks on the login flows. The shared definition
// lives in middlewares/rateLimiters.js so the password-reset routes apply
// the exact same policy without duplicating options.
const { strictLimiter: loginLimiter } = require('./middlewares/rateLimiters');
app.use('/api/user/login', loginLimiter);
app.use('/api/buisness/login', loginLimiter);
app.use('/api/staff/login', loginLimiter);
app.use('/api/admin/login', loginLimiter);
// Signup gets the same limiter as login: account creation is just as
// abuse-worthy (slows bulk fake-account creation). Business signup is
// covered at both mounts — /buisness is the legacy misspelling still
// used by the frontend, /business the correctly-spelled alias.
app.use('/api/user/signup', loginLimiter);
app.use('/api/business/signup', loginLimiter);
app.use('/api/buisness/signup', loginLimiter);

app.use('/api', apiroutes);

// Prometheus scrape endpoint (#44). Mounted outside /api so it is not subject
// to the API rate limiter — a metrics poller must never get throttled.
app.get('/metrics', metricsHandler);

// Resolved-configuration snapshot (#37) for operators debugging a deployment.
// Secrets are redacted and it only answers in non-production, so it can never
// become a credential-exfiltration vector.
if (!config.isProduction) {
  app.get('/debug/config', (_req, res) => {
    res.status(200).json({ ok: true, config: redacted() });
  });
}

// Lightweight health probe for Render's health check. Deliberately has no
// DB dependency so the service is not killed during a slow DB connect.
app.get('/health', (req, res) => {
  // During a drain we report 503 so the load balancer stops routing to us
  // while in-flight requests finish (see utils/gracefulShutdown.js).
  if (require('./utils/gracefulShutdown').isShuttingDown()) {
    return res.status(503).json({ status: 'shutting-down', uptime: process.uptime() });
  }
  return res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Deep health probe for humans/monitors: actually pings the DB. 200 when the
// DB answers, 503 degraded otherwise — unlike /health this may fail during a
// slow DB connect, so Render should keep pointing at the lightweight one.
app.get('/health/deep', async (req, res) => {
  const health = await deepHealth();
  if (health.ok) {
    res.status(200).json({ status: 'ok', ...health });
  } else {
    res.status(503).json({ status: 'degraded', ...health });
  }
});

// Self-serve API documentation (#33): machine-readable JSON dump + a tiny
// dependency-free searchable HTML viewer. Both public; mounted beside the
// health endpoints and deliberately BEFORE express.static and the SPA
// catch-all below, which would otherwise swallow these paths. The handlers
// live in utils/apiDocs.js (hand-curated reference object + inline-CSS
// viewer — no external CDNs, dark-mode aware) so tests can drive them
// directly without booting this module (require(app.js) starts a listener).
const { apiDocsJsonHandler, apiDocsPageHandler } = require('./utils/apiDocs');
app.get('/api-docs.json', apiDocsJsonHandler);
app.get('/api-docs', apiDocsPageHandler);

// Serve static files of compiled React frontend
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

// Root route serves the React SPA index.html for all non-api client routes
app.get('*any', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});

// Global error handler — the last middleware. Logs the full error server-side,
// returns a generic message to the client so internal details (stack traces,
// third-party API responses, DB errors) never leak.
// biome-ignore lint: Express requires all 4 args to identify an error handler
app.use((err, req, res, _next) => {
  // req.id ties this error to the client's X-Request-Id and the access-log line.
  console.error('Unhandled error:', req && req.id ? `[req ${req.id}]` : '', err);
  const status = err.status || (err.name === 'SequelizeValidationError' ? 400 : 500);
  res.status(status).json({ error: status === 400 && err.message ? err.message : 'Internal server error' });
});


// Root route to serve the main HTML file

// app.get('/admin', (req, res) => {
//   res.sendFile(path.join(__dirname, 'views', 'admin','adminlogin.html'));
// });



// Automatic premium sample data seeding function
const seedSampleData = async () => {
  const { Salons, Staff, Services, User } = require('./models/associations');
  const bcrypt = require('bcrypt');

  try {
    const salonCount = await Salons.count();
    if (salonCount > 0) {
      return; // Already populated
    }

    console.log('🌱 Database is empty. Seeding premium sample data...');

    // 1. Create Sample Users (password: customer123)
    const hashedCustomerPassword = await bcrypt.hash('customer123', 10);
    await User.create({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: hashedCustomerPassword,
      phoneNumber: '9876543210'
    });
    await User.create({
      name: 'John Smith',
      email: 'john@example.com',
      password: hashedCustomerPassword,
      phoneNumber: '8765432109'
    });

    // 2. Create Salons (password: salon123)
    const hashedSalonPassword = await bcrypt.hash('salon123', 10);
    const salon1 = await Salons.create({
      name: 'Orchid Luxury Hair & Spa',
      email: 'owner@orchid.com',
      password: hashedSalonPassword,
      phoneNumber: '9876543201',
      address: '102 Royal Boulevard, City Center',
      pricing: 'Premium',
      openingTime: '09:00',
      closingTime: '20:00',
      workingDays: 'Mon, Tue, Wed, Thu, Fri, Sat'
    });

    const salon2 = await Salons.create({
      name: 'Aura Mens Grooming & Co',
      email: 'owner@aura.com',
      password: hashedSalonPassword,
      phoneNumber: '9876543202',
      address: '45 Metro Heights, Business Plaza',
      pricing: 'Moderate',
      openingTime: '10:00',
      closingTime: '21:00',
      workingDays: 'Mon, Tue, Wed, Thu, Fri, Sat, Sun'
    });

    const salon3 = await Salons.create({
      name: 'Vibe Quick Cuts & Styles',
      email: 'owner@vibe.com',
      password: hashedSalonPassword,
      phoneNumber: '9876543203',
      address: '88 University Avenue, West Side',
      pricing: 'Affordable',
      openingTime: '08:00',
      closingTime: '19:00',
      workingDays: 'Mon, Wed, Thu, Fri, Sat, Sun'
    });

    // 3. Create Services (with categories)
    const s1 = await Services.create({ name: 'Royal Keratin Hair Treatment', price: 2500, duration: 60, statusbar: 'active', category: 'Hair', salonId: salon1.id });
    const s2 = await Services.create({ name: 'Aromatherapy Full Body Massage', price: 3200, duration: 90, statusbar: 'active', category: 'Spa & Massage', salonId: salon1.id });
    const s3 = await Services.create({ name: 'Classic Hydrating Facial', price: 1800, duration: 45, statusbar: 'active', category: 'Facial & Skin', salonId: salon1.id });

    const s4 = await Services.create({ name: 'Signature Beard Trim & Steam Shave', price: 800, duration: 30, statusbar: 'active', category: "Men's Grooming", salonId: salon2.id });
    const s5 = await Services.create({ name: 'Executive Hair Styling & Wash', price: 1200, duration: 45, statusbar: 'active', category: 'Hair', salonId: salon2.id });

    const s6 = await Services.create({ name: 'Express Dry Cut', price: 350, duration: 15, statusbar: 'active', category: 'Hair', salonId: salon3.id });
    const s7 = await Services.create({ name: 'Basic Head Massage & Wash', price: 250, duration: 15, statusbar: 'active', category: 'Spa & Massage', salonId: salon3.id });

    // 4. Create Staff (password: staff123) — hashed with bcrypt
    const hashedStaffPassword = await bcrypt.hash('staff123', 10);
    const staff1 = await Staff.create({ name: 'Dr. Sarah Jenkins', phoneNumber: '9876543101', email: 'sarah@orchid.com', password: hashedStaffPassword, statusbar: 'active', salonId: salon1.id });
    const staff2 = await Staff.create({ name: 'Marcus Aurelius', phoneNumber: '9876543102', email: 'marcus@orchid.com', password: hashedStaffPassword, statusbar: 'active', salonId: salon1.id });
    const staff3 = await Staff.create({ name: 'James Oliver', phoneNumber: '9876543103', email: 'james@aura.com', password: hashedStaffPassword, statusbar: 'active', salonId: salon2.id });
    const staff4 = await Staff.create({ name: 'Tina Miller', phoneNumber: '9876543104', email: 'tina@vibe.com', password: hashedStaffPassword, statusbar: 'active', salonId: salon3.id });

    // 5. Associate Staff with Services
    await staff1.setServices([s1, s2, s3]);
    await staff2.setServices([s1, s3]);
    await staff3.setServices([s4, s5]);
    await staff4.setServices([s6, s7]);

    console.log('✅ Premium seed data loaded successfully!');
  } catch (error) {
    console.error('❌ Error during data seeding:', error);
  }
};

// Start the server immediately and sync database in the background
const PORT = config.server.port;
const server = app.listen(PORT, config.server.host, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`👉 Open http://localhost:${PORT} in your browser`);
  console.log(`   env=${config.env} logFormat=${logger.currentFormat()} compression=${config.perf.compression}`);
  console.log(`==================================================\n`);

  // ── Graceful shutdown (#38) ──────────────────────────────────────────
  // SIGTERM (deploys) and SIGINT (Ctrl-C) stop accepting connections, let
  // in-flight requests finish, then release the DB pool. Without this a
  // routine deploy can sever a booking between payment capture and DB write.
  onShutdown('database', async () => {
    try {
      await sequelize.close();
      logger.info('shutdown: database connection closed');
    } catch (err) {
      logger.error('shutdown: failed to close database', { error: err.message });
    }
  });
  installShutdown({ server });

  sequelize
    .sync()
    .then(async () => {
      console.log('✅ Database synced successfully.');
      // sync() creates tables but never ALTERs existing ones — backfill any
      // columns added to models since this database was first created.
      await ensureColumns(User, 'users', [
        { name: 'resetTokenHash', typeSql: 'VARCHAR(255)' },
        // SQLite spells it DATETIME; Postgres (production) has no DATETIME type.
        {
          name: 'resetTokenExpiresAt',
          typeSql: sequelize.getDialect() === 'postgres' ? 'TIMESTAMP' : 'DATETIME',
        },
        // Email verification (soft flag + hashed token). BOOLEAN is native on
        // both SQLite and Postgres; MySQL-family dialects want TINYINT(1).
        {
          name: 'emailVerified',
          typeSql: ['mysql', 'mariadb'].includes(sequelize.getDialect()) ? 'TINYINT(1)' : 'BOOLEAN',
        },
        { name: 'verificationTokenHash', typeSql: 'VARCHAR(255)' },
        {
          name: 'verificationExpiresAt',
          typeSql: sequelize.getDialect() === 'postgres' ? 'TIMESTAMP' : 'DATETIME',
        },
        // Loyalty points (#27) — the balance and its cumulative audit counter.
        // INTEGER NOT NULL DEFAULT 0 works identically on SQLite and Postgres
        // and backfills every legacy row at 0 during this ALTER.
        { name: 'loyaltyPoints', typeSql: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'lifetimePointsEarned', typeSql: 'INTEGER NOT NULL DEFAULT 0' },
        // Referral program (#28) — personal code + who referred the account.
        // Both nullable: codes are assigned lazily on first request and every
        // legacy row stays NULL. No UNIQUE in the typeSql on purpose —
        // SQLite's ALTER TABLE ADD COLUMN cannot carry a UNIQUE constraint;
        // uniqueness is enforced by the index created right below instead.
        // NULLs never collide: SQLite and Postgres both treat NULLs as
        // distinct in unique indexes, so all pre-code legacy rows coexist.
        { name: 'referralCode', typeSql: 'VARCHAR(12)' },
        { name: 'referredByUserId', typeSql: 'INTEGER' },
      ]);
      // Unique referral codes (#28). IF NOT EXISTS keeps this idempotent; for
      // tables freshly created by sync() the model already declared the
      // column UNIQUE, so this simply mirrors that constraint onto databases
      // whose users table predates the feature.
      await sequelize.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_uq ON users (referralCode)'
      );
      // Salon replies to customer reviews — TEXT is valid on both SQLite and
      // Postgres, so no dialect switch needed here. customerNote is the
      // customer's own free-text note on a booking (same TEXT reasoning).
      // partySize (group bookings) is INTEGER NOT NULL DEFAULT 1 on every
      // supported dialect — the default keeps legacy rows valid.
      await ensureColumns(Appointment, 'Appointments', [
        { name: 'salonReply', typeSql: 'TEXT' },
        { name: 'customerNote', typeSql: 'TEXT' },
        { name: 'partySize', typeSql: 'INTEGER NOT NULL DEFAULT 1' },
        // Loyalty idempotency stamp (#27) — nullable DATETIME on SQLite,
        // TIMESTAMP on Postgres (same dialect split as resetTokenExpiresAt).
        {
          name: 'pointsAwardedAt',
          typeSql: sequelize.getDialect() === 'postgres' ? 'TIMESTAMP' : 'DATETIME',
        },
        // Reminder idempotency stamp (#29) — same nullable stamp shape as
        // pointsAwardedAt: the hourly sweep claims bookings by setting this
        // BEFORE sending, so restarts/replays can never double-send.
        {
          name: 'reminderSentAt',
          typeSql: sequelize.getDialect() === 'postgres' ? 'TIMESTAMP' : 'DATETIME',
        },
        // Optimistic concurrency token (#48). NOT NULL DEFAULT 0 backfills
        // every legacy row at version 0, which is exactly right: they have
        // never been mutated through the versioned path.
        { name: 'version', typeSql: 'INTEGER NOT NULL DEFAULT 0' },
        // Cancellation reasons (#60). All nullable — every pre-#60
        // cancellation legitimately has no reason, and the analytics endpoint
        // reports those as an explicit "unspecified" bucket.
        { name: 'cancellationReason', typeSql: 'VARCHAR(32)' },
        { name: 'cancellationNote', typeSql: 'VARCHAR(200)' },
        {
          name: 'cancelledAt',
          typeSql: sequelize.getDialect() === 'postgres' ? 'TIMESTAMP' : 'DATETIME',
        },
        // Recurring series link (#61). Nullable — most bookings are one-offs.
        { name: 'seriesId', typeSql: 'INTEGER' },
        { name: 'occurrenceIndex', typeSql: 'INTEGER' },
      ]);
      // Recurring series: (seriesId, occurrenceIndex) is the sweep's
      // idempotency key (see services/recurringService.js). Partial so
      // one-off bookings — which all have NULL seriesId — aren't dragged into
      // the index at all.
      await sequelize.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS appointments_series_occurrence_uq '
        + 'ON "Appointments" (seriesId, occurrenceIndex) WHERE seriesId IS NOT NULL'
      ).catch((err) => {
        console.warn('⚠️ Could not create the series-occurrence index:', err.message);
      });
      // One ACTIVE waitlist entry per user+salon+day. Partial (only
      // status='waiting') so leaving and rejoining stays legal. Best-effort:
      // a pre-existing duplicate only logs a warning, like the indexes above.
      await sequelize.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS waitlist_active_entry_uq '
        + 'ON "Waitlists" (userId, salonId, date) WHERE status = \'waiting\''
      ).catch((err) => {
        console.warn('⚠️ Could not create the waitlist uniqueness index:', err.message);
      });
      // ── Reminder email scheduler (#29) ──────────────────────────────────
      // Hourly sweep of bookings starting within the next 24h: each gets one
      // reminder, claimed by stamping reminderSentAt first (at-most-once).
      // Runs once ~30s after boot (harmless when the mailer is unconfigured)
      // and then every hour. REMINDERS_DISABLED=1 opts tests/CI out entirely.
      // Both timers funnel through a wrapper that catches everything — sync
      // throws AND promise rejections — so the scheduler can never crash the
      // process. Timers are unref'd so they can't hold a dying process open.
      if (isSchedulerEnabled()) {
        const { runReminderSweep, SWEEP_INTERVAL_MS } = require('./services/reminderService');
        const safeSweep = () => {
          try {
            Promise.resolve(runReminderSweep()).catch((err) =>
              console.error('⚠️ Reminder sweep failed:', err.message));
          } catch (err) {
            console.error('⚠️ Reminder sweep failed:', err.message);
          }
        };
        setTimeout(safeSweep, 30 * 1000).unref();
        setInterval(safeSweep, SWEEP_INTERVAL_MS).unref();
      }
      // ── Recurring series sweep (#61) ───────────────────────────────────
      // Without this the series endpoints are decorative: a series is stored
      // intent, and only the sweep turns that intent into the pending
      // appointments the salon actually confirms. Materializing 14 days ahead
      // is the point of the horizon, so a DAILY sweep is comfortably ahead of
      // it — and because materialization is idempotent (it counts rows rather
      // than advancing a cursor) running it more often than needed costs
      // nothing but a query.
      //
      // Same safety contract as the reminder sweep: everything is caught, and
      // both timers are unref'd so they can never hold a dying process open.
      if (isSchedulerEnabled()) {
        const { materializeDueSeries } = require('./services/recurringService');
        const SERIES_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
        const safeSeriesSweep = () => {
          try {
            Promise.resolve(materializeDueSeries()).then((stats) => {
              if (stats.created > 0) {
                console.log(`🔁 Series sweep: created ${stats.created} occurrence(s), skipped ${stats.skipped}`);
              }
            }).catch((err) => console.error('⚠️ Series sweep failed:', err.message));
          } catch (err) {
            console.error('⚠️ Series sweep failed:', err.message);
          }
        };
        // ~2 minutes after boot: after the reminder sweep, so the two never
        // compete for the connection pool on a cold start.
        setTimeout(safeSeriesSweep, 2 * 60 * 1000).unref();
        setInterval(safeSeriesSweep, SERIES_SWEEP_INTERVAL_MS).unref();
      }
      // Promo-code ledger columns on payments. originalAmount/discountAmount
      // preserve the pre-discount price and what the promo took off, while
      // orderAmount (and the Cashfree order) carry the discounted final.
      // customerNote is the carrier that threads the customer's booking note
      // from order creation to appointment finalization; partySize is the
      // matching carrier for group bookings (NOT NULL DEFAULT 1 so legacy
      // rows stay valid). tipAmount/tipCaptured are the optional-tip pair:
      // nullable DECIMAL for the amount (null = no tip), INTEGER NOT NULL
      // DEFAULT 0 for the "booking finalized" flag.
      await ensureColumns(Payment, 'payments', [
        { name: 'originalAmount', typeSql: 'DECIMAL(10,2)' },
        { name: 'discountAmount', typeSql: 'DECIMAL(10,2)' },
        { name: 'promoCodeApplied', typeSql: 'VARCHAR(64)' },
        { name: 'customerNote', typeSql: 'TEXT' },
        { name: 'partySize', typeSql: 'INTEGER NOT NULL DEFAULT 1' },
        { name: 'tipAmount', typeSql: 'DECIMAL(10,2)' },
        { name: 'tipCaptured', typeSql: 'INTEGER NOT NULL DEFAULT 0' },
      ]);
      // Salon photo gallery (JSON string[] of image URLs). TEXT is valid on
      // both SQLite and Postgres, so no dialect switch needed here either.
      // Booking policy columns are plain INTEGERs (minutes) — same type on
      // every supported dialect. weeklyHours (JSON string of a 7-day
      // schedule) is TEXT for the same reason as galleryImages.
      await ensureColumns(Salons, 'salons', [
        { name: 'galleryImages', typeSql: 'TEXT' },
        { name: 'bookingLeadTimeMinutes', typeSql: 'INTEGER' },
        { name: 'slotStepMinutes', typeSql: 'INTEGER' },
        { name: 'weeklyHours', typeSql: 'TEXT' },
      ]);
      // ── Double-booking constraint (#47) ────────────────────────────────
      // Partial unique index so two concurrent payments can never both create
      // a booking for one chair. Best-effort: an old database with pre-existing
      // duplicates logs a warning and keeps serving rather than failing boot.
      await createSlotUniquenessIndex(sequelize);

      // Soft-delete stamp for services (#51). Nullable DATETIME/TIMESTAMP —
      // null means "never archived", so every existing service stays live.
      await ensureColumns(Services, 'services', [
        {
          name: 'archivedAt',
          typeSql: sequelize.getDialect() === 'postgres' ? 'TIMESTAMP' : 'DATETIME',
        },
      ]);

      await seedSampleData();
      // Backfill categories on any services that lack one (post-migration safety net).
      const { migrateCategories } = require('./utils/migrateCategories');
      await migrateCategories();
    })
    .catch((err) => {
      console.log('⚠️ Database connection failed. Check your DATABASE_URL (or local SQLite).');
      console.error('Error message:', err.message);
    });
});