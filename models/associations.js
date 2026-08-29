const Salons = require('./salonsModel');
const Staff = require('./staffModel');
const Services = require('./servicesModel');
const StaffServices = require('./StaffServices');
const Appointment = require('./appointmentModel'); // Import the Appointment model
const User = require('./userModel'); // Import the User model
const Payment = require('./paymentModel'); // Import the Payment model
const Favorite = require('./favoriteModel');
const FavoriteStaff = require('./favoriteStaffModel');
const StaffBlockout = require('./staffBlockoutModel');
// Promo codes are a standalone table (lookups are by `code`, ownership by the
// plain salonId column) — exported plainly, no associations needed.
const PromoCode = require('./promoCodeModel');

// ==================== SALON RELATIONS ====================
// Salons <-> Staff (One-to-Many)
Salons.hasMany(Staff, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Staff.belongsTo(Salons, { foreignKey: 'salonId' });

// Salons <-> Services (One-to-Many)
Salons.hasMany(Services, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Services.belongsTo(Salons, { foreignKey: 'salonId' });

// Salons <-> Appointments (One-to-Many)
Salons.hasMany(Appointment, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Appointment.belongsTo(Salons, { foreignKey: 'salonId', as: 'salon' }); // Alias as 'salon'

// Salons <-> Payments (One-to-Many)
Salons.hasMany(Payment, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Payment.belongsTo(Salons, { foreignKey: 'salonId', as: 'salon' }); // Alias as 'salon'

// ==================== STAFF RELATIONS ====================
// Staff <-> Services (Many-to-Many)
Staff.belongsToMany(Services, { through: StaffServices, foreignKey: 'staffId' });
Services.belongsToMany(Staff, { through: StaffServices, foreignKey: 'serviceId' });

// Staff <-> Appointments (One-to-Many)
Staff.hasMany(Appointment, { foreignKey: 'staffId', onDelete: 'CASCADE' });
Appointment.belongsTo(Staff, { foreignKey: 'staffId', as: 'staff' }); // Alias as 'staff'

// Staff <-> Payments (One-to-Many)
Staff.hasMany(Payment, { foreignKey: 'staffId', onDelete: 'CASCADE' });
Payment.belongsTo(Staff, { foreignKey: 'staffId', as: 'staff' }); // Alias as 'staff'

// ==================== SERVICES RELATIONS ====================
// Services <-> Appointments (One-to-Many)
Services.hasMany(Appointment, { foreignKey: 'serviceId', onDelete: 'CASCADE' });
Appointment.belongsTo(Services, { foreignKey: 'serviceId', as: 'service' }); // Alias as 'service'

// Services <-> Payments (One-to-Many)
Services.hasMany(Payment, { foreignKey: 'serviceId', onDelete: 'CASCADE' });
Payment.belongsTo(Services, { foreignKey: 'serviceId', as: 'service' }); // Alias as 'service'

// ==================== USER RELATIONS ====================
// Users <-> Appointments (One-to-Many)
User.hasMany(Appointment, { foreignKey: 'userId', onDelete: 'CASCADE' });
Appointment.belongsTo(User, { foreignKey: 'userId', as: 'user' }); // Alias as 'user'

// Users <-> Payments (One-to-Many)
User.hasMany(Payment, { foreignKey: 'customerID', onDelete: 'CASCADE' });
Payment.belongsTo(User, { foreignKey: 'customerID', as: 'customer' }); // Alias as 'customer'

// ==================== FAVORITES ====================
User.hasMany(Favorite, { foreignKey: 'userId', onDelete: 'CASCADE' });
Favorite.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Salons.hasMany(Favorite, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Favorite.belongsTo(Salons, { foreignKey: 'salonId', as: 'salon' });

// ==================== FAVORITE STAFF (#59) ====================
// These edges are NOT cosmetic. FavoriteStaff declares its foreign keys as raw
// `references:` on the columns, and Sequelize's dependency sort — the thing
// that decides what order tables are created and dropped in — only sees
// associations, not attribute-level references. With two parents (users +
// staffs) and no edges here, `sync({ force: true })` dropped `users` first,
// and SQLite's cascading delete into favoriteStaffs then had to resolve a
// parent that was already gone: "no such table: main.users", thrown from an
// unrelated DROP TABLE, in whichever test file happened to load first.
// Declaring both sides is what `Favorite` above has always done.
User.hasMany(FavoriteStaff, { foreignKey: 'userId', onDelete: 'CASCADE' });
FavoriteStaff.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Staff.hasMany(FavoriteStaff, { foreignKey: 'staffId', onDelete: 'CASCADE' });
FavoriteStaff.belongsTo(Staff, { foreignKey: 'staffId', as: 'staffMember' });

// ==================== STAFF BLOCKOUTS ====================
Staff.hasMany(StaffBlockout, { foreignKey: 'staffId', onDelete: 'CASCADE' });
StaffBlockout.belongsTo(Staff, { foreignKey: 'staffId', as: 'staff' });

// ==================== PAYMENT <-> APPOINTMENT ====================
// A payment success creates exactly one appointment; the orderId link makes the
// creation idempotent (replaying the payment success won't duplicate the booking).
Payment.hasOne(Appointment, { foreignKey: 'orderId', sourceKey: 'orderId', as: 'appointment' });
Appointment.belongsTo(Payment, { foreignKey: 'orderId', targetKey: 'orderId', as: 'payment', constraints: false });

module.exports = { Salons, Staff, Services, StaffServices, Appointment, User, Payment, Favorite, FavoriteStaff, StaffBlockout, PromoCode };