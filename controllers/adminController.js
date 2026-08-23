require('dotenv').config();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const appointmentModel = require('../models/appointmentModel');
const salonModel = require('../models/salonsModel');
const userModel = require('../models/userModel');
const servicesModel = require('../models/servicesModel');
const staffModel = require('../models/staffModel');
const paymentModel = require('../models/paymentModel');
const favoriteModel = require('../models/favoriteModel');
const { Op, fn, col, literal } = require('sequelize');
const { paginateQuery, buildMeta } = require('../utils/pagination');
const adminAuditModel = require('../models/adminAuditModel');
const { recordAudit } = require('../services/adminAuditService');
// Compare two strings in constant time. Plain === bails out at the first
// mismatching byte, leaking how much of the credential an attacker guessed.
// Hashing both sides first guarantees equal-length buffers (SHA-256 is always
// 32 bytes), which timingSafeEqual requires, without a leaky length pre-check.
const credentialsMatch = (provided, expected) => {
    const providedHash = crypto.createHash('sha256').update(String(provided ?? ''), 'utf8').digest();
    const expectedHash = crypto.createHash('sha256').update(String(expected ?? ''), 'utf8').digest();
    return crypto.timingSafeEqual(providedHash, expectedHash);
};

const adminlogin = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Use environment variables for admin credentials. Both comparisons
        // always run (no short-circuit) so response timing doesn't reveal
        // which field was wrong.
        const userOk = credentialsMatch(email, process.env.ADMIN_USER);
        const passOk = credentialsMatch(password, process.env.ADMIN_PASS);
        if (userOk && passOk) {
            // Generate JWT token
            const token = jwt.sign(
                { admin: email, role: 'admin' },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );
            return res.status(200).json({ message: "Admin logged in successfully", token });
        } else {
            return res.status(401).json({ error: "Invalid admin credentials" });
        }
    } catch (err) {
        console.error("Error logging in admin:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

const getAllAppointments = async (req, res) => {
    try {
        // Get current date and time in YYYY-MM-DD and HH:mm:ss format
        const now = new Date();
        const currentDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
        const currentTime = now.toTimeString().slice(0, 8); // HH:mm:ss

        // Backward compat: no page/limit params -> legacy bare-array response.
        const { requested, page, limit, offset } = paginateQuery(req);

        const findOpts = {
            where: {
                [Op.or]: [
                    // Appointments after today
                    { date: { [Op.gt]: currentDate } },
                    // Appointments today but later than now
                    {
                        date: currentDate,
                        time: { [Op.gte]: currentTime }
                    }
                ]
            },
            include: [
                { model: salonModel, as: 'salon', attributes: ['name'] },
                { model: userModel, as: 'user', attributes: ['name', 'phoneNumber'] },
                { model: servicesModel, as: 'service', attributes: ['name', 'price'] },
                { model: staffModel, as: 'staff', attributes: ['name'] }
            ],
            ...(requested ? { order: [['date', 'ASC'], ['time', 'ASC']] } : {}),
        };

        if (!requested) {
            const appointments = await appointmentModel.findAll(findOpts);
            return res.status(200).json(appointments);
        }

        const { rows, count } = await appointmentModel.findAndCountAll({
            ...findOpts,
            limit,
            offset,
            distinct: true,
        });

        return res.status(200).json({ data: rows, ...buildMeta(page, limit, count) });
    } catch (error) {
        console.error("Error fetching appointments:", error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

const deleteAppointment = async (req, res) => {
    try {
        const appointmentId = req.params.id;

        // Check if the appointment exists (names included purely to enrich the
        // audit trail — never sent to the client).
        const appointment = await appointmentModel.findByPk(appointmentId, {
            include: [
                { model: userModel, as: 'user', attributes: ['name', 'email'] },
                { model: salonModel, as: 'salon', attributes: ['name'] },
            ],
        });
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        // Delete the appointment
        await appointment.destroy();

        // Fire-and-forget audit entry — must never fail the deletion.
        const who = appointment.user ? `${appointment.user.name} <${appointment.user.email}>` : 'unknown customer';
        const where = appointment.salon ? ` at ${appointment.salon.name}` : '';
        recordAudit({
            adminEmail: req.user?.admin || 'unknown-admin',
            action: 'appointment.delete',
            targetType: 'appointment',
            targetId: String(appointmentId),
            details: `${who}${where} (${appointment.date} ${appointment.time})`,
        });

        return res.status(200).json({ message: 'Appointment deleted successfully' });
    } catch (error) {
        console.error("Error deleting appointment:", error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

const searchUsers = async (req, res) => {
    const { searchTerm } = req.query;

    try {
        // Escape SQL LIKE wildcards so a search for "%" or "_" matches literally
        // instead of every row. (Length/shape is already enforced by the route's
        // adminSearchSchema, but escaping is defense-in-depth.)
        const escaped = String(searchTerm).replace(/[%_\\]/g, '\\$&');
        const pattern = { [Op.like]: `%${escaped}%` };

        const users = await userModel.findAll({
            where: {
                [Op.or]: [
                    { name: pattern },
                    { email: pattern },
                    { phoneNumber: pattern }
                ]
            }
        });

        return res.status(200).json(users);
    } catch (error) {
        console.error("Error searching users:", error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

const deleteUser = async (req, res) => {
    const userId = req.params.id;
    const sequelize = require('../utils/database');

    try {
        const user = await userModel.findByPk(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Cascade-delete the user's dependent rows explicitly, in a transaction.
        // We can't rely on ON DELETE CASCADE: SQLite has foreign keys disabled
        // by default (no PRAGMA foreign_keys=ON), so the association-level
        // onDelete:'CASCADE' is a no-op in dev. Doing it explicitly works on
        // both SQLite and Postgres.
        await sequelize.transaction(async (t) => {
            await appointmentModel.destroy({ where: { userId }, transaction: t });
            await paymentModel.destroy({ where: { customerID: userId }, transaction: t });
            await favoriteModel.destroy({ where: { userId }, transaction: t });
            await user.destroy({ transaction: t });
        });

        // Fire-and-forget audit entry — must never fail the deletion. The row
        // is gone, so the name/email only live on in `details` from here on.
        recordAudit({
            adminEmail: req.user?.admin || 'unknown-admin',
            action: 'user.delete',
            targetType: 'user',
            targetId: String(userId),
            details: `${user.name} <${user.email}>`,
        });

        return res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error("Error deleting user:", error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};
const getPlatformStats = async (req, res) => {
    try {
        // Simple totals — three cheap COUNT(*) queries run concurrently.
        const [totalSalons, totalCustomers, totalStaff] = await Promise.all([
            salonModel.count(),
            userModel.count(),
            staffModel.count(),
        ]);

        // Appointment status breakdown in ONE grouped query (never one query
        // per status). Unknown statuses are ignored rather than crashing the
        // response shape.
        const statusRows = await appointmentModel.findAll({
            attributes: ['status', [fn('COUNT', col('status')), 'count']],
            group: [col('status')],
        });
        const appointmentsByStatus = {
            pending: 0,
            confirmed: 0,
            cancelled: 0,
            completed: 0,
            declined: 0,
            'no-show': 0,
        };
        for (const row of statusRows) {
            const key = row.get('status');
            if (key in appointmentsByStatus) {
                appointmentsByStatus[key] = Number(row.get('count'));
            }
        }

        // Gross platform revenue: SUM(orderAmount) over SUCCESSFUL payments
        // only. 'Success' is the exact gateway/webhook status string used by
        // cashfreeServices + paymentController when a booking finalizes.
        // COALESCE keeps this 0 (not null) on an empty ledger.
        const revenueRow = await paymentModel.findOne({
            attributes: [[fn('COALESCE', fn('SUM', col('orderAmount')), literal('0')), 'revenue']],
            where: { paymentStatus: 'Success' },
        });
        const revenueTotal = Number(revenueRow ? revenueRow.get('revenue') : 0);

        // Total customer tips actually captured: SUM(tipAmount) over successful
        // payments whose booking finalized (tipCaptured=1, flipped inside
        // finalizeAppointmentFromPayment). Pending/failed/unfinalized orders
        // are excluded; NULL (tip-less) rows are skipped by SUM itself.
        // COALESCE keeps this 0 (not null) on an empty ledger — same
        // fn/col/literal aggregation style as the revenue sum above.
        const tipsRow = await paymentModel.findOne({
            attributes: [[fn('COALESCE', fn('SUM', col('tipAmount')), literal('0')), 'totalTips']],
            where: { paymentStatus: 'Success', tipCaptured: 1 },
        });
        const totalTips = Number(tipsRow ? tipsRow.get('totalTips') : 0);

        // New customer signups in the trailing 7 days.
        const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const newCustomers = await userModel.count({
            where: { createdAt: { [Op.gte]: weekAgo } },
        });

        return res.status(200).json({
            totalSalons,
            totalCustomers,
            totalStaff,
            appointmentsByStatus,
            revenueTotal,
            totalTips,
            last7Days: { newCustomers },
            serverTimestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error("Error building platform stats:", error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

const getAuditLog = async (req, res) => {
    try {
        // Same backward-compatible contract as every other listing:
        // no page/limit -> legacy bare array; either param -> envelope.
        const { requested, page, limit, offset } = paginateQuery(req);

        const findOpts = {
            order: [['createdAt', 'DESC'], ['id', 'DESC']], // newest-first
        };

        if (!requested) {
            const rows = await adminAuditModel.findAll(findOpts);
            return res.status(200).json(rows);
        }

        const { rows, count } = await adminAuditModel.findAndCountAll({
            ...findOpts,
            limit,
            offset,
            distinct: true,
        });

        return res.status(200).json({ data: rows, ...buildMeta(page, limit, count) });
    } catch (error) {
        console.error("Error fetching audit log:", error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports = {
    adminlogin,
    getAllAppointments,
    deleteAppointment,  
    searchUsers,
    deleteUser,
    getPlatformStats,
    getAuditLog
};