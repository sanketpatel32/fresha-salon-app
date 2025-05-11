require('dotenv').config();
const jwt = require('jsonwebtoken');
const appointmentModel = require('../models/appointmentModel');
const salonModel = require('../models/salonsModel');
const userModel = require('../models/userModel');
const servicesModel = require('../models/servicesModel');
const staffModel = require('../models/staffModel');
const { Op } = require('sequelize');
const adminlogin = async (req, res) => {
    console.log(req)
    const { email, password } = req.body;

    try {
        // Use environment variables for admin credentials
        if (
            email === process.env.ADMIN_USER &&
            password === process.env.ADMIN_PASS
        ) {
            // Generate JWT token
            const token = jwt.sign(
                { admin: email },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );
            return res.status(200).json({ message: "Admin logged in successfully", token });
        } else {
            return res.status(401).json({ error: "Invalid admin credentials" });
        }
    } catch (err) {
        console.error("Error logging in admin:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

const getAllAppointments = async (req, res) => {
    try {
        // Get current date and time in YYYY-MM-DD and HH:mm:ss format
        const now = new Date();
        const currentDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
        const currentTime = now.toTimeString().slice(0, 8); // HH:mm:ss

        const appointments = await appointmentModel.findAll({
            where: {
                [Op.or]: [
                    // Appointments after today
                    { date: { [Op.gt]: currentDate } },
                    // Appointments today but later than now
                    {
                        date: currentDate,
                        time: { [Op.gte]: currentTime }
                    }
                ]
            },
            include: [
                { model: salonModel, as: 'salon', attributes: ['name'] },
                { model: userModel, as: 'user', attributes: ['name', 'phoneNumber'] },
                { model: servicesModel, as: 'service', attributes: ['name', 'price'] },
                { model: staffModel, as: 'staff', attributes: ['name'] }
            ]
        });
        return res.status(200).json(appointments);
    } catch (error) {
        console.error("Error fetching appointments:", error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

const deleteAppointment = async (req, res) => {
    try {
        const appointmentId = req.params.id;

        // Check if the appointment exists
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        // Delete the appointment
        await appointment.destroy();

        return res.status(200).json({ message: 'Appointment deleted successfully' });
    } catch (error) {
        console.error("Error deleting appointment:", error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

const searchUsers = async (req, res) => {
    const { searchTerm } = req.query;

    try {
        const users = await userModel.findAll({
            where: {
                [Op.or]: [
                    { name: { [Op.like]: `%${searchTerm}%` } },
                    { email: { [Op.like]: `%${searchTerm}%` } },
                    { phoneNumber: { [Op.like]: `%${searchTerm}%` } }
                ]
            }
        });

        return res.status(200).json(users);
    } catch (error) {
        console.error("Error searching users:", error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

const deleteUser = async (req, res) => {
    const userId = req.params.id;

    try {
        // Check if the user exists
        const user = await userModel.findByPk(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Delete the user
        await user.destroy();

        return res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error("Error deleting user:", error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};
module.exports = {
    adminlogin,
    getAllAppointments,
    deleteAppointment,  
    searchUsers,
    deleteUser
};