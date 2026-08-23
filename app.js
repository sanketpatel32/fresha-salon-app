// Import dependencies
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
dotenv.config();

// JWT_SECRET is mandatory — without it anyone could forge auth tokens.
// Refuse to boot rather than fall back to a known default.
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Generate one with:');
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
const { ensureColumns } = require('./utils/ensureColumns');
require('./models/associations'); // Import relationships

// Initialize express app
const app = express();

const { requestIdMiddleware, requestLogger, deepHealth } = require('./utils/observability');

// Trust Render's load balancer so req.protocol and secure cookies are
// reported correctly behind TLS termination.
app.set('trust proxy', 1);

// Request correlation + access logging run before everything else so every
// response (including helmet/CORS/429 rejections) carries an X-Request-Id
// header and gets exactly one access-log line. Both are pure no-ops on the
// body stream, so the rawBody verify hook and CORS/rate-limit ordering are
// untouched.
app.use(requestIdMiddleware);
app.use(requestLogger);

// Security headers (CSP disabled for the API server — the SPA sets its own).
app.use(helmet({ contentSecurityPolicy: false }));

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
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  credentials: true,
}));

// General rate limit — 100 requests / minute / IP.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
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

// Lightweight health probe for Render's health check. Deliberately has no
// DB dependency so the service is not killed during a slow DB connect.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`👉 Open http://localhost:${PORT} in your browser`);
  console.log(`==================================================\n`);

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
      ]);
      // Salon replies to customer reviews — TEXT is valid on both SQLite and
      // Postgres, so no dialect switch needed here. customerNote is the
      // customer's own free-text note on a booking (same TEXT reasoning).
      await ensureColumns(Appointment, 'Appointments', [
        { name: 'salonReply', typeSql: 'TEXT' },
        { name: 'customerNote', typeSql: 'TEXT' },
      ]);
      // Promo-code ledger columns on payments. originalAmount/discountAmount
      // preserve the pre-discount price and what the promo took off, while
      // orderAmount (and the Cashfree order) carry the discounted final.
      // customerNote is the carrier that threads the customer's booking note
      // from order creation to appointment finalization.
      await ensureColumns(Payment, 'payments', [
        { name: 'originalAmount', typeSql: 'DECIMAL(10,2)' },
        { name: 'discountAmount', typeSql: 'DECIMAL(10,2)' },
        { name: 'promoCodeApplied', typeSql: 'VARCHAR(64)' },
        { name: 'customerNote', typeSql: 'TEXT' },
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