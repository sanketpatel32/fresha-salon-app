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
const getAllSalons = async (req, res) => {
    try {
        const salons = await salonModel.findAll();
        if (!salons || salons.length === 0) {
            return res.status(404).json({ message: "No salons found" });
        }
        // Exclude sensitive information like password from the response
        salons.forEach(salon => {
            delete salon.dataValues.password;
            delete salon.dataValues.createdAt;
            delete salon.dataValues.updatedAt;
        });
        res.status(200).json(salons);
    } catch (err) {
        console.error("Error fetching salons:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}
const getSalonById = async (req, res) => {
    const salonId  = req.query.salonId ;
    // console.log("Salon ID:", salonId); 
    try {
        const salon = await salonModel.findOne({ where: { id: salonId } });
        if (!salon) {
            return res.status(404).json({ message: "Salon not found" });
        }
        delete salon.dataValues.password;
        delete salon.dataValues.createdAt;
        delete salon.dataValues.updatedAt;
        res.status(200).json(salon);
    } catch (err) {
        console.error("Error fetching salon:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}

const getSalonBySalonId = async (req, res) => {
    const salonId  = req.user.salonId ;

    try {
        const salon = await salonModel.findOne({ where: { id: salonId } });
        if (!salon) {
            return res.status(404).json({ message: "Salon not found" });
        }
        // Exclude sensitive information like password from the response
        delete salon.dataValues.password;
        delete salon.dataValues.createdAt;
        delete salon.dataValues.updatedAt;
        res.status(200).json(salon);
    } catch (err) {
        console.error("Error fetching salon:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}
const updateSalonDetails = async (req, res) => {
    const { salonId, name, phoneNumber, address, workingDays, openingTime, closingTime } = req.body;

    try {
        // Find the salon by ID
        const salon = await salonModel.findOne({ where: { id: salonId } });
        if (!salon) {
            return res.status(404).json({ message: "Salon not found" });
        }

        // Update the salon details
        await salon.update({
            name,
            phoneNumber,
            address,
            workingDays,
            openingTime,
            closingTime
        });

        res.status(200).json({ message: "Salon details updated successfully" });
    } catch (err) {
        console.error("Error updating salon details:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}


module.exports = {
    salonSignup,
    salonLogin,
    getAllSalons,
    getSalonById,
    getSalonBySalonId,
    updateSalonDetails
};