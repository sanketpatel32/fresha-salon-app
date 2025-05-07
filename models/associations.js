const Salons = require('./salonsModel');
const Staff = require('./staffModel');
const Services = require('./servicesModel');
const StaffServices = require('./StaffServices');

// Define One-to-Many Relationship between Salons and Staff
Salons.hasMany(Staff, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Staff.belongsTo(Salons, { foreignKey: 'salonId' });

// Define One-to-Many Relationship between Salons and Services
Salons.hasMany(Services, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Services.belongsTo(Salons, { foreignKey: 'salonId' });

// Define Many-to-Many Relationship between Staff and Services
Staff.belongsToMany(Services, { through: StaffServices, foreignKey: 'staffId' });
Services.belongsToMany(Staff, { through: StaffServices, foreignKey: 'serviceId' });

module.exports = { Salons, Staff, Services, StaffServices };