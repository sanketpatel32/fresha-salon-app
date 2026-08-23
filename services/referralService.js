/**
 * Referral codes (#28).
 *
 * Every customer can have ONE personal code; new signups may cite it and both
 * sides earn loyalty points (see awardReferralBonus in loyaltyService.js).
 *
 * Generation is deliberately LAZY: codes are assigned the first time a user
 * asks for one (GET /api/user/referral or GET /api/user/loyalty), never at
 * signup, so account creation stays fast and most users never pay for a code
 * they'll never share.
 */
const crypto = require('crypto');
const User = require('../models/userModel');
const logger = require('../utils/logger');

// 32 unambiguous characters — no 0/O and no 1/I, so a code read aloud or
// typed from paper survives lookalike confusion. 32 also divides 256 evenly,
// so mapping one random byte per character via `% 32` has NO modulo bias.
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERRAL_CODE_LENGTH = 8;
const MAX_GENERATION_ATTEMPTS = 5;

/**
 * One random 8-character code, e.g. "K7QW2M9X". Pure randomness — no
 * user-derived data, so codes leak nothing about their owner.
 */
const generateReferralCode = () => {
  const bytes = crypto.randomBytes(REFERRAL_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length];
  }
  return code;
};

/**
 * Lazily assign a unique code to a user if they don't have one yet, then
 * return it (existing or freshly minted). Idempotent by design: repeated
 * calls for the same user always return the same value.
 *
 * Collision handling is belt-and-braces for a 32^8 keyspace: each attempt
 * re-checks the table AND catches a lost unique-index race on save, retrying
 * up to MAX_GENERATION_ATTEMPTS before giving up.
 *
 * Never throws into the caller's flow (mirrors notificationService/
 * loyaltyService contract): returns the code string, or null if assignment
 * ultimately failed.
 */
const ensureReferralCode = async (user) => {
  try {
    if (!user || !user.id) return null;
    if (user.referralCode) return user.referralCode;

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
      const code = generateReferralCode();
      // Cheap pre-check so the happy path never relies on an error branch.
      const clash = await User.findOne({ where: { referralCode: code } });
      if (clash) continue;

      user.referralCode = code;
      try {
        await user.save();
        return user.referralCode;
      } catch (saveErr) {
        // Unique-index race lost between findOne and save — reset the field
        // so the instance stays clean and roll another code.
        logger.warn('Referral code collision on save, retrying:', saveErr.message);
        user.referralCode = null;
      }
    }
    logger.error(`Could not assign a referral code to user ${user.id} after ${MAX_GENERATION_ATTEMPTS} attempts`);
    return null;
  } catch (err) {
    logger.error('Referral code assignment failed:', err.message);
    return null;
  }
};

module.exports = { generateReferralCode, ensureReferralCode, REFERRAL_ALPHABET, REFERRAL_CODE_LENGTH };
