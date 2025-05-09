const Salons = require('./salonsModel');
const Staff = require('./staffModel');
const Services = require('./servicesModel');
const StaffServices = require('./StaffServices');
const Appointment = require('./appointmentModel'); // Import the Appointment model
const User = require('./userModel'); // Import the User model
const Payment = require('./paymentModel'); // Import the Payment model

// Define One-to-Many Relationship between Salons and Staff
Salons.hasMany(Staff, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Staff.belongsTo(Salons, { foreignKey: 'salonId' });

// Define One-to-Many Relationship between Salons and Services
Salons.hasMany(Services, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Services.belongsTo(Salons, { foreignKey: 'salonId' });

// Define Many-to-Many Relationship between Staff and Services
Staff.belongsToMany(Services, { through: StaffServices, foreignKey: 'staffId' });
Services.belongsToMany(Staff, { through: StaffServices, foreignKey: 'serviceId' });

// Define One-to-Many Relationship between Staff and Appointments
Staff.hasMany(Appointment, { foreignKey: 'staffId', onDelete: 'CASCADE' });
Appointment.belongsTo(Staff, { foreignKey: 'staffId', as: 'staff' }); // Alias as 'staff'

// Define One-to-Many Relationship between Salons and Appointments
Salons.hasMany(Appointment, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Appointment.belongsTo(Salons, { foreignKey: 'salonId', as: 'salon' }); // Alias as 'salon'

// Define One-to-Many Relationship between Services and Appointments
Services.hasMany(Appointment, { foreignKey: 'serviceId', onDelete: 'CASCADE' });
Appointment.belongsTo(Services, { foreignKey: 'serviceId', as: 'service' }); // Alias as 'service'

// Define One-to-Many Relationship between Users and Appointments
User.hasMany(Appointment, { foreignKey: 'userId', onDelete: 'CASCADE' });
Appointment.belongsTo(User, { foreignKey: 'userId', as: 'user' }); // Alias as 'user'

// Define One-to-Many Relationship between Staff and Payments
Staff.hasMany(Payment, { foreignKey: 'staffId', onDelete: 'CASCADE' });
Payment.belongsTo(Staff, { foreignKey: 'staffId', as: 'staff' }); // Alias as 'staff'

// Define One-to-Many Relationship between Services and Payments
Services.hasMany(Payment, { foreignKey: 'serviceId', onDelete: 'CASCADE' });
Payment.belongsTo(Services, { foreignKey: 'serviceId', as: 'service' }); // Alias as 'service'

// Define One-to-Many Relationship between Salons and Payments
Salons.hasMany(Payment, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Payment.belongsTo(Salons, { foreignKey: 'salonId', as: 'salon' }); // Alias as 'salon'

// Define One-to-Many Relationship between Users and Payments
User.hasMany(Payment, { foreignKey: 'customerID', onDelete: 'CASCADE' });
Payment.belongsTo(User, { foreignKey: 'customerID', as: 'customer' }); // Alias as 'customer'

module.exports = { Salons, Staff, Services, StaffServices, Appointment, User, Payment };