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

const getStaff = async (req, res) => {
    try {
        const salonId = req.user.salonId; 
        // Check if the salon exists
        const salon = await salonModel.findByPk(salonId);
        if (!salon) {
            return res.status(404).json({ message: 'Salon not found' });
        }

        // Get all staff members for the salon
        const staffMembers = await staffModel.findAll({
            where: { salonId },
            attributes: ['id', 'name', 'phoneNumber', 'email', 'statusbar'], // Include only these fields
            include: [{ model: servicesModel, through: staffServicesModel }],
        });

        return res.status(200).json(staffMembers);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

const getStaffById = async (req, res) => {
    try {
        const staffId = req.query.staffid;

        // Fetch staff details along with assigned services
        const staff = await staffModel.findByPk(staffId, {
            attributes: ['id', 'name', 'phoneNumber', 'email', 'statusbar', 'salonId'],
            include: [
                {
                    model: servicesModel,
                    attributes: ['id', 'name'], // Include only service ID and name
                    through: { attributes: [] } // Exclude join table attributes
                }
            ]
        });

        if (!staff) {
            return res.status(404).json({ message: "Staff not found" });
        }

        res.status(200).json(staff);
    } catch (error) {
        console.error("Error fetching staff details:", error);
        res.status(500).json({ message: "Failed to fetch staff details" });
    }
};
const assignServices = async (req, res) => {
    try {
        const staffId = req.query.staffid;
        const { services } = req.body;

        if (!staffId) {
            return res.status(400).json({ message: "Staff ID is required" });
        }

        // Find the staff member
        const staff = await staffModel.findByPk(staffId);
        if (!staff) {
            return res.status(404).json({ message: "Staff not found" });
        }

        // Update assigned services (can handle empty array to remove all services)
        await staff.setServices(services || []); // Sequelize's `setServices` method

        res.status(200).json({ message: "Services assigned successfully" });
    } catch (error) {
        console.error("Error assigning services:", error);
        res.status(500).json({ message: "Failed to assign services" });
    }
};

const updateStatus = async (req, res) => {
    try {
        const { staffId, status } = req.body;

        if (!staffId || !status) {
            return res.status(400).json({ message: "Staff ID and status are required" });
        }

        const staff = await staffModel.findByPk(staffId);
        if (!staff) {
            return res.status(404).json({ message: "Staff not found" });
        }

        staff.statusbar = status; // Update the status
        await staff.save();

        res.status(200).json({ message: "Status updated successfully" });
    } catch (error) {
        console.error("Error updating status:", error);
        res.status(500).json({ message: "Failed to update status" });
    }
};
module.exports = {
    addStaff,
    getStaff,
    getStaffById,
    assignServices,
    updateStatus
};