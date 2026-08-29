const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

/**
 * Favorite STAFF (#59) — "book me with Priya again".
 *
 * The existing favorites table keys on salonId; a customer's real loyalty is
 * usually to a person, not a building. Kept as a separate table rather than a
 * nullable-staff column on `favorites` because a salon favorite and a staff
 * favorite are genuinely different objects with different lifetimes: you can
 * love a stylist who changes salon, and you can love a salon without caring
 * who cuts your hair.
 *
 * Composite primary key (userId, staffId) makes a duplicate follow impossible
 * at the database level — no application-level "check then insert" race, same
 * reasoning as the double-booking guard (#47).
 *
 * FOOTGUN the reference below exists to document: Sequelize PLURALIZES model
 * names into table names, so `sequelize.define('staff', ...)` lives in the
 * `staffs` table. Writing `references: { model: 'staff' }` — the model name —
 * produces a foreign key to a table that does not exist. SQLite tolerates it
 * at CREATE time and then explodes much later, in a completely unrelated
 * place: `DROP TABLE users` fails with "no such table: main.staff", because
 * preparing the cascading delete resolves every FK in the child's schema.
 * The name below must be the TABLE name, exactly as staffBlockoutModel does.
 */
const FavoriteStaff = sequelize.define('favoriteStaff', {
    userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
    },
    staffId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: 'staffs', key: 'id' },
        onDelete: 'CASCADE',
    },
}, { timestamps: true });

module.exports = FavoriteStaff;
