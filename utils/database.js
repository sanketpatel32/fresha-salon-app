const Sequelize = require('sequelize');
const path = require('path');
require('dotenv').config();

// Production (Render): use the managed Postgres connection string.
// Local development: fall back to a file-based SQLite database so no
// external services are required to run the app.
if (process.env.DATABASE_URL) {
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: { rejectUnauthorized: false }, // Render Postgres requires SSL
    },
  });
  module.exports = sequelize;
} else {
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    // DB_STORAGE redirects the sqlite file (tests use per-run files so
    // concurrent `node --test` invocations can't corrupt each other).
    storage: process.env.DB_STORAGE || path.join(__dirname, '..', 'database.sqlite'),
    logging: false, // Set to console.log to see database queries
  });
  module.exports = sequelize;
}
