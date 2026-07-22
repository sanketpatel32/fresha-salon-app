/**
 * One-time backfill: assigns a category to services that don't have one
 * (or have the default 'Other'), by keyword-matching the service name.
 *
 * Run after the `category` column is added. Safe to run repeatedly — it only
 * updates rows where the keyword match is stronger than the current value.
 * Called from app.js after sync + seed.
 */
const Services = require('../models/servicesModel');
const { Op } = require('sequelize');

// Keyword -> category mapping. First match wins, so order matters.
const RULES = [
  { keywords: ['massage', 'spa', 'aromatherapy', 'body', 'steam', 'sauna'], category: 'Spa & Massage' },
  { keywords: ['facial', 'skin', 'cleanup', 'glow'], category: 'Facial & Skin' },
  { keywords: ['hair', 'cut', 'keratin', 'color', 'colour', 'style', 'wash', 'trim', 'blowout'], category: 'Hair' },
  { keywords: ['beard', 'shave', 'grooming', 'men'], category: "Men's Grooming" },
  { keywords: ['nail', 'manicure', 'pedicure'], category: 'Nails' },
  { keywords: ['makeup', 'make-up', 'foundation'], category: 'Makeup' },
  { keywords: ['bridal', 'wedding', 'bride'], category: 'Bridal' },
];

const classify = (name) => {
  const lower = (name || '').toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.category;
    }
  }
  return 'Other';
};

const migrateCategories = async () => {
  try {
    const services = await Services.findAll({ where: { category: 'Other' } });
    if (services.length === 0) return;

    let updated = 0;
    for (const svc of services) {
      const guessed = classify(svc.name);
      if (guessed !== 'Other') {
        svc.category = guessed;
        await svc.save();
        updated++;
      }
    }
    if (updated > 0) {
      console.log(`🏷️  Backfilled category on ${updated} service(s).`);
    }
  } catch (error) {
    // Non-fatal — the column may not exist yet on first sync before alter.
    console.error('Category backfill skipped:', error.message);
  }
};

module.exports = { migrateCategories, classify };
