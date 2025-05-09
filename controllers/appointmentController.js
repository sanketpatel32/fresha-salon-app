const appointmentModel = require('../models/appointmentModel');
const staffModel = require('../models/staffModel'); // Assuming you have a staff model
const Services = require('../models/servicesModel'); // Assuming you have a service model
const Salons = require('../models/salonsModel'); // Assuming you have a salon model
const userModel = require('../models/userModel'); // Assuming you have a user model
const Payment = require('../models/paymentModel'); // Assuming you have a payment model
const { Op } = require('sequelize');

const { v4: uuidv4 } = require('uuid');
const Sib = require('sib-api-v3-sdk');
require('dotenv').config();

const client = Sib.ApiClient.instance;
const apiKey = client.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const tranEmailApi = new Sib.TransactionalEmailsApi();
const sender = {
    email: process.env.SENDER_EMAIL,
    name: 'Tech Support by Sanket'
};

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
    const userId = req.query.userId; // Get userId from request parameters

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

const getScheduledAppointmentsBySalonId = async (req, res) => {
    const salonId = req.user.salonId; // Get salonId from request parameters
    try {
        // Fetch all appointments for the given salonId
        const appointments = await appointmentModel.findAll({
            where: { salonId },
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
                {
                    model: userModel,
                    as: 'user', // Use the alias defined in the association
                    attributes: ['name', 'phoneNumber'], // Include user details
                },
            ],
        });

        res.status(200).json(appointments);
    } catch (error) {
        console.error('Error fetching scheduled appointments:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

const mailAppointment = async (req, res) => {
    const { orderId } = req.body;

    try {
        // Fetch the order details using the orderId
        const order = await Payment.findOne({
            where: { orderId },
            include: [
                {
                    model: staffModel,
                    as: 'staff', // Use the alias defined in the association
                    attributes: ['name', 'phoneNumber'],
                },
                {
                    model: Services,
                    as: 'service', // Use the alias defined in the association
                    attributes: ['name'],
                },
                {
                    model: Salons,
                    as: 'salon', // Use the alias defined in the association
                    attributes: ['name'],
                },
            ],
        });

        if (!order) {
            return res.status(404).json({ message: "Order not found" });
        }

        // Fetch the customer details using the customerID from the order
        const customer = await userModel.findOne({ where: { id: order.customerID } });

        if (!customer) {
            return res.status(404).json({ message: "Customer not found" });
        }

        // Prepare email content
        const toEmail = customer.email;
        const subject = "Your Appointment Details";
        const textContent = `
            Dear ${customer.name},

            Thank you for booking with us! Here are your appointment details:

            - Appointment Date: ${order.dateSelected}
            - Appointment Time: ${order.timeSelected} - ${order.endTime}
            - Service: ${order.service.name}
            - Staff: ${order.staff.name} (${order.staff.phoneNumber})
            - Salon: ${order.salon.name}
            - Amount Paid: ₹${order.orderAmount}

            We look forward to serving you!

            Best regards,
            Fresha Team
        `;

        const htmlContent = `
            <p>Dear ${customer.name},</p>
            <p>Thank you for booking with us! Here are your appointment details:</p>
            <ul>
                <li><strong>Appointment Date:</strong> ${order.dateSelected}</li>
                <li><strong>Appointment Time:</strong> ${order.timeSelected} - ${order.endTime}</li>
                <li><strong>Service:</strong> ${order.service.name}</li>
                <li><strong>Staff:</strong> ${order.staff.name} (${order.staff.phoneNumber})</li>
                <li><strong>Salon:</strong> ${order.salon.name}</li>
                <li><strong>Amount Paid:</strong> ₹${order.orderAmount}</li>
            </ul>
            <p>We look forward to serving you!</p>
            <p>Best regards,<br>Fresha Team</p>
        `;

        // Send the email using Brevo (Sendinblue)
        const response = await tranEmailApi.sendTransacEmail({
            sender,
            to: [{ email: toEmail }],
            subject,
            textContent,
            htmlContent,
        });

        console.log("✅ Email sent:", response.messageId || response);
        res.status(200).json({ message: "Email sent successfully", data: response });
    } catch (error) {
        console.error("❌ Error sending email:", error.response?.body || error.message);
        res.status(500).json({ error: "Failed to send email", details: error.response?.body });
    }
};

module.exports = {
    appointmentChecker,
    getAllAppointmentsByUserId,
    getScheduledAppointmentsBySalonId,
    mailAppointment,
};