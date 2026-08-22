const Salons = require('../models/salonsModel');
const { DEFAULT_SLOT_STEP_MINUTES } = require('../services/availabilityService');

/**
 * Booking-policy config for the salon dashboard (lead time + slot grid).
 *
 * Ownership is implicit, like every other salonsDashboard controller: the
 * token carries the salonId and all reads/writes scope to it — there is no
 * :id param to forge. The body is already validated by bookingConfigSchema.
 */

// GET /api/salonsdashboard/booking-config — read own salon's policy. Nulls
// are passed through so the UI can show "unset"; the effective defaults are
// documented on the availability-check response instead.
const getBookingConfig = async (req, res) => {
    try {
        const salon = await Salons.findOne({
            where: { id: req.user.salonId },
            attributes: ['id', 'bookingLeadTimeMinutes', 'slotStepMinutes'],
        });
        if (!salon) {
            return res.status(404).json({ message: 'Salon not found' });
        }

        return res.status(200).json({
            salonId: salon.id,
            bookingLeadTimeMinutes: salon.bookingLeadTimeMinutes,
            slotStepMinutes: salon.slotStepMinutes,
        });
    } catch (error) {
        console.error('Error in getBookingConfig:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// PUT /api/salonsdashboard/booking-config — replace own salon's policy.
// slotStepMinutes: null is meaningful ("use the default 30"), not a no-op;
// lead time 0 means bookable immediately.
const updateBookingConfig = async (req, res) => {
    try {
        const { bookingLeadTimeMinutes, slotStepMinutes } = req.body;

        const salon = await Salons.findOne({ where: { id: req.user.salonId } });
        if (!salon) {
            return res.status(404).json({ message: 'Salon not found' });
        }

        salon.bookingLeadTimeMinutes = bookingLeadTimeMinutes;
        salon.slotStepMinutes = slotStepMinutes ?? null;
        await salon.save();

        return res.status(200).json({
            message: 'Booking configuration updated successfully',
            salonId: salon.id,
            bookingLeadTimeMinutes: salon.bookingLeadTimeMinutes,
            slotStepMinutes: salon.slotStepMinutes,
            // Echo the effective grid so the dashboard can label it directly.
            effectiveSlotStepMinutes: salon.slotStepMinutes ?? DEFAULT_SLOT_STEP_MINUTES,
        });
    } catch (error) {
        console.error('Error in updateBookingConfig:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    getBookingConfig,
    updateBookingConfig,
};
