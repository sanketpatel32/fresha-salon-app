const salonModel = require('../models/salonsModel');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sequelize = require('../utils/database');
const appointmentModel = require('../models/appointmentModel');
const servicesModel = require('../models/servicesModel');
const userModel = require('../models/userModel');
const { parseGallery } = require('./salonGalleryController');
const { Op } = require('sequelize');

/**
 * Public responses expose the photo gallery as a parsed array field
 * `images` (parseGallery never throws, so corrupt DB values degrade to [])
 * and drop the raw JSON TEXT blob from the payload.
 */
const attachGallery = (salon) => {
    salon.dataValues.images = parseGallery(salon.galleryImages);
    delete salon.dataValues.galleryImages;
};

// Attach avgRating + reviewCount to each salon by aggregating its appointments' ratings.
const attachRatings = async (salons) => {
    const salonIds = salons.map(s => s.id);
    if (salonIds.length === 0) return;

    const rows = await appointmentModel.findAll({
        where: { salonId: salonIds, rating: { [Op.ne]: null } },
        attributes: [
            'salonId',
            [sequelize.fn('AVG', sequelize.col('rating')), 'avgRating'],
            [sequelize.fn('COUNT', sequelize.col('rating')), 'reviewCount'],
        ],
        group: ['salonId'],
        raw: true,
    });
    const map = {};
    rows.forEach(r => { map[r.salonId] = { avgRating: parseFloat(r.avgRating), reviewCount: parseInt(r.reviewCount, 10) }; });
    salons.forEach(s => {
        const m = map[s.id];
        s.dataValues.avgRating = m ? m.avgRating : null;
        s.dataValues.reviewCount = m ? m.reviewCount : 0;
    });
};

const salonSignup = async (req, res) => {
    const { name, phoneNumber, email, password, address, pricing } = req.body;

    try {
        // Check if the salon already exists
        const existingSalonEmail = await salonModel.findOne({ where: { email } });
        const existingSalonNumber = await salonModel.findOne({ where: { phoneNumber } });
        if (existingSalonEmail || existingSalonNumber) {
            return res.status(409).json({ message: "Salon already exists" });
        }

        // Hash the password before storing it
        const hashedPassword = await bcrypt.hash(password, 10);
        const newSalon = await salonModel.create({ name, phoneNumber, email, password: hashedPassword, address, pricing });

        // Generate JWT token
        const token = jwt.sign({ salonId: newSalon.id, role: 'salon' }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(201).json({ message: "Salon created successfully", token });
    } catch (err) {
        console.error("Error during signup:", err);
        res.status(500).json({ message: "Internal server error" });
    }
}

const salonLogin = async (req, res) => {
    const { email, password } = req.body;

    try {
        const salon = await salonModel.findOne({ where: { email } });

        if (!salon) {
            return res.status(404).json({ error: "Salon not found" });
        }

        // Compare the hashed password
        const isMatch = await bcrypt.compare(password, salon.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Incorrect password" });
        }

        // Generate JWT token
        const token = jwt.sign({ salonId: salon.id, role: 'salon' }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({ message: "Salon logged in successfully", token, salonId: salon.id });
    } catch (err) {
        console.error("Error logging in salon:", err);
        res.status(500).json({ error: "Internal server error" });
    }

}
/**
 * Browse salons with optional server-side filtering, sorting, and pagination.
 *
 * Query params (all optional — from salonBrowseSchema):
 *   q         — name/address LIKE search
 *   category  — filter to salons offering a service in this category
 *   pricing   — Affordable | Moderate | Premium
 *   minPrice  / maxPrice — filter by service price range
 *   minRating — 1-5 (uses the denormalized avgRating column)
 *   sort      — rating | price-low | price-high | newest
 *   page / limit — pagination (1-based page)
 *
 * Backward compat: when NO query params are present, returns the bare array
 * (the original behavior). When any param is present, returns
 * { data, total, page, totalPages }.
 */
const getAllSalons = async (req, res) => {
    try {
        const { q, category, pricing, minPrice, maxPrice, minRating, sort, page, limit } = req.query;

        // Detect "plain browse" — no params at all -> legacy bare-array response.
        const hasParams = Object.keys(req.query).length > 0;

        const where = { statusbar: 'active' };

        // Text search on name + address.
        if (q) {
            where[Op.or] = [
                { name: { [Op.like]: `%${q}%` } },
                { address: { [Op.like]: `%${q}%` } },
            ];
        }
        if (pricing) {
            where.pricing = pricing;
        }
        if (minRating) {
            where.avgRating = { [Op.gte]: Number(minRating) };
        }

        // Category / price filtering requires joining to services. Find the
        // set of salon IDs that have at least one matching service.
        if (category || minPrice || maxPrice) {
            const svcWhere = { statusbar: 'active' };
            if (category) svcWhere.category = category;
            if (minPrice !== undefined || maxPrice !== undefined) {
                svcWhere.price = {};
                if (minPrice !== undefined) svcWhere.price[Op.gte] = Number(minPrice);
                if (maxPrice !== undefined) svcWhere.price[Op.lte] = Number(maxPrice);
            }
            const matchingServices = await servicesModel.findAll({
                where: svcWhere,
                attributes: ['salonId'],
                group: ['salonId'],
                raw: true,
            });
            const salonIds = matchingServices.map(s => s.salonId);
            if (salonIds.length === 0) {
                // No salon matches the category/price filter.
                return res.status(200).json(hasParams ? { data: [], total: 0, page: page || 1, totalPages: 0 } : []);
            }
            where.id = { [Op.in]: salonIds };
        }

        // Sort order.
        const order = [];
        if (sort === 'rating') {
            order.push([sequelize.literal('avgRating DESC NULLS LAST')]);
        } else if (sort === 'newest') {
            order.push(['createdAt', 'DESC']);
        } else if (sort === 'price-low' || sort === 'price-high') {
            // Price sort: order by the salon's minimum service price.
            const dir = sort === 'price-low' ? 'ASC' : 'DESC';
            order.push([sequelize.literal(`(SELECT MIN(price) FROM services WHERE "services"."salonId" = "salons"."id" AND statusbar = 'active') ${dir}`)]);
        }

        // Pagination.
        const pageNum = page ? Number(page) : 1;
        const pageSize = limit ? Number(limit) : 12;
        const offset = (pageNum - 1) * pageSize;

        const { rows, count } = await salonModel.findAndCountAll({
            where,
            order,
            ...(hasParams ? { offset, limit: pageSize } : {}),
            attributes: { exclude: ['password'] },
        });

        // Strip timestamps from each row.
        rows.forEach(s => { delete s.dataValues.createdAt; delete s.dataValues.updatedAt; attachGallery(s); });

        // Attach live ratings (fall back if denormalized columns are null).
        await attachRatings(rows);

        if (!hasParams) {
            // Legacy bare-array response.
            if (rows.length === 0) {
                return res.status(404).json({ message: "No salons found" });
            }
            return res.status(200).json(rows);
        }

        res.status(200).json({
            data: rows,
            total: count,
            page: pageNum,
            totalPages: Math.ceil(count / pageSize),
        });
    } catch (err) {
        console.error("Error fetching salons:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}
const getSalonById = async (req, res) => {
    const salonId  = req.query.salonId ;
    // console.log("Salon ID:", salonId); 
    try {
        const salon = await salonModel.findOne({ where: { id: salonId } });
        if (!salon) {
            return res.status(404).json({ message: "Salon not found" });
        }
        delete salon.dataValues.password;
        delete salon.dataValues.createdAt;
        delete salon.dataValues.updatedAt;
        attachGallery(salon);
        await attachRatings([salon]);
        res.status(200).json(salon);
    } catch (err) {
        console.error("Error fetching salon:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}
/**
 * Public salon profile: the salon entity + active services (grouped by
 * category) + the 20 most recent customer reviews (joined with reviewer name).
 */
const getSalonProfile = async (req, res) => {
    const { salonId } = req.params;
    try {
        const salon = await salonModel.findOne({ where: { id: salonId }, attributes: { exclude: ['password'] } });
        if (!salon) {
            return res.status(404).json({ message: "Salon not found" });
        }
        delete salon.dataValues.createdAt;
        delete salon.dataValues.updatedAt;
        attachGallery(salon);
        await attachRatings([salon]);

        // Active services, ordered by category then price.
        const services = await servicesModel.findAll({
            where: { salonId, statusbar: 'active' },
            order: [['category', 'ASC'], ['price', 'ASC']],
            attributes: ['id', 'name', 'category', 'price', 'duration'],
        });

        // Recent reviews: appointments with a rating or text review, joined to
        // the customer's name. Limited to the most recent 20.
        const reviews = await appointmentModel.findAll({
            where: {
                salonId,
                [Op.or]: [
                    { rating: { [Op.ne]: null } },
                    { userReview: { [Op.ne]: null } },
                ],
            },
            include: [{ model: userModel, as: 'user', attributes: ['name'] }],
            attributes: ['rating', 'userReview', 'salonReply', 'date'],
            order: [['date', 'DESC'], ['id', 'DESC']],
            limit: 20,
        });

        res.status(200).json({ salon, services, reviews });
    } catch (err) {
        console.error("Error fetching salon profile:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}

const getSalonBySalonId = async (req, res) => {
    const salonId  = req.user.salonId ;

    try {
        const salon = await salonModel.findOne({ where: { id: salonId } });
        if (!salon) {
            return res.status(404).json({ message: "Salon not found" });
        }
        // Exclude sensitive information like password from the response
        delete salon.dataValues.password;
        delete salon.dataValues.createdAt;
        delete salon.dataValues.updatedAt;
        res.status(200).json(salon);
    } catch (err) {
        console.error("Error fetching salon:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}
const updateSalonDetails = async (req, res) => {
    const salonId = req.user.salonId;
    const { name, phoneNumber, address, workingDays, openingTime, closingTime, requiresApproval } = req.body;

    try {
        // Find the salon by ID
        const salon = await salonModel.findOne({ where: { id: salonId } });
        if (!salon) {
            return res.status(404).json({ message: "Salon not found" });
        }

        // Update the salon details
        await salon.update({
            name,
            phoneNumber,
            address,
            workingDays,
            openingTime,
            closingTime,
            requiresApproval
        });

        res.status(200).json({ message: "Salon details updated successfully" });
    } catch (err) {
        console.error("Error updating salon details:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}


module.exports = {
    salonSignup,
    salonLogin,
    getAllSalons,
    getSalonById,
    getSalonProfile,
    getSalonBySalonId,
    updateSalonDetails
};