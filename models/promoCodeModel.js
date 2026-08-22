const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

/**
 * Promo codes.
 *
 * `code` is always stored UPPERCASED via a model setter, so every lookup and
 * uniqueness check works on one canonical form no matter how the client typed
 * it ("save20", "SAVE20", " Save20 " all collapse to SAVE20).
 *
 * `salonId` null means the code applies at ANY salon; otherwise only bookings
 * at that salon may redeem it.
 *
 * `usageLimit` null = unlimited redemptions; `usedCount` counts successful
 * redemptions (incremented atomically when a payment finalizes).
 */
const PromoCode = sequelize.define('promoCode', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true
    },
    code: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
        set(value) {
            this.setDataValue('code', String(value || '').trim().toUpperCase());
        }
    },
    discountType: {
        type: Sequelize.STRING,
        allowNull: false,
        validate: {
            isIn: { args: [['percent', 'flat']], msg: 'discountType must be percent or flat' }
        }
    },
    discountValue: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        validate: {
            min: { args: [0.01], msg: 'Discount value must be greater than zero' }
        }
    },
    maxDiscountAmount: { // cap for percent discounts; ignored for flat
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
    },
    minOrderAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    validFrom: {
        type: Sequelize.DATE,
        allowNull: true
    },
    validUntil: {
        type: Sequelize.DATE,
        allowNull: true
    },
    usageLimit: {
        type: Sequelize.INTEGER,
        allowNull: true // null = unlimited
    },
    usedCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    salonId: {
        type: Sequelize.INTEGER,
        allowNull: true // null = applies to any salon
    }
});

module.exports = PromoCode;
