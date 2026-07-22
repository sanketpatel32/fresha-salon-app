const appointmentModel = require('../models/appointmentModel');
const staffModel = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Salons = require('../models/salonsModel');
const userModel = require('../models/userModel');
const Payment = require('../models/paymentModel');
const StaffBlockout = require('../models/staffBlockoutModel');
const { Op } = require('sequelize');
const { canTransition, canCancel } = require('../utils/statusRules');

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

        // Calculate the end time of the appointment timezone-independently
        const startTime = time;
        const [hours, minutes] = time.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes + parseInt(duration);
        const endHours = Math.floor(totalMinutes / 60) % 24;
        const endMinutes = totalMinutes % 60;
        const endTime = `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;


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

        // Step 1.5: Exclude staff who have a blockout overlapping the requested slot.
        const blockedStaff = await StaffBlockout.findAll({
            where: {
                staffId: staffIds,
                date: dateSelect,
                startTime: { [Op.lt]: endTime },
                endTime: { [Op.gt]: startTime },
            },
            attributes: ['staffId'],
        });
        const blockedStaffIds = blockedStaff.map(b => b.staffId);
        const availableStaffAfterBlocks = staffForService.filter(
            (staff) => !blockedStaffIds.includes(staff.id)
        );

        // Step 2: Check for staff availability
        const unavailableStaff = await appointmentModel.findAll({
            where: {
                staffId: staffIds,
                salonId,
                date: dateSelect,
                status: { [Op.notIn]: ['cancelled', 'declined'] },
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
        const freeStaff = availableStaffAfterBlocks.filter(
            (staff) => !unavailableStaffIds.includes(staff.id)
        );

        res.status(200).json(freeStaff);
    } catch (error) {
        console.error('Error in appointmentChecker:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

const getAllAppointmentsByUserId = async (req, res) => {
    // Always scope to the authenticated customer — never trust a query param.
    const userId = req.user.userId;

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

        console.log("✅ Email sent:", response.messageId || '(no message id)');
        res.status(200).json({ message: "Email sent successfully" });
    } catch (error) {
        // Log the full error server-side only; return a generic message to the
        // client so Brevo's API response (which may include internal details)
        // never leaks out.
        console.error("❌ Error sending email:", error.response?.body || error.message);
        res.status(500).json({ error: "Failed to send email" });
    }
};

// Update user review (and optional 1-5 rating) for an appointment
const updateCustomerReview = async (req, res) => {
    const { appointmentId } = req.params;
    const { review, rating } = req.body;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: "Appointment not found" });
        }
        // Ownership: only the booking customer may review their own appointment.
        if (appointment.userId !== req.user.userId) {
            return res.status(403).json({ message: "Not authorized to review this appointment" });
        }
        appointment.userReview = review;
        if (rating !== undefined && rating !== null) {
            const r = parseInt(rating, 10);
            if (Number.isNaN(r) || r < 1 || r > 5) {
                return res.status(400).json({ message: "rating must be an integer between 1 and 5" });
            }
            appointment.rating = r;
        }
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
        // Authorization: caller must be either the salon owner of this salon,
        // or the staff member assigned to this appointment.
        if (req.user.salonId !== undefined && appointment.salonId !== req.user.salonId) {
            return res.status(403).json({ message: "Not authorized: appointment belongs to a different salon" });
        }
        if (req.user.staffId !== undefined && appointment.staffId !== req.user.staffId) {
            return res.status(403).json({ message: "Not authorized: this appointment is not assigned to you" });
        }
        appointment.staffReview = review;
        await appointment.save();
        res.status(200).json({ message: "Staff review submitted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

// Customer cancels their own appointment (must be >24h before start).
const cancelAppointment = async (req, res) => {
    const { appointmentId } = req.params;
    const userId = req.user.userId;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }
        // Ownership: only the booking customer may cancel.
        if (appointment.userId !== userId) {
            return res.status(403).json({ message: 'Not authorized to cancel this appointment' });
        }

        // Build the start Date from date + time fields (SQLite returns DATEONLY string + TIME string).
        const startAt = new Date(`${appointment.date}T${appointment.time}`);
        if (!canCancel(appointment.status, startAt)) {
            return res.status(400).json({ message: 'This appointment can no longer be cancelled (status or <24h window).' });
        }

        appointment.status = 'cancelled';
        await appointment.save();
        res.status(200).json({ message: 'Appointment cancelled successfully', appointment });
    } catch (error) {
        console.error('Error cancelling appointment:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Staff or salon owner updates an appointment's status
// (accept pending -> confirmed, decline pending -> declined, complete confirmed -> completed).
const updateAppointmentStatus = async (req, res) => {
    const { appointmentId } = req.params;
    const { status: newStatus } = req.body;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        // Authorization: caller must be either the salon owner of this salon, or a staff member of this salon.
        const salonId = req.user.salonId;
        const staffId = req.user.staffId;
        if (salonId === undefined && staffId === undefined) {
            return res.status(403).json({ message: 'Not authorized' });
        }
        if (salonId !== undefined && appointment.salonId !== salonId) {
            return res.status(403).json({ message: 'Not authorized: appointment belongs to a different salon' });
        }
        if (staffId !== undefined) {
            // Staff may only act on appointments assigned to themselves.
            if (appointment.staffId !== staffId) {
                return res.status(403).json({ message: 'Not authorized: this appointment is not assigned to you' });
            }
        }

        if (!canTransition(appointment.status, newStatus)) {
            return res.status(400).json({ message: `Cannot move appointment from '${appointment.status}' to '${newStatus}'` });
        }

        appointment.status = newStatus;
        await appointment.save();
        res.status(200).json({ message: `Appointment ${newStatus}`, appointment });
    } catch (error) {
        console.error('Error updating appointment status:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    appointmentChecker,
    getAllAppointmentsByUserId,
    getScheduledAppointmentsBySalonId,
    mailAppointment,
    updateCustomerReview,
    updateStaffReview,
    cancelAppointment,
    updateAppointmentStatus,
};