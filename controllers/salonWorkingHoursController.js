const Salons = require('../models/salonsModel');
const { getEffectiveWeeklyHours } = require('../services/availabilityService');

/**
 * Weekly working hours for the salon dashboard (per-day schedule editor).
 *
 * Ownership is implicit, like every other salonsDashboard controller: the
 * token carries the salonId and all reads/writes scope to it — there is no
 * :id param to forge. The PUT body is already validated by weeklyHoursSchema
 * (all 7 days present, open<close on open days), so what gets stringified is
 * always the canonical shape parseWeeklyHours expects at enforcement time.
 */

// GET /api/salonsdashboard/hours — effective 7-day schedule merged over the
// legacy single-window defaults, so clients ALWAYS receive a complete
// well-formed object (a raw null column reads as all-defaults).
const getHours = async (req, res) => {
    try {
        const salon = await Salons.findOne({
            where: { id: req.user.salonId },
            attributes: ['id', 'weeklyHours', 'workingDays', 'openingTime', 'closingTime'],
        });
        if (!salon) {
            return res.status(404).json({ message: 'Salon not found' });
        }

        return res.status(200).json({
            salonId: salon.id,
            weeklyHours: getEffectiveWeeklyHours(salon),
        });
    } catch (error) {
        console.error('Error in getHours:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// PUT /api/salonsdashboard/hours — replace own salon's weekly schedule
// wholesale (no partial updates; the editor submits all 7 days). Stored as
// canonical JSON text or left untouched on any failure.
const updateHours = async (req, res) => {
    try {
        const { weeklyHours } = req.body;

        const salon = await Salons.findOne({ where: { id: req.user.salonId } });
        if (!salon) {
            return res.status(404).json({ message: 'Salon not found' });
        }

        salon.weeklyHours = JSON.stringify(weeklyHours);
        await salon.save();

        return res.status(200).json({
            message: 'Working hours updated successfully',
            salonId: salon.id,
            // Echo the persisted schedule (already canonical via the schema)
            // so the UI can render exactly what enforcement will apply.
            weeklyHours,
        });
    } catch (error) {
        console.error('Error in updateHours:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    getHours,
    updateHours,
};
