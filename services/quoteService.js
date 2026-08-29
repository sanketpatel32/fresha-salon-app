/**
 * Price quotes (#56) — the total, before the customer commits.
 *
 * Before this, the checkout panel could only show the service price, and the
 * real total (promo discount, tip, group size) appeared for the first time at
 * the payment gateway. That's the worst possible moment to learn a booking
 * costs more than you thought.
 *
 * The rule this module exists to enforce: **the quote and the charge must be
 * computed by the same code**. A second, parallel implementation of discount
 * math would drift from the real one within a sprint — and a quote that
 * disagrees with the charge is worse than no quote at all, because it's a
 * promise the app breaks. So the price comes from
 * `getAuthoritativePrice` and the discount from `resolvePromo`, the exact
 * functions `POST /pay` uses.
 *
 * Amounts are integer minor units (paise) throughout — see utils/money.js
 * (#49). The response exposes both: minor units for arithmetic, and
 * human-formatted strings for display, so no client ever re-derives them.
 */
const servicesModel = require('../models/servicesModel');
const salonModel = require('../models/salonsModel');
const staffModel = require('../models/staffModel');
const money = require('../utils/money');
const { getAuthoritativePrice, resolvePromo, round2 } = require('./paymentService');

/** Human labels for each line of the breakdown. */
const QUOTE_LINES = Object.freeze({
  base: 'Service',
  discount: 'Promo discount',
  tip: 'Tip',
});

/**
 * Build a pre-payment quote.
 *
 * @param {object} params
 * @param {number} params.salonId
 * @param {number} params.serviceId
 * @param {number} [params.staffId]
 * @param {string} [params.promoCode]
 * @param {number} [params.tipAmount]  major units (e.g. 30 = ₹30)
 * @param {number} [params.partySize]
 * @param {Date}   [params.now]        for promo-window evaluation (tests)
 * @returns {Promise<{ok: true, quote}|{ok: false, code, reason, status}>}
 */
const buildQuote = async ({
  salonId,
  serviceId,
  staffId = null,
  promoCode = null,
  tipAmount = 0,
  partySize = 1,
}) => {
  const salon = await salonModel.findByPk(salonId);
  if (!salon || salon.statusbar === 'inactive') {
    return { ok: false, status: 404, code: 'SALON_NOT_FOUND', reason: 'Salon not found' };
  }

  const service = await servicesModel.findOne({
    where: { id: serviceId, salonId },
  });
  if (!service) {
    return { ok: false, status: 404, code: 'SERVICE_NOT_FOUND', reason: 'Service not found at this salon' };
  }
  // An archived service (#51) still appears in historical reports but must
  // never be quoted — it isn't for sale any more.
  if (service.statusbar === 'archived') {
    return { ok: false, status: 409, code: 'SERVICE_ARCHIVED', reason: 'This service is no longer offered' };
  }

  // The staff member must belong to this salon. Quoting is not booking, so a
  // missing service assignment is not checked here — availability is the
  // booking path's job, and duplicating that rule would be the kind of
  // parallel implementation this module is built to avoid.
  let staff = null;
  if (staffId) {
    staff = await staffModel.findOne({ where: { id: staffId, salonId }, attributes: ['id', 'name'] });
    if (!staff) {
      return { ok: false, status: 404, code: 'STAFF_NOT_FOUND', reason: 'Staff member not found at this salon' };
    }
  }

  // Authoritative price: the same lookup /pay uses, so a client can't talk us
  // into a cheaper quote by posting its own number. Note the signature is
  // (serviceId, salonId) — ids, not rows — and the result is a tagged union
  // ({price} | {mismatch:true} | null), so each branch needs its own answer.
  // Passing the already-loaded `service` row here is the classic mistake:
  // Sequelize's findByPk rejects an instance outright.
  const priceResult = await getAuthoritativePrice(serviceId, salonId);
  if (priceResult === null) {
    return { ok: false, status: 404, code: 'SERVICE_NOT_FOUND', reason: 'Service not found' };
  }
  if (priceResult.mismatch) {
    return { ok: false, status: 400, code: 'SERVICE_SALON_MISMATCH', reason: 'Service does not belong to this salon' };
  }
  const baseMajor = Number(priceResult.price);
  const baseMinor = money.toMinor(String(baseMajor));

  const lines = [
    { label: QUOTE_LINES.base, amountMinor: baseMinor, formatted: money.format(baseMinor) },
  ];

  let discountMinor = 0;
  let promo = null;
  if (promoCode) {
    // resolvePromo works in major units (the payment row's currency), so the
    // discount is converted back to minor units for the ledger below.
    const resolved = await resolvePromo(promoCode, salonId, baseMajor);
    if (!resolved.ok) {
      // A quote MUST NOT silently drop a promo the customer typed. If the code
      // is invalid the customer needs to know now, not at the gateway.
      return { ok: false, status: 400, code: 'PROMO_INVALID', reason: resolved.reason };
    }
    promo = resolved.promo;
    discountMinor = money.toMinor(String(round2(resolved.discountAmount)));
    lines.push({
      label: `${QUOTE_LINES.discount} (${promo.code})`,
      amountMinor: -discountMinor,
      formatted: money.format(-discountMinor),
    });
  }

  // TIP ORDERING: the tip rides ON TOP of the discounted price, exactly as
  // the payment path computes it — a tip is a reward for the service
  // actually received, not a percentage of the list price.
  const tipMinor = tipAmount ? money.toMinor(String(round2(tipAmount))) : 0;
  if (tipMinor > 0) {
    lines.push({ label: QUOTE_LINES.tip, amountMinor: tipMinor, formatted: money.format(tipMinor) });
  }

  // The total can never go negative: a promo worth more than the service is a
  // salon's pricing mistake, and charging a negative amount would be far worse
  // than absorbing the difference.
  const totalMinor = Math.max(0, baseMinor - discountMinor + tipMinor);

  return {
    ok: true,
    quote: {
      salonId,
      salonName: salon.name,
      serviceId,
      serviceName: service.name,
      serviceDurationMinutes: Number(service.duration),
      staffId: staff ? staff.id : null,
      staffName: staff ? staff.name : null,
      partySize,
      currency: money.DEFAULT_CURRENCY,
      lines,
      baseAmount: baseMinor,
      discountAmount: discountMinor,
      tipAmount: tipMinor,
      totalAmount: totalMinor,
      // Per-head is the number that actually answers "is this worth it?" for
      // a group booking, and integer allocation guarantees the parts sum back
      // to the total (see money.allocate).
      perPersonAmount: partySize > 1 ? money.allocate(totalMinor, new Array(partySize).fill(1))[0] : totalMinor,
      formatted: {
        base: money.format(baseMinor),
        discount: money.format(discountMinor),
        tip: money.format(tipMinor),
        total: money.format(totalMinor),
      },
      promoApplied: promo ? { code: promo.code, discountType: promo.discountType } : null,
      // A quote is a promise with an expiry. Prices and promos both move.
      disclaimer: 'Indicative only — the amount charged is confirmed at booking.',
    },
  };
};

module.exports = { buildQuote, QUOTE_LINES };
