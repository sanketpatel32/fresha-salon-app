const userModel = require('../models/userModel'); // Adjust the path as necessary
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const Sequelize = require('sequelize'); 

const handleUserSignup = async (req, res) => {
    const { name, email, password, phoneNumber } = req.body;

    try {
        // Check if the user already exists
        const existingUserEmail = await userModel.findOne({ where: { email } });
        const existingUserNumber = await userModel.findOne({ where: { phoneNumber } });
        if (existingUserEmail || existingUserNumber) {
            return res.status(409).json({ message: "User already exists" });
        }

        // Hash the password before storing it
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await userModel.create({ name, email, password: hashedPassword, phoneNumber });

        // Generate JWT token
        const token = jwt.sign({ userId: newUser.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(201).json({ 
            message: "User created successfully", 
            token, 
            userId: newUser.id 
        });
    } catch (err) {
        console.error("Error during signup:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};

const handleUserLogin = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await userModel.findOne({ where: { email } });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Compare the hashed password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Incorrect password" });
        }

        // Generate JWT token
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({ 
            message: "User logged in successfully", 
            token, 
            userId: user.id 
        });
    } catch (err) {
        console.error("Error logging in user:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

const searchUsers = async (req, res) => {
    const { query } = req.query; 

    try {
        
        const users = await userModel.findAll({
            where: {
                [Sequelize.Op.or]: [
                    { name: { [Sequelize.Op.like]: `%${query}%` } },
                    { email: { [Sequelize.Op.like]: `%${query}%` } },
                    { phoneNumber: { [Sequelize.Op.like]: `%${query}%` } },
                ],
            },
            attributes: ['id', 'name', 'email', 'phoneNumber'], 
        });

        res.status(200).json({ status: "Success", users });
    } catch (error) {
        console.error("Error searching for users:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
const getUserProfile = async (req, res) => {
    const userId = req.query.userId; 

    try {
        const user = await userModel.findOne({ where: { id: userId } });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        
        delete user.dataValues.password;

        res.status(200).json(user);
    } catch (error) {
        console.error("Error fetching user profile:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
const editProfile = async (req, res) => {
    const userId = req.query.userId; // Get the user ID from the JWT token
    const { name, email, phoneNumber } = req.body;

    try {
        const user = await userModel.findOne({ where: { id: userId } });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Update user details
        user.name = name;
        user.email = email;
        user.phoneNumber = phoneNumber;

        await user.save();

        res.status(200).json({ message: "Profile updated successfully", user });
    } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

module.exports = { handleUserLogin, handleUserSignup, searchUsers, getUserProfile, editProfile };