# Fresha Salon App: Sample Data & Credentials

This project comes pre-seeded with premium mock data to help you test all the interactive dashboards and portals instantly out-of-the-box.

---

## 🔑 Login Portals & Accounts

Select a portal on the landing page and use the following pre-registered credentials:

### 👤 1. Customer Portal
Use these accounts to search for salons, choose booking dates/slots, assign therapists, checkout payments, and leave appointment feedback.
*   **Jane Doe** (Email: `jane@example.com` | Password: `customer123`)
*   **John Smith** (Email: `john@example.com` | Password: `customer123`)

### 💈 2. Partner Salon Owners
Use these accounts to manage catalog menu items, register/modify salon employees, adjust opening hours, track upcoming customer appointments, and log internal staff notes.
*   **Orchid Luxury Hair & Spa** (Email: `owner@orchid.com` | Password: `salon123` | *Premium pricing*)
*   **Aura Mens Grooming & Co** (Email: `owner@aura.com` | Password: `salon123` | *Moderate pricing*)
*   **Vibe Quick Cuts & Styles** (Email: `owner@vibe.com` | Password: `salon123` | *Affordable pricing*)

### ✂️ 3. Salon Staff (Therapists)
Use these accounts to inspect assigned duties, schedules, and check service logs.
*   **Dr. Sarah Jenkins** (Email: `sarah@orchid.com` | Password: `staff123` | *Assigned to Orchid Hair & Spa*)
*   **Marcus Aurelius** (Email: `marcus@orchid.com` | Password: `staff123` | *Assigned to Orchid Hair & Spa*)
*   **James Oliver** (Email: `james@aura.com` | Password: `staff123` | *Assigned to Aura Grooming*)
*   **Tina Miller** (Email: `tina@vibe.com` | Password: `staff123` | *Assigned to Vibe Cuts*)

---

## 🛠️ Seeding Script Logic

The seeding mechanism is built directly into [app.js](file:///C:/Users/sanpa/OneDrive/Desktop/Fun%20projects/Salon%20App/fresha-salon-app/app.js) and runs automatically during server synchronization if no salons exist in the database.

Here is the structured seed logic that populates your `database.sqlite` file:

```javascript
const seedSampleData = async () => {
  const { Salons, Staff, Services, User } = require('./models/associations');
  const bcrypt = require('bcrypt');

  try {
    const salonCount = await Salons.count();
    if (salonCount > 0) return; // Already populated, skipping.

    console.log('🌱 Database is empty. Seeding premium sample data...');

    // 1. Create Hashed Passwords
    const hashedCustomerPassword = await bcrypt.hash('customer123', 10);
    const hashedSalonPassword = await bcrypt.hash('salon123', 10);

    // 2. Insert Customers
    await User.create({ name: 'Jane Doe', email: 'jane@example.com', password: hashedCustomerPassword, phoneNumber: '9876543210' });
    await User.create({ name: 'John Smith', email: 'john@example.com', password: hashedCustomerPassword, phoneNumber: '8765432109' });

    // 3. Insert Partner Salons
    const salon1 = await Salons.create({ name: 'Orchid Luxury Hair & Spa', email: 'owner@orchid.com', password: hashedSalonPassword, phoneNumber: '9876543201', address: '102 Royal Boulevard', pricing: 'Premium', openingTime: '09:00', closingTime: '20:00', workingDays: 'Mon, Tue, Wed, Thu, Fri, Sat' });
    const salon2 = await Salons.create({ name: 'Aura Mens Grooming & Co', email: 'owner@aura.com', password: hashedSalonPassword, phoneNumber: '9876543202', address: '45 Metro Heights', pricing: 'Moderate', openingTime: '10:00', closingTime: '21:00', workingDays: 'Mon, Tue, Wed, Thu, Fri, Sat, Sun' });
    const salon3 = await Salons.create({ name: 'Vibe Quick Cuts & Styles', email: 'owner@vibe.com', password: hashedSalonPassword, phoneNumber: '9876543203', address: '88 University Avenue', pricing: 'Affordable', openingTime: '08:00', closingTime: '19:00', workingDays: 'Mon, Wed, Thu, Fri, Sat, Sun' });

    // 4. Insert Catalog Services
    const s1 = await Services.create({ name: 'Royal Keratin Hair Treatment', price: 2500, duration: 60, statusbar: 'active', salonId: salon1.id });
    const s2 = await Services.create({ name: 'Aromatherapy Full Body Massage', price: 3200, duration: 90, statusbar: 'active', salonId: salon1.id });
    const s3 = await Services.create({ name: 'Classic Hydrating Facial', price: 1800, duration: 45, statusbar: 'active', salonId: salon1.id });

    const s4 = await Services.create({ name: 'Signature Beard Trim & Steam Shave', price: 800, duration: 30, statusbar: 'active', salonId: salon2.id });
    const s5 = await Services.create({ name: 'Executive Hair Styling & Wash', price: 1200, duration: 45, statusbar: 'active', salonId: salon2.id });

    const s6 = await Services.create({ name: 'Express Dry Cut', price: 350, duration: 15, statusbar: 'active', salonId: salon3.id });
    const s7 = await Services.create({ name: 'Basic Head Massage & Wash', price: 250, duration: 15, statusbar: 'active', salonId: salon3.id });

    // 5. Insert Salon Staff
    const staff1 = await Staff.create({ name: 'Dr. Sarah Jenkins', phoneNumber: '9876543101', email: 'sarah@orchid.com', password: 'staff123', statusbar: 'active', salonId: salon1.id });
    const staff2 = await Staff.create({ name: 'Marcus Aurelius', phoneNumber: '9876543102', email: 'marcus@orchid.com', password: 'staff123', statusbar: 'active', salonId: salon1.id });
    const staff3 = await Staff.create({ name: 'James Oliver', phoneNumber: '9876543103', email: 'james@aura.com', password: 'staff123', statusbar: 'active', salonId: salon2.id });
    const staff4 = await Staff.create({ name: 'Tina Miller', phoneNumber: '9876543104', email: 'tina@vibe.com', password: 'staff123', statusbar: 'active', salonId: salon3.id });

    // 6. Assign Staff-Service Relationships
    await staff1.setServices([s1, s2, s3]);
    await staff2.setServices([s1, s3]);
    await staff3.setServices([s4, s5]);
    await staff4.setServices([s6, s7]);

    console.log('✅ Premium seed data loaded successfully!');
  } catch (error) {
    console.error('❌ Error during data seeding:', error);
  }
};
```
