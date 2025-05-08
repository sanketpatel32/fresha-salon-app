const Salons = require('./salonsModel');
const Staff = require('./staffModel');
const Services = require('./servicesModel');
const StaffServices = require('./StaffServices');
const Appointment = require('./appointmentModel'); // Import the Appointment model

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
// Define One-to-Many Relationship between Salons and Appointments
Salons.hasMany(Appointment, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Appointment.belongsTo(Salons, { foreignKey: 'salonId', as: 'salon' }); // Alias as 'salon'

// Define One-to-Many Relationship between Services and Appointments
Services.hasMany(Appointment, { foreignKey: 'serviceId', onDelete: 'CASCADE' });
Appointment.belongsTo(Services, { foreignKey: 'serviceId' });

module.exports = { Salons, Staff, Services, StaffServices, Appointment };