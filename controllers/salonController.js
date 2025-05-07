const salonModel = require('../models/salonsModel');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const salonSignup = async (req, res) => {
    const { name, phoneNumber, email, password, address, pricing } = req.body;

    try {
        // Check if the salon already exists
        const existingSalonEmail = await salonModel.findOne({ where: { email } });
        const existingSalonNumber = await salonModel.findOne({ where: { phoneNumber } });
        if (existingSalonEmail || existingSalonNumber) {
            return res.status(409).json({ message: "Salon already exists" });
        }

        // Hash the password before storing it
        const hashedPassword = await bcrypt.hash(password, 10);
        const newSalon = await salonModel.create({ name, phoneNumber, email, password: hashedPassword, address, pricing });

        // Generate JWT token
        const token = jwt.sign({ salonId: newSalon.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(201).json({ message: "Salon created successfully", token });
    } catch (err) {
        console.error("Error during signup:", err);
        res.status(500).json({ message: "Internal server error" });
    }
}

const salonLogin = async (req, res) => {
    const { email, password } = req.body;

    try {
        const salon = await salonModel.findOne({ where: { email } });

        if (!salon) {
            return res.status(404).json({ error: "Salon not found" });
        }

        // Compare the hashed password
        const isMatch = await bcrypt.compare(password, salon.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Incorrect password" });
        }

        // Generate JWT token
        const token = jwt.sign({ salonId: salon.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({ message: "Salon logged in successfully", token });
    } catch (err) {
        console.error("Error logging in salon:", err);
        res.status(500).json({ error: "Internal server error" });
    }

}

module.exports = {
    salonSignup,
    salonLogin,
};