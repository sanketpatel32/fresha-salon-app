/**
 * Demo/sample data seeding.
 *
 * Seeds a complete, believable little marketplace: 5 salons, ~30 services
 * across every category, 12 staff, 12 free demo customer accounts, promo
 * codes, six weeks of booking history (with ratings, reviews, cancellations,
 * tips and the matching payment ledger), upcoming bookings, favorites,
 * waitlist entries and notifications.
 *
 * Everything is DETERMINISTIC: a fixed-seed PRNG picks customers, ratings
 * and review texts, so two fresh databases look identical (screenshots and
 * tests stay stable). Dates are derived from "now" so the demo always has a
 * living past and future.
 *
 * Usage:
 *   - app.js calls seedSampleData() at boot when the salons table is empty.
 *   - `npm run seed` runs it standalone; `npm run seed -- --force` wipes the
 *     demo tables first (refused in production).
 */

const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const sequelize = require('./database');
const { config } = require('./config');
const logger = require('./logger');

// ── Deterministic PRNG (mulberry32) ────────────────────────────────────────
// Fixed seed: the demo dataset is reproducible across machines and reseeds.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const atTime = (ymdStr, hhmm) => new Date(`${ymdStr}T${hhmm}:00`);
const addMinutes = (hhmm, mins) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
};

/** Stable Unsplash CDN images (hotlinked URLs with sizing params). */
const img = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=60`;
const GALLERY_SPA = [img('photo-1544161515-4ab6ce6db874'), img('photo-1540555700478-4be289fbecef'), img('photo-1519415943484-9fa1873496d4')];
const GALLERY_HAIR = [img('photo-1560066984-138dadb4c035'), img('photo-1522337360788-8b13dee7a37e'), img('photo-1562322140-8baeececf3df')];
const GALLERY_NAILS = [img('photo-1519823551278-64ac92734fb1'), img('photo-1457972729786-0411a3b2b626'), img('photo-1522335789203-aabd1fc54bc9')];

// ── Dataset ────────────────────────────────────────────────────────────────

const CUSTOMERS = [
  ['Jane Doe', 'jane@example.com', '9876543210'],
  ['John Smith', 'john@example.com', '8765432109'],
  ['Aarav Sharma', 'aarav@example.com', '9812345670'],
  ['Priya Patel', 'priya@example.com', '9822345671'],
  ['Vikram Mehta', 'vikram@example.com', '9832345672'],
  ['Sneha Iyer', 'sneha@example.com', '9842345673'],
  ['Rahul Verma', 'rahul@example.com', '9852345674'],
  ['Ananya Reddy', 'ananya@example.com', '9862345675'],
  ['Karan Malhotra', 'karan@example.com', '9872245676'],
  ['Meera Nair', 'meera@example.com', '9882245677'],
  ['Diya Kapoor', 'diya@example.com', '9892245678'],
  ['Arjun Singh', 'arjun@example.com', '9902245679'],
];

// weeklyHours: seven entries keyed "0".."6" ({open, close, closed}) — the same
// shape salonWorkingHoursController persists, so the demo exercises that path.
const weekly = (open, close, closedDays = [0]) =>
  JSON.stringify(Object.fromEntries(dayNames.map((_, i) => [
    String(i),
    closedDays.includes(i) ? { closed: true, open: close, close: close } : { open, close, closed: false },
  ])));

const SALONS = [
  {
    name: 'Orchid Luxury Hair & Spa', email: 'owner@orchid.com', phoneNumber: '9876543201',
    address: '102 Royal Boulevard, City Center', pricing: 'Premium',
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '09:00', closingTime: '20:00',
    bookingLeadTimeMinutes: 60, slotStepMinutes: 30, weeklyHours: weekly('09:00', '20:00', [0]),
    galleryImages: JSON.stringify(GALLERY_SPA),
  },
  {
    name: 'Aura Mens Grooming & Co', email: 'owner@aura.com', phoneNumber: '9876543202',
    address: '45 Metro Heights, Business Plaza', pricing: 'Moderate',
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], openingTime: '10:00', closingTime: '21:00',
    weeklyHours: weekly('10:00', '21:00', []),
  },
  {
    name: 'Vibe Quick Cuts & Styles', email: 'owner@vibe.com', phoneNumber: '9876543203',
    address: '88 University Avenue, West Side', pricing: 'Affordable',
    workingDays: ['mon', 'wed', 'thu', 'fri', 'sat', 'sun'], openingTime: '08:00', closingTime: '19:00',
  },
  {
    name: 'Serenity Spa & Wellness', email: 'owner@serenity.com', phoneNumber: '9876543204',
    address: '9 Palm Grove Road, Lake District', pricing: 'Premium',
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openingTime: '10:00', closingTime: '19:00',
    requiresApproval: true, bookingLeadTimeMinutes: 120,
    weeklyHours: weekly('10:00', '19:00', [0]),
    galleryImages: JSON.stringify(GALLERY_SPA),
  },
  {
    name: 'Blush Beauty Bar', email: 'owner@blush.com', phoneNumber: '9876543205',
    address: '17 Lantern Street, Old Town', pricing: 'Moderate',
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], openingTime: '10:00', closingTime: '20:00',
    galleryImages: JSON.stringify(GALLERY_NAILS),
  },
];

// Services per salon. `by` lists staff emails allowed to perform the service.
const SERVICES = {
  'owner@orchid.com': [
    { name: 'Royal Keratin Hair Treatment', price: 2500, duration: 60, category: 'Hair', by: ['sarah@orchid.com', 'marcus@orchid.com'] },
    { name: 'Aromatherapy Full Body Massage', price: 3200, duration: 90, category: 'Spa & Massage', by: ['sarah@orchid.com', 'elena@orchid.com'] },
    { name: 'Classic Hydrating Facial', price: 1800, duration: 45, category: 'Facial & Skin', by: ['sarah@orchid.com', 'marcus@orchid.com', 'elena@orchid.com'] },
    { name: 'Luxury Manicure & Pedicure', price: 1500, duration: 60, category: 'Nails', by: ['elena@orchid.com'] },
    { name: 'Balayage Colour & Style', price: 4500, duration: 120, category: 'Hair', by: ['marcus@orchid.com'] },
    { name: 'Bridal Glam Package', price: 12000, duration: 150, category: 'Bridal', by: ['sarah@orchid.com', 'elena@orchid.com'] },
    { name: 'Platinum Detox Ritual', price: 5000, duration: 75, category: 'Spa & Massage', by: ['elena@orchid.com'], archived: true },
  ],
  'owner@aura.com': [
    { name: 'Signature Beard Trim & Steam Shave', price: 800, duration: 30, category: "Men's Grooming", by: ['james@aura.com', 'kabir@aura.com'] },
    { name: 'Executive Hair Styling & Wash', price: 1200, duration: 45, category: 'Hair', by: ['james@aura.com'] },
    { name: 'Deep Tissue Back Massage', price: 1600, duration: 45, category: 'Spa & Massage', by: ['kabir@aura.com'] },
    { name: "Men's De-Tan Clean-Up Facial", price: 900, duration: 30, category: 'Facial & Skin', by: ['james@aura.com', 'kabir@aura.com'] },
    { name: 'Skin Fade & Hair Tattoo', price: 700, duration: 45, category: "Men's Grooming", by: ['kabir@aura.com'] },
  ],
  'owner@vibe.com': [
    { name: 'Express Dry Cut', price: 350, duration: 15, category: 'Hair', by: ['tina@vibe.com', "rhea@vibe.com"] },
    { name: 'Basic Head Massage & Wash', price: 250, duration: 15, category: 'Spa & Massage', by: ['tina@vibe.com'] },
    { name: 'Party Makeup Lite', price: 600, duration: 30, category: 'Makeup', by: ["rhea@vibe.com"] },
    { name: 'Chic Nail Paint & Art', price: 450, duration: 30, category: 'Nails', by: ["rhea@vibe.com"] },
    { name: 'Hair Spa Rinse', price: 500, duration: 45, category: 'Hair', by: ['tina@vibe.com', "rhea@vibe.com"] },
  ],
  'owner@serenity.com': [
    { name: 'Swedish Full Body Massage', price: 3500, duration: 75, category: 'Spa & Massage', by: ['anjali@serenity.com', 'feng@serenity.com'] },
    { name: 'Hot Stone Therapy', price: 4200, duration: 90, category: 'Spa & Massage', by: ['feng@serenity.com'] },
    { name: 'Couple Retreat Spa Day', price: 9000, duration: 150, category: 'Spa & Massage', by: ['anjali@serenity.com'] },
    { name: 'Radiance Gold Facial', price: 2600, duration: 60, category: 'Facial & Skin', by: ['anjali@serenity.com'] },
    { name: 'Aroma Head & Shoulder Ritual', price: 1400, duration: 30, category: 'Spa & Massage', by: ['anjali@serenity.com', 'feng@serenity.com'] },
  ],
  'owner@blush.com': [
    { name: 'Gel Nail Extensions', price: 1800, duration: 75, category: 'Nails', by: ['natasha@blush.com', 'zoya@blush.com'] },
    { name: 'Classic Mani-Pedi Combo', price: 1200, duration: 60, category: 'Nails', by: ['natasha@blush.com'] },
    { name: 'HD Party Makeup', price: 2500, duration: 60, category: 'Makeup', by: ['zoya@blush.com', 'ishita@blush.com'] },
    { name: 'Engagement Bridal Look', price: 9500, duration: 120, category: 'Bridal', by: ['ishita@blush.com'] },
    { name: 'Keratin Smooth Hair Spa', price: 2200, duration: 60, category: 'Hair', by: ['ishita@blush.com'] },
    { name: 'Chocolate Wax & Polish', price: 800, duration: 40, category: 'Facial & Skin', by: ['natasha@blush.com', 'zoya@blush.com'] },
  ],
};

const STAFF = [
  ['Dr. Sarah Jenkins', 'sarah@orchid.com', '9876543101', 'owner@orchid.com'],
  ['Marcus Aurelius', 'marcus@orchid.com', '9876543102', 'owner@orchid.com'],
  ['Elena Rosseau', 'elena@orchid.com', '9876543103', 'owner@orchid.com'],
  ['James Oliver', 'james@aura.com', '9876543104', 'owner@aura.com'],
  ['Kabir Anand', 'kabir@aura.com', '9876543105', 'owner@aura.com'],
  ['Tina Miller', 'tina@vibe.com', '9876543106', 'owner@vibe.com'],
  ["Rhea D'Souza", 'rhea@vibe.com', '9876543107', 'owner@vibe.com'],
  ['Dr. Anjali Kulkarni', 'anjali@serenity.com', '9876543108', 'owner@serenity.com'],
  ['Feng Lin', 'feng@serenity.com', '9876543109', 'owner@serenity.com'],
  ['Natasha Pinto', 'natasha@blush.com', '9876543110', 'owner@blush.com'],
  ['Zoya Khan', 'zoya@blush.com', '9876543111', 'owner@blush.com'],
  ['Ishita Bose', 'ishita@blush.com', '9876543112', 'owner@blush.com'],
];

const REVIEWS = [
  'Absolutely loved it — the staff were punctual and the result lasted weeks.',
  'Great ambience and very professional service. Will definitely rebook.',
  'Good service overall, though the wait was a little longer than expected.',
  'Best salon experience I have had in the city. Highly recommended!',
  'Relaxing session, my skin feels fantastic. Slightly pricey but worth it.',
  'Friendly therapist and a very clean studio. Booking again next month.',
  'Decent experience. The styling was nice but parking is a hassle.',
  'Fantastic attention to detail — they remembered my preferences from last time.',
  'Value for money. The head massage alone is worth the visit.',
  'Superb finish and very hygienic setup. My go-to place now.',
];
const SALON_REPLIES = [
  'Thank you so much! We look forward to seeing you again.',
  'Thanks for the feedback — we have shared it with the team.',
];

// ── Seeder ─────────────────────────────────────────────────────────────────

const PAST_DAYS = 42;   // history window
const FUTURE_DAYS = 10; // upcoming window
// Daily anchor slots per staff. 3h spacing: every seeded service (≤150 min)
// fits without overlapping the next slot — the double-booking index and the
// conflict checker both stay satisfied.
const SLOT_TIMES = ['10:00', '13:00', '16:00'];

const seedSampleData = async () => {
  const { Salons, Staff, Services, StaffServices, User, Payment, Appointment, Favorite, FavoriteStaff, PromoCode } = require('../models/associations');
  const Notification = require('../models/notificationModel');
  const Waitlist = require('../models/waitlistModel');

  if ((await Salons.count()) > 0) {
    logger.info('seed: salons already present, skipping');
    return false;
  }

  logger.info('seed: database is empty — loading demo dataset…');
  const rng = mulberry32(20260901);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  // 1. Passwords (documented in SAMPLE_DATA.md).
  const customerPass = await bcrypt.hash('customer123', 10);
  const salonPass = await bcrypt.hash('salon123', 10);
  const staffPass = await bcrypt.hash('staff123', 10);

  // 2. Customers — free demo accounts, spread over the last ~5 months.
  const users = [];
  for (let i = 0; i < CUSTOMERS.length; i++) {
    const [name, email, phone] = CUSTOMERS[i];
    users.push(await User.create({
      name, email, password: customerPass, phoneNumber: phone,
      createdAt: addDays(new Date(), -(150 - i * 11)),
    }));
  }

  // 3. Salons.
  const salonsByEmail = {};
  for (const s of SALONS) {
    salonsByEmail[s.email] = await Salons.create({ ...s, password: salonPass, statusbar: 'active' });
  }

  // 4. Services (+ archive flag) and staff.
  const servicesByStaff = {}; // staffEmail -> [service rows]
  const serviceRows = {};     // service name -> row (names are unique in the dataset)
  for (const [salonEmail, list] of Object.entries(SERVICES)) {
    const salon = salonsByEmail[salonEmail];
    for (const spec of list) {
      const svc = await Services.create({
        name: spec.name, price: spec.price, duration: spec.duration,
        category: spec.category, statusbar: 'active', salonId: salon.id,
        archivedAt: spec.archived ? addDays(new Date(), -20) : null,
      });
      serviceRows[spec.name] = svc;
      for (const staffEmail of spec.by) {
        (servicesByStaff[staffEmail] = servicesByStaff[staffEmail] || []).push(svc);
      }
    }
  }
  const staffByEmail = {};
  for (const [name, email, phone, salonEmail] of STAFF) {
    staffByEmail[email] = await Staff.create({
      name, email, password: staffPass, phoneNumber: phone,
      statusbar: 'active', salonId: salonsByEmail[salonEmail].id,
    });
  }
  // StaffServices join rows come from the same `by` lists above.
  for (const list of Object.values(SERVICES)) {
    for (const spec of list) {
      for (const staffEmail of spec.by) {
        await StaffServices.create({ staffId: staffByEmail[staffEmail].id, serviceId: serviceRows[spec.name].id });
      }
    }
  }

  // 5. Promo codes — a mix of live platform-wide, salon-specific, and one
  //    expired code so the validation-failure paths are demonstrable.
  const now = new Date();
  await PromoCode.bulkCreate([
    { code: 'WELCOME10', discountType: 'percent', discountValue: 10, maxDiscountAmount: 300, minOrderAmount: 500, validFrom: addDays(now, -60), validUntil: addDays(now, 180), usageLimit: 500, usedCount: 42 },
    { code: 'FLAT100', discountType: 'flat', discountValue: 100, minOrderAmount: 1500, validFrom: addDays(now, -30), validUntil: addDays(now, 90), usageLimit: 100, usedCount: 7 },
    { code: 'ORCHID15', discountType: 'percent', discountValue: 15, maxDiscountAmount: 750, minOrderAmount: 0, salonId: salonsByEmail['owner@orchid.com'].id, validFrom: addDays(now, -45), validUntil: addDays(now, 120), usageLimit: 200, usedCount: 18 },
    { code: 'SPADAY20', discountType: 'percent', discountValue: 20, maxDiscountAmount: 1500, minOrderAmount: 3000, salonId: salonsByEmail['owner@serenity.com'].id, validFrom: addDays(now, -10), validUntil: addDays(now, 60), usageLimit: 50, usedCount: 5 },
    { code: 'NEWYEAR25', discountType: 'percent', discountValue: 25, maxDiscountAmount: 1000, minOrderAmount: 0, validFrom: addDays(now, -400), validUntil: addDays(now, -190), usageLimit: 300, usedCount: 211 },
  ]);

  // 6. Booking history + payment ledger.
  //    Each staff gets a sparse, conflict-free pattern of slots on open days.
  //    Past bookings are mostly completed (many rated/reviewed), some
  //    cancelled/no-show; future ones are confirmed (or pending at the
  //    approval-required salon). Every booking has a matching successful
  //    Payment row linked by orderId — analytics dashboards get real numbers.
  const staffBySalon = {};
  for (const [email, staff] of Object.entries(staffByEmail)) {
    const salonId = staff.salonId;
    (staffBySalon[salonId] = staffBySalon[salonId] || []).push({ email, staff });
  }

  const promoSpecs = [
    { code: 'WELCOME10', pct: 0.10, cap: 300 },
    { code: 'ORCHID15', pct: 0.15, cap: 750 },
  ];
  let created = 0;
  const salonRatings = {}; // salonId -> [ratings]
  const completedByUser = {}; // userId -> count
  const upcomingForNotify = []; // {appt, service, salonId, userId, date, time}

  const salonList = Object.values(salonsByEmail);
  for (const salon of salonList) {
    const open = new Set(salon.workingDays || dayNames);
    const requiresApproval = !!salon.requiresApproval;
    for (const { email, staff } of staffBySalon[salon.id]) {
      const services = servicesByStaff[email] || [];
      if (services.length === 0) continue;
      for (let dayOffset = -PAST_DAYS; dayOffset <= FUTURE_DAYS; dayOffset++) {
        const date = addDays(now, dayOffset);
        if (!open.has(dayNames[date.getDay()])) continue;
        const ymdStr = ymd(date);
        const slotsPerDay = dayOffset < 0 ? (rng() < 0.55 ? 2 : rng() < 0.5 ? 1 : 0) : (rng() < 0.5 ? 1 : 0);
        const usedSlots = new Set();
        for (let s = 0; s < slotsPerDay; s++) {
          let slot = SLOT_TIMES[Math.floor(rng() * SLOT_TIMES.length)];
          if (usedSlots.has(slot)) continue;
          usedSlots.add(slot);
          const service = services[Math.floor(rng() * services.length)];
          const endTime = addMinutes(slot, service.duration);
          const user = users[Math.floor(rng() * users.length)];
          const createdAt = addDays(atTime(ymdStr, slot), dayOffset < 0 ? 0 : -1);
          if (createdAt > now) createdAt.setTime(now.getTime() - 3600_000);

          // Status mix.
          let status = 'confirmed';
          let cancelledAt = null, cancellationReason = null, cancellationNote = null;
          if (dayOffset < 0) {
            const roll = rng();
            if (roll < 0.10) {
              status = 'cancelled';
              cancelledAt = atTime(ymdStr, slot);
              cancellationReason = pick(['schedule-conflict', 'no-longer-needed', 'found-elsewhere', 'unhappy-with-service', 'other']);
              if (cancellationReason === 'other') cancellationNote = 'Something urgent came up at work.';
            } else if (roll < 0.16) {
              status = 'no-show';
            } else {
              status = 'completed';
            }
          } else if (requiresApproval) {
            status = 'pending';
          }

          // Payment first (order → capture → booking), amounts from the
          // authoritative service price with occasional promo/tip.
          const orderId = 'ORDER-' + crypto.randomBytes(8).toString('hex');
          const originalAmount = Number(service.price);
          let discountAmount = 0, promoCodeApplied = null, orderAmount = originalAmount;
          if (dayOffset < 0 && rng() < 0.18) {
            const p = salon.email === 'owner@orchid.com' && rng() < 0.6 ? promoSpecs[1] : promoSpecs[0];
            discountAmount = Math.min(Math.round(originalAmount * p.pct), p.cap);
            orderAmount = originalAmount - discountAmount;
            promoCodeApplied = p.code;
          }
          let tipAmount = null;
          if (status === 'completed' && rng() < 0.30) tipAmount = pick([50, 100, 150, 200]);
          if (tipAmount) orderAmount = Number((orderAmount + tipAmount).toFixed(2));

          await Payment.create({
            orderId,
            paymentSessionId: 'seed-history-' + crypto.randomBytes(6).toString('hex'),
            orderAmount, orderCurrency: 'INR',
            originalAmount, discountAmount, promoCodeApplied,
            tipAmount, tipCaptured: 1,
            paymentStatus: 'Success',
            customerID: user.id, dateSelected: ymdStr, timeSelected: slot, endTime,
            staffId: staff.id, salonId: salon.id, serviceId: service.id,
            duration: service.duration,
            createdAt, updatedAt: createdAt,
          });

          // Rating/review on a share of completed visits.
          let rating = null, userReview = null, salonReply = null, pointsAwardedAt = null;
          if (status === 'completed') {
            completedByUser[user.id] = (completedByUser[user.id] || 0) + 1;
            pointsAwardedAt = atTime(ymdStr, '23:00');
            if (rng() < 0.72) {
              rating = rng() < 0.62 ? 5 : rng() < 0.6 ? 4 : rng() < 0.75 ? 3 : 2;
              if (rng() < 0.45) {
                userReview = REVIEWS[(rating * 3 + created) % REVIEWS.length];
                if (rating >= 4 && rng() < 0.4) salonReply = SALON_REPLIES[created % SALON_REPLIES.length];
              }
              (salonRatings[salon.id] = salonRatings[salon.id] || []).push(rating);
            }
          }

          const appt = await Appointment.create({
            staffId: staff.id, salonId: salon.id, serviceId: service.id, userId: user.id,
            date: ymdStr, time: slot, endTime,
            status, rating, userReview, salonReply,
            customerNote: rng() < 0.12 ? pick(['Please use hypoallergenic products.', 'Running about 5 minutes late.', 'First visit — sensitive scalp, gentle please.']) : null,
            partySize: rng() < 0.08 ? 2 : 1,
            orderId,
            pointsAwardedAt,
            cancellationReason, cancellationNote, cancelledAt,
            version: 0,
            createdAt, updatedAt: cancelledAt || createdAt,
          });
          created++;

          if (dayOffset >= 0 && dayOffset <= 3) upcomingForNotify.push({ appt, service, salonId: salon.id, userId: user.id, date: ymdStr, time: slot });
        }
      }
    }
  }

  // 7. Denormalized rating cache (kept in sync with the seeded reviews).
  for (const salon of salonList) {
    const rs = salonRatings[salon.id] || [];
    if (rs.length > 0) {
      const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
      await salon.update({ avgRating: Math.round(avg * 100) / 100, reviewCount: rs.length });
    }
  }

  // 8. Loyalty balances from the seeded completions (10 pts per completed visit).
  for (const user of users) {
    const pts = (completedByUser[user.id] || 0) * 10;
    if (pts > 0) await user.update({ loyaltyPoints: pts, lifetimePointsEarned: pts });
  }

  // 9. Favorites (salons and staff) — round-robin so every salon has fans.
  for (let i = 0; i < 8; i++) {
    await Favorite.create({ userId: users[i].id, salonId: salonList[i % salonList.length].id });
    if (i % 2 === 0) {
      await Favorite.create({ userId: users[i].id, salonId: salonList[(i + 2) % salonList.length].id });
    }
    const staffEmail = STAFF[(i * 3) % STAFF.length][1];
    await FavoriteStaff.create({ userId: users[i].id, staffId: staffByEmail[staffEmail].id });
  }

  // 10. Notifications for the next few days' bookings (salon + customer).
  for (const n of upcomingForNotify.slice(0, 12)) {
    await Notification.create({
      recipientRole: 'salon', recipientId: n.salonId, type: 'booking.new',
      title: 'New booking', body: `${n.service.name} on ${n.date} at ${n.time}`,
      appointmentId: n.appt.id,
    });
    await Notification.create({
      recipientRole: 'customer', recipientId: n.userId, type: 'booking.confirmed',
      title: 'Booking confirmed', body: `Your ${n.service.name} is confirmed for ${n.date} at ${n.time}`,
      appointmentId: n.appt.id, readAt: rng() < 0.3 ? new Date() : null,
    });
  }

  // 11. Waitlist demo — a couple of customers queued at the busiest salon.
  const orchid = salonsByEmail['owner@orchid.com'];
  await Waitlist.create({ salonId: orchid.id, userId: users[3].id, date: ymd(addDays(now, 1)), partySize: 1, status: 'waiting' });
  await Waitlist.create({ salonId: orchid.id, userId: users[7].id, date: ymd(addDays(now, 2)), partySize: 2, status: 'waiting' });

  // 12. One "stuck" payment (Success, no booking) so the customer dashboard's
  //     "payment received, booking syncing…" banner is demonstrable.
  const stuckSvc = (servicesByStaff['sarah@orchid.com'] || [])[0];
  if (stuckSvc) {
    const stuckOrder = 'ORDER-' + crypto.randomBytes(8).toString('hex');
    const stuckDate = ymd(addDays(now, 4));
    await Payment.create({
      orderId: stuckOrder,
      paymentSessionId: 'seed-history-' + crypto.randomBytes(6).toString('hex'),
      orderAmount: Number(stuckSvc.price), orderCurrency: 'INR',
      originalAmount: Number(stuckSvc.price), discountAmount: 0,
      paymentStatus: 'Success',
      customerID: users[0].id, dateSelected: stuckDate, timeSelected: '11:00', endTime: '12:00',
      staffId: staffByEmail['sarah@orchid.com'].id, salonId: orchid.id, serviceId: stuckSvc.id,
      duration: stuckSvc.duration,
    });
  }

  logger.info(`seed: demo dataset loaded — ${users.length} customers, ${salonList.length} salons, ${STAFF.length} staff, ${created} bookings`);
  return true;
};

/** Wipe the demo tables (child → parent). Refused in production. */
const forceClear = async () => {
  if (config.isProduction) throw new Error('seed --force is not allowed in production');
  const { Salons, Staff, Services, StaffServices, User, Payment, Appointment, Favorite, FavoriteStaff, StaffBlockout, PromoCode } = require('../models/associations');
  const Notification = require('../models/notificationModel');
  const Waitlist = require('../models/waitlistModel');
  for (const M of [Appointment, Payment, Favorite, FavoriteStaff, StaffBlockout, Waitlist, Notification, StaffServices, PromoCode, Services, Staff, Salons, User]) {
    await M.destroy({ where: {}, force: true, truncate: false });
  }
  logger.info('seed: existing demo data wiped (--force)');
};

// Standalone runner: `npm run seed [-- --force]`
if (require.main === module) {
  (async () => {
    const force = process.argv.includes('--force');
    try {
      await sequelize.sync();
      const { Salons } = require('../models/associations');
      if (force && (await Salons.count()) > 0) {
        await forceClear();
      }
      const seeded = await seedSampleData();
      if (!seeded) console.log('Database already has salons — nothing to do. Use --force to reseed.');
      await sequelize.close();
      process.exit(0);
    } catch (err) {
      console.error('Seed failed:', err.stack || err.message);
      await sequelize.close().catch(() => {});
      process.exit(1);
    }
  })();
}

module.exports = { seedSampleData, forceClear };
