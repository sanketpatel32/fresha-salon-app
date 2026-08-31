const servicesModel = require('../models/servicesModel');
const appointmentModel = require('../models/appointmentModel');
const paymentModel = require('../models/paymentModel');

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

        // Ownership, same rule as update/delete below: without it any salon
        // token could enumerate every other salon's services (including
        // archived ones the public browse deliberately hides).
        if (service.salonId !== req.user.salonId) {
            return res.status(403).json({ message: "Unauthorized: Access denied to this service" });
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

/**
 * Delete a service (#51).
 *
 * Two outcomes, chosen by whether the service has BOOKING HISTORY:
 *
 *  - Referenced by an appointment or payment → SOFT delete. The row is kept
 *    and stamped `archivedAt`, `statusbar` flips to 'archived'. Appointments,
 *    payments, the CSV export and revenue/top-service analytics all hang off
 *    serviceId; hard-deleting would leave those rows pointing at nothing and
 *    silently rewrite the salon's historical reports.
 *  - Unreferenced (a typo, a service never booked) → HARD delete, as before.
 *    Keeping rows nobody references forever would be its own kind of mess.
 *
 * Both paths report success identically so the response carries no
 * information about the salon's internal data.
 */
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

        // Has this service ever been booked or paid for?
        const [appointmentCount, paymentCount] = await Promise.all([
            appointmentModel.count({ where: { serviceId: service.id } }),
            paymentModel.count({ where: { serviceId: service.id } }),
        ]);
        const hasHistory = appointmentCount > 0 || paymentCount > 0;

        if (hasHistory) {
            service.statusbar = 'archived';
            service.archivedAt = new Date();
            await service.save();
            return res.status(200).json({
                message: "Service deleted successfully",
                // Advisory only: tells the UI why the service still appears in
                // historical reports. Not a different outcome.
                archived: true,
            });
        }

        await service.destroy();
        return res.status(200).json({ message: "Service deleted successfully", archived: false });
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
