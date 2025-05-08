const appointmentModel = require('../models/appointmentModel');
const staffModel = require('../models/staffModel'); // Assuming you have a staff model
const Services = require('../models/servicesModel'); // Assuming you have a service model
const Salons = require('../models/salonsModel'); // Assuming you have a salon model
const { Op } = require('sequelize');

const appointmentChecker = async (req, res) => {
    try {
        const { dateSelect, time, salonId, serviceId, duration } = req.body;

        // Calculate the end time of the appointment
        const startTime = time; // e.g., "11:00"
        const endTime = new Date(new Date(`1970-01-01T${time}`).getTime() + duration * 60 * 1000)
            .toTimeString()
            .slice(0, 5); // Format as HH:mm

        // Step 1: Get all staff who provide the specified service
        const staffForService = await staffModel.findAll({
            include: [
                {
                    model: Services,
                    as: 'services', // Use the alias defined in the association
                    where: { id: serviceId }, // Filter by serviceId
                    attributes: [], // Do not fetch unnecessary fields
                },
            ],
            where: { salonId }, // Filter by salonId
            attributes: ['id', 'name', 'phoneNumber'], // Fetch only the required fields
        });

        // Extract staff IDs
        const staffIds = staffForService.map((staff) => staff.id);

        // Step 2: Check for staff availability
        const unavailableStaff = await appointmentModel.findAll({
            where: {
                staffId: staffIds, // Filter by staff IDs
                salonId,
                date: dateSelect, // Check for the same date
                [Op.or]: [
                    {
                        time: {
                            [Op.lt]: endTime, // Start time overlaps
                        },
                        endTime: {
                            [Op.gt]: startTime, // End time overlaps
                        },
                    },
                ],
            },
            attributes: ['staffId'], // Only fetch staff IDs with appointments
        });

        // Step 3: Filter out unavailable staff
        const unavailableStaffIds = unavailableStaff.map((appointment) => appointment.staffId);
        const freeStaff = staffForService.filter(
            (staff) => !unavailableStaffIds.includes(staff.id)
        );

        // Respond with the available staff
        res.status(200).json(freeStaff);
    } catch (error) {
        console.error('Error in appointmentChecker:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
const getAllAppointmentsByUserId = async (req, res) => {
    const userId = req.user.userId; // Get userId from request parameters

    try {
        // Fetch all appointments for the given userId
        const appointments = await appointmentModel.findAll({
            where: { userId },
            include: [
                {
                    model: staffModel,
                    as: 'staff', // Use the alias defined in the association
                    attributes: ['name', 'phoneNumber'], // Include staff details
                },
                {
                    model: Services,
                    as: 'service', // Use the alias defined in the association
                    attributes: ['name'], // Include service details
                },
                {
                    model: Salons,
                    as: 'salon', // Use the alias defined in the association
                    attributes: ['name'], // Include salon name
                },
            ],
        });

        res.status(200).json(appointments);
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
module.exports = {
    appointmentChecker,
    getAllAppointmentsByUserId
};