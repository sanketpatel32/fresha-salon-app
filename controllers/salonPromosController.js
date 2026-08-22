/**
 * Salon-owned promo code management (mounted under /api/salonsdashboard).
 *
 * Every handler scopes to req.user.salonId — a salon can only ever see or
 * touch its own codes. Ownership violations are 403; unknown ids 404.
 */
const PromoCode = require('../models/promoCodeModel');

const isSequelizeUniqueError = (error) => error && error.name === 'SequelizeUniqueConstraintError';

/**
 * POST /promos — create a promo for the caller's salon.
 * The zod schema has already validated + uppercased `code`.
 */
const createPromo = async (req, res) => {
    try {
        const salonId = req.user.salonId;
        const {
            code, discountType, discountValue, maxDiscountAmount,
            minOrderAmount, validFrom, validUntil, usageLimit,
        } = req.body;

        const promo = await PromoCode.create({
            code, // model setter uppercases/trims
            discountType,
            discountValue,
            maxDiscountAmount: maxDiscountAmount ?? null,
            minOrderAmount: minOrderAmount ?? 0,
            validFrom: validFrom || null,
            validUntil: validUntil || null,
            usageLimit: usageLimit ?? null,
            salonId, // always the owner's salon — never client-supplied
        });

        return res.status(201).json(promo);
    } catch (error) {
        if (isSequelizeUniqueError(error)) {
            return res.status(409).json({ message: 'A promo with this code already exists' });
        }
        console.error('Error in createPromo:', error.message);
        return res.status(500).json({ message: 'Server error' });
    }
};

/**
 * GET /promos — list the caller's own promos, newest first.
 * Inactive (soft-deleted) ones stay listed so owners can see history.
 */
const listPromos = async (req, res) => {
    try {
        const promos = await PromoCode.findAll({
            where: { salonId: req.user.salonId },
            order: [['createdAt', 'DESC']],
        });
        return res.status(200).json(promos);
    } catch (error) {
        console.error('Error in listPromos:', error.message);
        return res.status(500).json({ message: 'Server error' });
    }
};

/**
 * PATCH /promos/:id — edit own promo. Editable: isActive toggle, discount
 * cap/min-order, validity window, usage limit. Immutable by design: `code`,
 * `discountType`, `usedCount`, `salonId` (changing those rewrites the deal
 * customers already saw).
 */
const updatePromo = async (req, res) => {
    try {
        const { id } = req.params;
        const promo = await PromoCode.findOne({ where: { id } });

        if (!promo) {
            return res.status(404).json({ message: 'Promo not found' });
        }
        if (Number(promo.salonId) !== Number(req.user.salonId)) {
            return res.status(403).json({ message: 'Unauthorized: Access denied to modify this promo' });
        }

        const { isActive, maxDiscountAmount, minOrderAmount, validFrom, validUntil, usageLimit } = req.body;
        if (isActive !== undefined) promo.isActive = isActive;
        if (maxDiscountAmount !== undefined) promo.maxDiscountAmount = maxDiscountAmount;
        if (minOrderAmount !== undefined) promo.minOrderAmount = minOrderAmount;
        if (validFrom !== undefined) promo.validFrom = validFrom;
        if (validUntil !== undefined) promo.validUntil = validUntil;
        if (usageLimit !== undefined) promo.usageLimit = usageLimit;

        await promo.save();
        return res.status(200).json({ message: 'Promo updated successfully', promo });
    } catch (error) {
        console.error('Error in updatePromo:', error.message);
        return res.status(500).json({ message: 'Server error' });
    }
};

/**
 * DELETE /promos/:id — SOFT delete: sets isActive=false and keeps the row so
 * past Payment rows that reference the code keep a coherent audit trail
 * (hard deletes would orphan historical redemptions). Idempotent.
 */
const deletePromo = async (req, res) => {
    try {
        const { id } = req.params;
        const promo = await PromoCode.findOne({ where: { id } });

        if (!promo) {
            return res.status(404).json({ message: 'Promo not found' });
        }
        if (Number(promo.salonId) !== Number(req.user.salonId)) {
            return res.status(403).json({ message: 'Unauthorized: Access denied to delete this promo' });
        }

        promo.isActive = false;
        await promo.save();

        return res.status(200).json({ message: 'Promo deactivated successfully', promo });
    } catch (error) {
        console.error('Error in deletePromo:', error.message);
        return res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { createPromo, listPromos, updatePromo, deletePromo };
