const staffModel = require('../models/staffModel');
const salonModel = require('../models/salonsModel');
const servicesModel = require('../models/servicesModel');
const staffServicesModel = require('../models/StaffServices');

const addStaff = async (req, res) => {
    try {
        const { name, phoneNumber, email, password} = req.body;
        const salonId = req.user.salonId; 
        // Check if the salon exists
        const salon = await salonModel.findByPk(salonId);
        if (!salon) {
            return res.status(404).json({ message: 'Salon not found' });
        }

        // Create the staff member
        const staff = await staffModel.create({
            name,
            phoneNumber,
            email,
            password,
            salonId,
        });

        return res.status(201).json({ message: 'Staff member added successfully', staff });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports = {
    addStaff,
};