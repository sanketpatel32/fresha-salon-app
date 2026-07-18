const appointmentModel = require('../models/appointmentModel');
const paymentModel = require('../models/paymentModel');
const servicesModel = require('../models/servicesModel');
const staffModel = require('../models/staffModel');
const { Op, fn, col, literal } = require('sequelize');

// GET /api/salonsdashboard/analytics — KPI summary for the salon owner's dashboard.
// Returns: totalRevenue, statusCounts, topServices (top 3), bookingsPerDay (last 7 days).
const getAnalytics = async (req, res) => {
    const salonId = req.user.salonId;
    try {
        // Total revenue from successful payments for this salon.
        const revenueRow = await paymentModel.findOne({
            where: { salonId, paymentStatus: 'Success' },
            attributes: [[fn('SUM', col('orderAmount')), 'total']],
            raw: true,
        });
        const totalRevenue = revenueRow && revenueRow.total ? parseFloat(revenueRow.total) : 0;

        // Appointment counts grouped by status.
        const statusRows = await appointmentModel.findAll({
            where: { salonId },
            attributes: ['status', [fn('COUNT', col('*')), 'count']],
            group: ['status'],
            raw: true,
        });
        const statusCounts = { pending: 0, confirmed: 0, completed: 0, cancelled: 0, declined: 0 };
        statusRows.forEach(r => { statusCounts[r.status] = parseInt(r.count, 10); });

        // Top 3 services by booking count.
        const topServiceRows = await appointmentModel.findAll({
            where: { salonId },
            attributes: ['serviceId', [fn('COUNT', col('serviceId')), 'count']],
            include: [{ model: servicesModel, as: 'service', attributes: ['name'] }],
            group: ['serviceId'],
            order: [[literal('count'), 'DESC']],
            limit: 3,
            raw: true,
        });
        const topServices = topServiceRows.map(r => ({ name: r['service.name'], count: parseInt(r.count, 10) }));

        // Bookings per day for the last 7 days (including today).
        const today = new Date();
        const sevenAgo = new Date(today.getTime() - 6 * 24 * 3600 * 1000);
        const fromDate = sevenAgo.toISOString().slice(0, 10);
        const dayRows = await appointmentModel.findAll({
            where: { salonId, date: { [Op.gte]: fromDate } },
            attributes: ['date', [fn('COUNT', col('*')), 'count']],
            group: ['date'],
            order: [['date', 'ASC']],
            raw: true,
        });
        // Fill in zero-count days for a continuous 7-day series.
        const bookingsPerDay = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today.getTime() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
            const found = dayRows.find(r => r.date === d);
            bookingsPerDay.push({ date: d, count: found ? parseInt(found.count, 10) : 0 });
        }

        res.status(200).json({ totalRevenue, statusCounts, topServices, bookingsPerDay });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/salonsdashboard/calendar?week=YYYY-MM-DD — bookings for the 7-day week containing the given date.
const getCalendar = async (req, res) => {
    const salonId = req.user.salonId;
    try {
        const weekStart = req.query.week
            ? new Date(req.query.week)
            : new Date();
        if (Number.isNaN(weekStart.getTime())) {
            return res.status(400).json({ message: 'Invalid week date' });
        }
        // Normalize to the Monday of that week.
        const dayOfWeek = (weekStart.getDay() + 6) % 7; // Mon=0 ... Sun=6
        const monday = new Date(weekStart);
        monday.setDate(weekStart.getDate() - dayOfWeek);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const fromStr = monday.toISOString().slice(0, 10);
        const toStr = sunday.toISOString().slice(0, 10);

        const appointments = await appointmentModel.findAll({
            where: { salonId, date: { [Op.between]: [fromStr, toStr] } },
            include: [
                { model: staffModel, as: 'staff', attributes: ['id', 'name'] },
                { model: servicesModel, as: 'service', attributes: ['name'] },
                { model: require('../models/userModel'), as: 'user', attributes: ['name'] },
            ],
            order: [['date', 'ASC'], ['time', 'ASC']],
        });

        res.status(200).json(appointments);
    } catch (error) {
        console.error('Error fetching calendar:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getAnalytics, getCalendar };
