const staffModel = require("../models/staffModel")
require('dotenv').config()
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const appointmentModel = require("../models/appointmentModel")
const servicesModel = require('../models/servicesModel');
const userModel = require('../models/userModel')

// Timing equalizer — same pattern/reasoning as userController's login.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const handleStaffLogin = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await staffModel.findOne({ where: { email } });

        // Identical status/message for unknown email vs wrong password —
        // the 404/401 split enumerated registered staff accounts.
        if (!user) {
            await bcrypt.compare(password, DUMMY_HASH);
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Generate JWT token
        const token = jwt.sign({ staffId: user.id, role: 'staff' }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({
            message: "Staff logged in successfully",
            token,
            staffId: user.id // Include userId in the response
        });
    } catch (err) {
        console.error("Error logging in user:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

const getAppointments = async (req, res) => {
    // Always scope to the authenticated staff member — never trust a query param.
    const staffId = req.user.staffId;
    try {
        const appointments = await appointmentModel.findAll({
            where: { staffId },
            include: [
                { model: servicesModel, as: 'service', attributes: ['name'] },
                { model: userModel, as: 'user', attributes: ['name', 'phoneNumber'] }
            ]
        });
        res.status(200).json(appointments);
    } catch (error) {
        console.error('Error fetching staff appointments:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Today's schedule for the logged-in staff member. DATEONLY columns round-trip
// as plain YYYY-MM-DD strings (SQLite), so the local calendar day is compared
// as a string — no timezone drift between write and read.
const getMyTodaySchedule = async (req, res) => {
    const staffId = req.user.staffId;
    try {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const appointments = await appointmentModel.findAll({
            where: { staffId, date: today },
            order: [['time', 'ASC']],
            include: [
                { model: servicesModel, as: 'service', attributes: ['name'] },
                { model: userModel, as: 'user', attributes: ['name', 'phoneNumber'] }
            ]
        });
        // Legacy bare-array response, same contract as getAppointments.
        res.status(200).json(appointments);
    } catch (error) {
        console.error('Error fetching staff today schedule:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    handleStaffLogin,
    getAppointments,
    getMyTodaySchedule
}