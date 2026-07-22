const servicesModel = require('../models/servicesModel');

const addService = async (req, res) => {
    try {
        const { name, price, duration, category } = req.body;
        const salonId = req.user.salonId;
        if (!name || !price || !duration) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        // Create new service
        const newService = await servicesModel.create({
            name,
            category: category || 'Other',
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


        const services = await servicesModel.findAll({
            where: {
                salonId,
                statusbar: "active" 
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
        const { name, price, duration, statusbar, category } = req.body;
        const salonId = req.user.salonId;

        const service = await servicesModel.findOne({ where: { id } });

        if (!service) {
            return res.status(404).json({ message: "Service not found" });
        }

        if (service.salonId !== salonId) {
            return res.status(403).json({ message: "Unauthorized: Access denied to modify this service" });
        }

        if (name !== undefined) service.name = name;
        if (price !== undefined) service.price = price;
        if (duration !== undefined) service.duration = duration;
        if (statusbar !== undefined) service.statusbar = statusbar;
        if (category !== undefined) service.category = category;

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
        const salonId = req.user.salonId;
        const service = await servicesModel.findOne({ where: { id } });

        if (!service) {
            return res.status(404).json({ message: "Service not found" });
        }

        if (service.salonId !== salonId) {
            return res.status(403).json({ message: "Unauthorized: Access denied to delete this service" });
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
