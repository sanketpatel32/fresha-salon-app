const staffModel = require("../models/staffModel")
require('dotenv').config()
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const appointmentModel = require("../models/appointmentModel")
const servicesModel = require('../models/servicesModel');
const userModel = require('../models/userModel')

const handleStaffLogin = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await staffModel.findOne({ where: { email } });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        
        // const isMatch = await bcrypt.compare(password, user.password);
        const isMatch = password === user.password
        if (!isMatch) {
            return res.status(401).json({ error: "Incorrect password" });
        }

        // Generate JWT token
        const token = jwt.sign({ staffId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

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
    const staffId = req.query.staffId;
    const appointments = await appointmentModel.findAll({
        where: { staffId },
        include: [
            { model: servicesModel, as: 'service', attributes: ['name'] },
            { model: userModel, as: 'user', attributes: ['name'] }
        ]
    });
    res.status(200).json(appointments);
};
module.exports = {
    handleStaffLogin,
    getAppointments
}