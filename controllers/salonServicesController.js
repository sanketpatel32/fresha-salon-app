const servicesModel = require('../models/servicesModel');

const addService = async (req, res) => {
    try {
        const { name, price, duration } = req.body;
        const salonId = req.user.salonId; 
        console.log("Salon ID:", req.user.salonId); 
        if (!name || !price || !duration) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        // Create new service
        const newService = await servicesModel.create({
            name,
            price,
            duration,
            salonId
        });

        return res.status(201).json(newService);
    } catch (error) {
        console.error("Error in addService:", error);
        return res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    addService
};