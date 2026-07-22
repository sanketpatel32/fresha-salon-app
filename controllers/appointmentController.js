const appointmentModel = require('../models/appointmentModel');
const staffModel = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Salons = require('../models/salonsModel');
const userModel = require('../models/userModel');
const Payment = require('../models/paymentModel');
const StaffBlockout = require('../models/staffBlockoutModel');
const { Op } = require('sequelize');
const { canTransition, canCancel } = require('../utils/statusRules');
const sequelize = require('../utils/database');
const {
  computeEndTime,
  validateSalonHours,
  staffForService,
  conflictingStaffIds,
} = require('../services/availabilityService');

/**
 * Recompute and persist the denormalized avgRating + reviewCount for a salon.
 * Called after a customer review is written/edited so the browse endpoint's
 * rating filter/sort stays correct without a live aggregation on every request.
 */
const refreshSalonRatingCache = async (salonId) => {
    if (!salonId) return;
    const rows = await appointmentModel.findAll({
        where: { salonId, rating: { [Op.ne]: null } },
        attributes: [
            [sequelize.fn('AVG', sequelize.col('rating')), 'avgRating'],
            [sequelize.fn('COUNT', sequelize.col('rating')), 'reviewCount'],
        ],
        raw: true,
    });
    const agg = rows[0];
    await Salons.update(
        {
            avgRating: agg && agg.avgRating ? parseFloat(agg.avgRating).toFixed(2) : null,
            reviewCount: agg && agg.reviewCount ? parseInt(agg.reviewCount, 10) : 0,
        },
        { where: { id: salonId } }
    );
};

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

// Checks staff availability for a given service, date, and time.
// Enforces salon working hours/days AND staff conflicts. The conflict
// detection logic lives in services/availabilityService.js and is shared with
// the payment finalization path so the rule cannot drift between them.
const appointmentChecker = async (req, res) => {
    try {
        const { dateSelect, time, salonId, serviceId, duration } = req.body;

        const startTime = time;
        const endTime = computeEndTime(time, duration);

        // Salon-hours gate. The model stores openingTime/closingTime/workingDays;
        // before this change they were display-only and never consulted.
        const salon = await Salons.findByPk(salonId);
        if (!salon) {
            return res.status(404).json({ message: 'Salon not found' });
        }
        const hoursCheck = validateSalonHours(salon, dateSelect, startTime, endTime);
        if (!hoursCheck.ok) {
            return res.status(400).json({ message: hoursCheck.reason });
        }

        // Staff who provide this service in this salon.
        const eligibleStaff = await staffForService(salonId, serviceId);
        const staffIds = eligibleStaff.map((s) => s.id);

        // Filter out staff with a blockout or existing booking that overlaps.
        const conflicted = await conflictingStaffIds(staffIds, salonId, dateSelect, startTime, endTime);
        const freeStaff = eligibleStaff.filter((s) => !conflicted.has(s.id));

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
        // Integrity: a review is only meaningful for an appointment that actually
        // took place. Allowing reviews on pending/cancelled/declined rows pollutes
        // the salon's denormalized avgRating/reviewCount with phantom ratings.
        if (appointment.status !== 'completed') {
            return res.status(400).json({ message: "You can only review appointments that have been completed" });
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
        // Keep the salon's denormalized rating cache in sync.
        await refreshSalonRatingCache(appointment.salonId);
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