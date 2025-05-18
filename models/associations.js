const Salons = require('./salonsModel');
const Staff = require('./staffModel');
const Services = require('./servicesModel');
const StaffServices = require('./StaffServices');
const Appointment = require('./appointmentModel'); // Import the Appointment model
const User = require('./userModel'); // Import the User model
const Payment = require('./paymentModel'); // Import the Payment model

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

module.exports = { Salons, Staff, Services, StaffServices, Appointment, User, Payment };