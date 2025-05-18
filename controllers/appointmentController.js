const appointmentModel = require('../models/appointmentModel');
const staffModel = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Salons = require('../models/salonsModel');
const userModel = require('../models/userModel');
const Payment = require('../models/paymentModel');
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

// Checks staff availability for a given service, date, and time
const appointmentChecker = async (req, res) => {
    try {
        const { dateSelect, time, salonId, serviceId, duration } = req.body;

        // Calculate the end time of the appointment
        const startTime = time;
        const endTime = new Date(new Date(`1970-01-01T${time}`).getTime() + duration * 60 * 1000)
            .toTimeString()
            .slice(0, 5);

        // Step 1: Get all staff who provide the specified service
        const staffForService = await staffModel.findAll({
            include: [
                {
                    model: Services,
                    as: 'services',
                    where: { id: serviceId },
                    attributes: [],
                },
            ],
            where: { salonId },
            attributes: ['id', 'name', 'phoneNumber'],
        });

        // Extract staff IDs
        const staffIds = staffForService.map((staff) => staff.id);

        // Step 2: Check for staff availability
        const unavailableStaff = await appointmentModel.findAll({
            where: {
                staffId: staffIds,
                salonId,
                date: dateSelect,
                [Op.or]: [
                    {
                        time: {
                            [Op.lt]: endTime,
                        },
                        endTime: {
                            [Op.gt]: startTime,
                        },
                    },
                ],
            },
            attributes: ['staffId'],
        });

        // Step 3: Filter out unavailable staff
        const unavailableStaffIds = unavailableStaff.map((appointment) => appointment.staffId);
        const freeStaff = staffForService.filter(
            (staff) => !unavailableStaffIds.includes(staff.id)
        );

        res.status(200).json(freeStaff);
    } catch (error) {
        console.error('Error in appointmentChecker:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

const getAllAppointmentsByUserId = async (req, res) => {
    const userId = req.query.userId;

    try {
        const appointments = await appointmentModel.findAll({
            where: { userId },
            include: [
                {
                    model: staffModel,
                    as: 'staff',
                    attributes: ['name', 'phoneNumber'],
                },
                {
                    model: Services,
                    as: 'service',
                    attributes: ['name'],
                },
                {
                    model: Salons,
                    as: 'salon',
                    attributes: ['name'],
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
    const salonId = req.user.salonId;
    try {
        const appointments = await appointmentModel.findAll({
            where: { salonId },
            include: [
                {
                    model: staffModel,
                    as: 'staff',
                    attributes: ['name', 'phoneNumber'],
                },
                {
                    model: Services,
                    as: 'service',
                    attributes: ['name'],
                },
                {
                    model: Salons,
                    as: 'salon',
                    attributes: ['name'],
                },
                {
                    model: userModel,
                    as: 'user',
                    attributes: ['name', 'phoneNumber'],
                },
            ],
        });

        res.status(200).json(appointments);
    } catch (error) {
        console.error('Error fetching scheduled appointments:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Sends appointment details to the customer via email
const mailAppointment = async (req, res) => {
    const { orderId } = req.body;

    try {
        const order = await Payment.findOne({
            where: { orderId },
            include: [
                {
                    model: staffModel,
                    as: 'staff',
                    attributes: ['name', 'phoneNumber'],
                },
                {
                    model: Services,
                    as: 'service',
                    attributes: ['name'],
                },
                {
                    model: Salons,
                    as: 'salon',
                    attributes: ['name'],
                },
            ],
        });

        if (!order) {
            return res.status(404).json({ message: "Order not found" });
        }

        const customer = await userModel.findOne({ where: { id: order.customerID } });

        if (!customer) {
            return res.status(404).json({ message: "Customer not found" });
        }

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

// Update user review for an appointment
const updateCustomerReview = async (req, res) => {
    const { appointmentId } = req.params;
    const { review } = req.body;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: "Appointment not found" });
        }
        appointment.userReview = review;
        await appointment.save();
        res.status(200).json({ message: "Review submitted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

// Update staff review for an appointment
const updateStaffReview = async (req, res) => {
    const { appointmentId } = req.params;
    const { review } = req.body;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: "Appointment not found" });
        }
        appointment.staffReview = review;
        await appointment.save();
        res.status(200).json({ message: "Staff review submitted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

module.exports = {
    appointmentChecker,
    getAllAppointmentsByUserId,
    getScheduledAppointmentsBySalonId,
    mailAppointment,
    updateCustomerReview,
    updateStaffReview,
};