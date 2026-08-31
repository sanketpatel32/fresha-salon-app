const staffModel = require('../models/staffModel');
const bcrypt = require('bcrypt');
const salonModel = require('../models/salonsModel');
const servicesModel = require('../models/servicesModel');
const staffServicesModel = require('../models/StaffServices');
const StaffBlockout = require('../models/staffBlockoutModel');

const addStaff = async (req, res) => {
    try {
        const { name, phoneNumber, email, password} = req.body;
        const salonId = req.user.salonId; 
        // Check if the salon exists
        const salon = await salonModel.findByPk(salonId);
        if (!salon) {
            return res.status(404).json({ message: 'Salon not found' });
        }

        // Create the staff member (password hashed with bcrypt)
        const hashedPassword = await bcrypt.hash(password, 10);
        const staff = await staffModel.create({
            name,
            phoneNumber,
            email,
            password: hashedPassword,
            salonId,
        });

        // Never serialize the raw instance — it carries the bcrypt password
        // hash (the read path below already restricts attributes).
        delete staff.dataValues.password;
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
        const salonId = req.user.salonId;

        // Fetch staff details along with assigned services
        const staff = await staffModel.findByPk(staffId, {
            attributes: ['id', 'name', 'phoneNumber', 'email', 'statusbar', 'salonId'],
            include: [
                {
                    model: servicesModel,
                    attributes: ['id', 'name'], 
                }
            ]
        });

        if (!staff) {
            return res.status(404).json({ message: "Staff not found" });
        }

        if (staff.salonId !== salonId) {
            return res.status(403).json({ message: "Unauthorized: Access denied to this staff profile" });
        }

        res.status(200).json(staff);
    } catch (error) {
        console.error("Error fetching staff details:", error);
        res.status(500).json({ message: "Failed to fetch staff details" });
    }
};
const assignServices = async (req, res) => {
    try {
        // staffId comes from the validated BODY (staffAssignServicesSchema).
        // It previously read req.query.staffid while the schema validated the
        // body — the two never agreed, so every HTTP call 400'd and salons
        // could not assign services to staff at all.
        const { staffId, services } = req.body;
        const salonId = req.user.salonId;

        if (!staffId) {
            return res.status(400).json({ message: "Staff ID is required" });
        }

        // Find the staff member
        const staff = await staffModel.findByPk(staffId);
        if (!staff) {
            return res.status(404).json({ message: "Staff not found" });
        }

        if (staff.salonId !== salonId) {
            return res.status(403).json({ message: "Unauthorized: Access denied to modify this staff services" });
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
        const salonId = req.user.salonId;

        if (!staffId || !status) {
            return res.status(400).json({ message: "Staff ID and status are required" });
        }

        const staff = await staffModel.findByPk(staffId);
        if (!staff) {
            return res.status(404).json({ message: "Staff not found" });
        }

        if (staff.salonId !== salonId) {
            return res.status(403).json({ message: "Unauthorized: Access denied to modify this staff member status" });
        }

        staff.statusbar = status; // Update the status
        await staff.save();

        res.status(200).json({ message: "Status updated successfully" });
    } catch (error) {
        console.error("Error updating status:", error);
        res.status(500).json({ message: "Failed to update status" });
    }
};
// Salon owner adds a blockout (staff unavailable for a date + time range).
const addBlockout = async (req, res) => {
    try {
        const { staffId, date, startTime, endTime, reason } = req.body;
        const salonId = req.user.salonId;

        if (!staffId || !date || !startTime || !endTime) {
            return res.status(400).json({ message: 'staffId, date, startTime, endTime are required' });
        }

        const staff = await staffModel.findByPk(staffId);
        if (!staff) {
            return res.status(404).json({ message: 'Staff not found' });
        }
        if (staff.salonId !== salonId) {
            return res.status(403).json({ message: 'Not authorized: staff belongs to another salon' });
        }

        const blockout = await StaffBlockout.create({ staffId, date, startTime, endTime, reason: reason || null });
        return res.status(201).json({ message: 'Blockout added successfully', blockout });
    } catch (error) {
        console.error('Error adding blockout:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// List blockouts for the salon owner's salon (optionally filtered by staffId).
const getBlockouts = async (req, res) => {
    try {
        const salonId = req.user.salonId;
        const { staffId } = req.query;

        const staffMembers = await staffModel.findAll({
            where: { salonId },
            attributes: ['id'],
        });
        const staffIds = staffMembers.map(s => s.id);
        if (staffIds.length === 0) return res.status(200).json([]);

        const where = { staffId: staffIds };
        if (staffId) where.staffId = parseInt(staffId, 10);

        const blockouts = await StaffBlockout.findAll({
            where,
            include: [{ model: staffModel, as: 'staff', attributes: ['id', 'name'] }],
            order: [['date', 'ASC'], ['startTime', 'ASC']],
        });
        return res.status(200).json(blockouts);
    } catch (error) {
        console.error('Error fetching blockouts:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// Remove a blockout by id (owner only — must belong to a staff in their salon).
const removeBlockout = async (req, res) => {
    try {
        const { id } = req.params;
        const salonId = req.user.salonId;

        const blockout = await StaffBlockout.findByPk(id, {
            include: [{ model: staffModel, as: 'staff' }],
        });
        if (!blockout) {
            return res.status(404).json({ message: 'Blockout not found' });
        }
        if (!blockout.staff || blockout.staff.salonId !== salonId) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        await blockout.destroy();
        return res.status(200).json({ message: 'Blockout removed successfully' });
    } catch (error) {
        console.error('Error removing blockout:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports = {
    addStaff,
    getStaff,
    getStaffById,
    assignServices,
    updateStatus,
    addBlockout,
    getBlockouts,
    removeBlockout,
};