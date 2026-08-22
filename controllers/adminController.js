require('dotenv').config();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const appointmentModel = require('../models/appointmentModel');
const salonModel = require('../models/salonsModel');
const userModel = require('../models/userModel');
const servicesModel = require('../models/servicesModel');
const staffModel = require('../models/staffModel');
const paymentModel = require('../models/paymentModel');
const favoriteModel = require('../models/favoriteModel');
const { Op } = require('sequelize');
// Compare two strings in constant time. Plain === bails out at the first
// mismatching byte, leaking how much of the credential an attacker guessed.
// Hashing both sides first guarantees equal-length buffers (SHA-256 is always
// 32 bytes), which timingSafeEqual requires, without a leaky length pre-check.
const credentialsMatch = (provided, expected) => {
    const providedHash = crypto.createHash('sha256').update(String(provided ?? ''), 'utf8').digest();
    const expectedHash = crypto.createHash('sha256').update(String(expected ?? ''), 'utf8').digest();
    return crypto.timingSafeEqual(providedHash, expectedHash);
};

const adminlogin = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Use environment variables for admin credentials. Both comparisons
        // always run (no short-circuit) so response timing doesn't reveal
        // which field was wrong.
        const userOk = credentialsMatch(email, process.env.ADMIN_USER);
        const passOk = credentialsMatch(password, process.env.ADMIN_PASS);
        if (userOk && passOk) {
            // Generate JWT token
            const token = jwt.sign(
                { admin: email, role: 'admin' },
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
        // Escape SQL LIKE wildcards so a search for "%" or "_" matches literally
        // instead of every row. (Length/shape is already enforced by the route's
        // adminSearchSchema, but escaping is defense-in-depth.)
        const escaped = String(searchTerm).replace(/[%_\\]/g, '\\$&');
        const pattern = { [Op.like]: `%${escaped}%` };

        const users = await userModel.findAll({
            where: {
                [Op.or]: [
                    { name: pattern },
                    { email: pattern },
                    { phoneNumber: pattern }
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
    const sequelize = require('../utils/database');

    try {
        const user = await userModel.findByPk(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Cascade-delete the user's dependent rows explicitly, in a transaction.
        // We can't rely on ON DELETE CASCADE: SQLite has foreign keys disabled
        // by default (no PRAGMA foreign_keys=ON), so the association-level
        // onDelete:'CASCADE' is a no-op in dev. Doing it explicitly works on
        // both SQLite and Postgres.
        await sequelize.transaction(async (t) => {
            await appointmentModel.destroy({ where: { userId }, transaction: t });
            await paymentModel.destroy({ where: { customerID: userId }, transaction: t });
            await favoriteModel.destroy({ where: { userId }, transaction: t });
            await user.destroy({ transaction: t });
        });

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