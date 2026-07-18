// Import dependencies
const express = require('express');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

// Ensure a default secret is set if .env is missing
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'fresha_default_secret_key_12345';
}


// Import custom services and routes
const apiroutes = require('./routes/apiRoutes');
const indexRoutes = require('./routes/indexRoutes');
const sequelize = require('./utils/database');
require('./models/associations'); // Import relationships

// Initialize express app
const app = express();

// Trust Render's load balancer so req.protocol and secure cookies are
// reported correctly behind TLS termination.
app.set('trust proxy', 1);

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
// Reflect the request origin when credentials are involved so the
// same-origin SPA can call /api while keeping cookies/Authorization safe.
app.use(cors({ origin: true, credentials: true }));
// app.use('/',indexRoutes) // Disabled old html views
app.use('/api', apiroutes);

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

    // 3. Create Services
    const s1 = await Services.create({ name: 'Royal Keratin Hair Treatment', price: 2500, duration: 60, statusbar: 'active', salonId: salon1.id });
    const s2 = await Services.create({ name: 'Aromatherapy Full Body Massage', price: 3200, duration: 90, statusbar: 'active', salonId: salon1.id });
    const s3 = await Services.create({ name: 'Classic Hydrating Facial', price: 1800, duration: 45, statusbar: 'active', salonId: salon1.id });

    const s4 = await Services.create({ name: 'Signature Beard Trim & Steam Shave', price: 800, duration: 30, statusbar: 'active', salonId: salon2.id });
    const s5 = await Services.create({ name: 'Executive Hair Styling & Wash', price: 1200, duration: 45, statusbar: 'active', salonId: salon2.id });

    const s6 = await Services.create({ name: 'Express Dry Cut', price: 350, duration: 15, statusbar: 'active', salonId: salon3.id });
    const s7 = await Services.create({ name: 'Basic Head Massage & Wash', price: 250, duration: 15, statusbar: 'active', salonId: salon3.id });

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
      await seedSampleData();
    })
    .catch((err) => {
      console.log('⚠️ Database connection failed. Make sure MySQL is running.');
      console.error('Error message:', err.message);
    });
});