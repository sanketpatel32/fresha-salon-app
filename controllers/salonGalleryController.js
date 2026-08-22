const Salons = require('../models/salonsModel');

/**
 * Safe-parse the salons.galleryImages TEXT column into a string[].
 *
 * The column stores JSON.stringify(string[]) or null. Never throws: any
 * garbage (null, malformed JSON, JSON that isn't an array, entries that
 * aren't strings) degrades to [] so a corrupt row can never turn a public
 * profile read into a 500.
 */
const parseGallery = (raw) => {
    if (!raw || typeof raw !== 'string') return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((u) => typeof u === 'string');
    } catch (_err) {
        return [];
    }
};

/**
 * PUT /api/salonsdashboard/gallery — upsert the calling salon's photo
 * gallery. Body is already validated by gallerySchema (trimmed, deduped,
 * max 10 http(s) URLs). Ownership is implicit, like every other
 * salonsDashboard controller: the token carries the salonId and all reads/
 * writes scope to it — there is no :id param to forge.
 */
const updateGallery = async (req, res) => {
    try {
        const salonId = req.user.salonId;
        const { images } = req.body;

        const salon = await Salons.findOne({ where: { id: salonId } });
        if (!salon) {
            return res.status(404).json({ message: 'Salon not found' });
        }

        // Empty array clears the gallery — store NULL so the column reads as
        // "unset" rather than the string "[]".
        salon.galleryImages = images.length > 0 ? JSON.stringify(images) : null;
        await salon.save();

        return res.status(200).json({ message: 'Gallery updated successfully', images });
    } catch (error) {
        console.error('Error in updateGallery:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    parseGallery,
    updateGallery,
};
