/**
 * Idempotent column backfill for pre-existing databases.
 *
 * sequelize.sync() creates missing TABLES but never ALTERs existing ones, so
 * attributes added to a model after a database was first created silently
 * don't exist there. ensureColumns inspects the live schema and adds any
 * missing columns with a raw `ALTER TABLE ... ADD COLUMN`. Safe to call on
 * every boot: it no-ops when nothing is missing.
 *
 * Generic on purpose so future iterations can reuse it:
 *
 *   await ensureColumns(User, 'users', [
 *     { name: 'resetTokenHash', typeSql: 'VARCHAR(255)' },
 *   ]);
 *
 * @param {object} model  - a Sequelize model (its connection is used)
 * @param {string} tableName - physical table name (as in the DB, e.g. 'users')
 * @param {Array<{name: string, typeSql: string}>} columns - raw SQL type per column
 * @returns {Promise<string[]>} names of columns that were actually added
 */
async function ensureColumns(model, tableName, columns) {
  const sequelize = model.sequelize;
  const queryInterface = sequelize.getQueryInterface();
  const existing = await queryInterface.describeTable(tableName);
  const quote = (id) => queryInterface.queryGenerator.quoteIdentifier(id);

  const added = [];
  for (const col of columns) {
    if (existing[col.name]) continue;
    await sequelize.query(
      `ALTER TABLE ${quote(tableName)} ADD COLUMN ${quote(col.name)} ${col.typeSql}`
    );
    added.push(col.name);
  }
  return added;
}

module.exports = { ensureColumns };
