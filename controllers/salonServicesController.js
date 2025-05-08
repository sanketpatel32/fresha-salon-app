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

const getAllServices = async (req, res) => {
    try {
        const salonId = req.user.salonId; 
        // Use findAll to fetch all services for the given salonId
        const services = await servicesModel.findAll({
            where: { salonId } // Filter by salonId
        });

        return res.status(200).json(services);
    } catch (error) {
        console.error("Error in getAllServices:", error);
        return res.status(500).json({ message: 'Server error' });
    }
};

const getAllActiveServicesBySalonId = async (req, res) => {
    try {
        const salonId = req.query.salonId // Get the salon ID from the request

        // Fetch all active services for the given salon ID
        const services = await servicesModel.findAll({
            where: {
                salonId,
                statusbar: "active" // Filter for services with status "active"
            }
        });

        return res.status(200).json(services);
    } catch (error) {
        console.error("Error in getAllActiveServicesBySalonId:", error);
        return res.status(500).json({ message: 'Server error' });
    }
};

const getServiceById = async (req, res) => {
    try {
        const { id } = req.params; // Extract service ID from the URL
        const service = await servicesModel.findOne({ where: { id } });

        if (!service) {
            return res.status(404).json({ message: "Service not found" });
        }

        return res.status(200).json(service);
    } catch (error) {
        console.error("Error in getServiceById:", error);
        return res.status(500).json({ message: "Server error" });
    }
};


const updateService = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, duration, statusbar } = req.body;

        const service = await servicesModel.findOne({ where: { id } });

        if (!service) {
            return res.status(404).json({ message: "Service not found" });
        }

        service.name = name;
        service.price = price;
        service.duration = duration;
        service.statusbar = statusbar;

        await service.save();

        return res.status(200).json({ message: "Service updated successfully", service });
    } catch (error) {
        console.error("Error in updateService:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

const deleteService = async (req, res) => {
    try {
        const { id } = req.params;
        const service = await servicesModel.findOne({ where: { id } });

        if (!service) {
            return res.status(404).json({ message: "Service not found" });
        }

        await service.destroy();

        return res.status(200).json({ message: "Service deleted successfully" });
    } catch (error) {
        console.error("Error in deleteService:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

module.exports = {
    addService,
    getAllServices,
    getServiceById,
    updateService,
    deleteService,
    getAllActiveServicesBySalonId
};
