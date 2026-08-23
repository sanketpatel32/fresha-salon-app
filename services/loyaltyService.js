/**
 * Loyalty points service (#27).
 *
 * Rule: every appointment that transitions to `completed` earns its customer
 * a FLAT POINTS_PER_APPOINTMENT. Appointments carry no price data (see the
 * CSV-export note in controllers/appointmentController.js — services are
 * mutable and payments don't join reliably), so there is no trustworthy order
 * amount to scale by; points are deliberately per booking regardless of
 * partySize.
 *
 * Exactly-once: the FIRST thing an award does is stamp the appointment's
 * nullable pointsAwardedAt. If the stamp is already set — a replayed request,
 * a retried webhook, any future second caller — it bails before touching the
 * balance. Claim-first ordering means a crash between the two writes can only
 * UNDER-award once (logged), never double-award.
 *
 * Contract mirrors notificationService: this function NEVER throws into the
 * caller's flow; every failure is caught and logged so a broken points ledger
 * can never undo an already-successful status change.
 */
const User = require('../models/userModel');
const logger = require('../utils/logger');

const POINTS_PER_APPOINTMENT = 10;

// Referral bonus (#28): both sides get this once, the moment the referred
// account is created. Instant and simple — no completion tracking.
const REFERRAL_BONUS_POINTS = 100;

/**
 * Award completion points for an appointment, exactly once.
 * Safe to await: never rejects. Returns { awarded } with the number of points
 * actually granted this call (0 when skipped or failed).
 */
const awardForCompletedAppointment = async (appointment) => {
  try {
    if (!appointment || !appointment.userId) return { awarded: 0 };
    // Idempotency claim — a replayed/concurrent call loses this race and no-ops.
    if (appointment.pointsAwardedAt) return { awarded: 0 };

    appointment.pointsAwardedAt = new Date();
    await appointment.save();

    // Atomic SQL increments on both the balance and the audit counter. A user
    // row that vanished mid-flight simply affects 0 rows (no throw).
    await User.increment(
      { loyaltyPoints: POINTS_PER_APPOINTMENT, lifetimePointsEarned: POINTS_PER_APPOINTMENT },
      { where: { id: appointment.userId } }
    );

    // Fire-and-forget in-app notification (never awaited): unknown types fall
    // through NotificationsPanel's generic-bell fallback on the frontend.
    const { notify } = require('./notificationService');
    notify({
      recipientRole: 'customer',
      recipientId: appointment.userId,
      type: 'loyalty.earned',
      title: `You earned ${POINTS_PER_APPOINTMENT} points`,
      body: 'Your completed booking earned you loyalty points.',
      appointmentId: appointment.id,
    }).catch(() => { }); // notify swallows its own errors; belt-and-braces

    return { awarded: POINTS_PER_APPOINTMENT };
  } catch (err) {
    // Swallowed exactly like the promo usedCount increment / tipCaptured flip:
    // one missed award under-reports, but must never break the transition.
    logger.error('Loyalty award failed:', err.message);
    return { awarded: 0 };
  }
};

/**
 * Award the referral bonus to BOTH sides of a referral, exactly at signup of
 * the referred account (no completion tracking — instant by design).
 *
 * Called fire-and-forget from customer signup AFTER the new user row exists,
 * so it must never throw into the signup flow: every failure is caught and
 * logged, and the worst case is a silently missed bonus.
 */
const awardReferralBonus = async (newUserId, referrerUserId) => {
  try {
    if (!newUserId || !referrerUserId || newUserId === referrerUserId) {
      return { awarded: 0 };
    }

    // One atomic increment across both rows — balance AND audit counter, in
    // lockstep with awardForCompletedAppointment's ledger semantics. A row
    // that vanished mid-flight simply affects 0 rows (no throw).
    await User.increment(
      { loyaltyPoints: REFERRAL_BONUS_POINTS, lifetimePointsEarned: REFERRAL_BONUS_POINTS },
      { where: { id: [newUserId, referrerUserId] } }
    );

    // Fire-and-forget notifications for both parties (never awaited; unknown
    // types fall through NotificationsPanel's generic-bell fallback safely).
    const { notify } = require('./notificationService');
    notify({
      recipientRole: 'customer',
      recipientId: referrerUserId,
      type: 'referral.bonus',
      title: `You earned ${REFERRAL_BONUS_POINTS} points`,
      body: 'A friend signed up with your referral code.',
    }).catch(() => { });
    notify({
      recipientRole: 'customer',
      recipientId: newUserId,
      type: 'referral.bonus',
      title: `You earned ${REFERRAL_BONUS_POINTS} points`,
      body: 'Welcome bonus for joining with a referral code.',
    }).catch(() => { });

    return { awarded: REFERRAL_BONUS_POINTS };
  } catch (err) {
    logger.error('Referral bonus award failed:', err.message);
    return { awarded: 0 };
  }
};

module.exports = { awardForCompletedAppointment, awardReferralBonus, POINTS_PER_APPOINTMENT, REFERRAL_BONUS_POINTS };
