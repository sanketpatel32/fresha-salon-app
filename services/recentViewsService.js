/**
 * Recently viewed salons (#58).
 *
 * Browse history is the cheapest convenience feature in a booking app and one
 * of the most used: "where was that place I looked at yesterday?" It's also
 * the easiest to get wrong in a way that quietly becomes a liability — a
 * table that grows forever, and a read path that 500s the moment an admin
 * deletes a salon out from under it.
 *
 * Three deliberate decisions:
 *  1. Repeat views UPDATE the existing row instead of inserting another, so
 *     the list is a recency ranking rather than a wall of duplicates.
 *  2. The table is pruned to the newest N per user on every write — bounded
 *     storage without a cron job, and the prune is a single ordered delete.
 *  3. Reads join to salons BY HAND and skip rows whose salon no longer
 *     exists. A dangling reference must degrade to "not shown", never to a
 *     failed request on the customer dashboard.
 */
const RecentlyViewed = require('../models/recentlyViewModel');
const salonModel = require('../models/salonsModel');
const logger = require('../utils/logger');

/** Rows kept per customer. The UI shows 10; the slack avoids prune churn. */
const HISTORY_LIMIT = 20;

/**
 * Record that a customer looked at a salon.
 * Fire-and-forget by design: browse history must never break the page load
 * that triggered it.
 */
const recordRecentView = async (userId, salonId) => {
  if (!userId || !salonId) return null;
  try {
    const [row] = await RecentlyViewed.findOrCreate({
      where: { userId, salonId },
      defaults: { userId, salonId, viewedAt: new Date() },
    });
    // A repeat view moves the salon back to the front of the list.
    if (!row.isNewRecord) {
      row.viewedAt = new Date();
      await row.save();
    }
    await prune(userId);
    return row;
  } catch (err) {
    logger.warn(`recentViews: could not record view (${err.message})`);
    return null;
  }
};

/**
 * Drop everything past the newest HISTORY_LIMIT rows for a user.
 * Two-step because SQLite can't ORDER BY inside a DELETE ... WHERE id IN
 * subquery reliably across dialects; the ids are selected first, then
 * deleted.
 */
const prune = async (userId) => {
  try {
    const stale = await RecentlyViewed.findAll({
      where: { userId },
      order: [['viewedAt', 'DESC']],
      offset: HISTORY_LIMIT,
      attributes: ['id'],
    });
    if (stale.length === 0) return 0;
    await RecentlyViewed.destroy({ where: { id: stale.map((r) => r.id) } });
    return stale.length;
  } catch (err) {
    logger.warn(`recentViews: prune failed (${err.message})`);
    return 0;
  }
};

/**
 * A customer's recently viewed salons, newest first, hydrated with the salon
 * details the UI needs to render a card.
 */
const getRecentlyViewed = async (userId, limit = 10) => {
  if (!userId) return [];
  const rows = await RecentlyViewed.findAll({
    where: { userId },
    order: [['viewedAt', 'DESC']],
    limit: Math.min(Math.max(1, Number(limit) || 10), HISTORY_LIMIT),
  });
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.salonId))];
  const salons = await salonModel.findAll({
    where: { id: ids },
    attributes: ['id', 'name', 'address', 'pricing', 'avgRating', 'reviewCount', 'statusbar'],
  });
  const byId = new Map(salons.map((s) => [s.id, s]));

  // Skip (rather than error on) any row whose salon has since been deleted.
  return rows
    .filter((r) => byId.has(r.salonId))
    .map((r) => {
      const s = byId.get(r.salonId);
      return {
        salonId: r.salonId,
        viewedAt: r.viewedAt,
        name: s.name,
        address: s.address,
        pricing: s.pricing,
        avgRating: s.avgRating,
        reviewCount: s.reviewCount,
        // A salon that has been deactivated shouldn't be re-bookable from
        // history, but it also shouldn't vanish — the customer may want to
        // remember where they went.
        active: s.statusbar !== 'inactive',
      };
    });
};

/** Clear one customer's history (used by the GDPR deletion path). */
const clearRecentViews = async (userId) => {
  try {
    return await RecentlyViewed.destroy({ where: { userId } });
  } catch (err) {
    logger.warn(`recentViews: clear failed (${err.message})`);
    return 0;
  }
};

module.exports = {
  recordRecentView,
  getRecentlyViewed,
  clearRecentViews,
  prune,
  HISTORY_LIMIT,
};
