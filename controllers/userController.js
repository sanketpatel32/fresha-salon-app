const userModel = require('../models/userModel'); // Adjust the path as necessary
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const Sequelize = require('sequelize'); 
const crypto = require('crypto');
const logger = require('../utils/logger');
const emailService = require('../services/emailService');
const { ensureReferralCode } = require('../services/referralService');
const { awardReferralBonus } = require('../services/loyaltyService');
const appointmentModel = require('../models/appointmentModel');
const favoriteModel = require('../models/favoriteModel');
const waitlistModel = require('../models/waitlistModel');
const notificationModel = require('../models/notificationModel');
const { recordAudit } = require('../services/adminAuditService');

const handleUserSignup = async (req, res) => {
    const { name, email, password, phoneNumber, referralCode } = req.body;

    try {
        // Check if the user already exists
        const existingUserEmail = await userModel.findOne({ where: { email } });
        const existingUserNumber = await userModel.findOne({ where: { phoneNumber } });
        if (existingUserEmail || existingUserNumber) {
            return res.status(409).json({ message: "User already exists" });
        }

        // Referral (#28): resolve the cited code BEFORE the create so
        // referredByUserId lands atomically with the row. Best-effort by
        // contract — an unknown/garbage code is silently ignored and a lookup
        // failure must never block signup. Stored codes are always uppercase
        // and the schema uppercased the input, so this equality IS the
        // case-insensitive match; the email comparison guards the (normally
        // impossible) self-referral defensively.
        let referrer = null;
        try {
            if (referralCode) {
                const found = await userModel.findOne({
                    where: { referralCode: String(referralCode).trim().toUpperCase() },
                });
                if (found && String(found.email).toLowerCase() !== String(email).toLowerCase()) {
                    referrer = found;
                }
            }
        } catch (refErr) {
            logger.error('Referral resolution failed (signup proceeds unlinked):', refErr);
            referrer = null;
        }

        // Hash the password before storing it
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await userModel.create({
            name, email, password: hashedPassword, phoneNumber,
            referredByUserId: referrer ? referrer.id : null,
        });

        // Referral bonus for BOTH sides — fire-and-forget AFTER the account
        // exists; awardReferralBonus never throws (its own failures are
        // swallowed inside), so a broken ledger can never fail a signup.
        if (referrer) {
            awardReferralBonus(newUser.id, referrer.id)
                .catch((bonusErr) => logger.error('Referral bonus error:', bonusErr));
        }

        // Soft email verification: only issue a token when a mail can
        // actually be sent — otherwise the account is created unverified and
        // the customer can request a link later via /resend-verification.
        if (emailService.isConfigured()) {
            const verificationToken = crypto.randomBytes(32).toString('hex');
            newUser.verificationTokenHash = hashToken(verificationToken);
            newUser.verificationExpiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
            await newUser.save();

            const appUrl = process.env.APP_URL || '';
            const verifyLink = `${appUrl}/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
            // Fire-and-forget: sendVerificationEmail already no-ops and never
            // throws on unconfigured/broken mailers; this catch is belt-and-
            // braces so signup can't be taken down by an unexpected rejection.
            emailService.sendVerificationEmail({
                to: newUser.email,
                name: newUser.name,
                verifyLink,
            }).catch((mailErr) => logger.error('Error sending verification email:', mailErr));
        }

        // Generate JWT token
        const token = jwt.sign({ userId: newUser.id, role: 'customer' }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(201).json({ 
            message: "User created successfully", 
            token, 
            userId: newUser.id,
            // Soft-verified accounts work immediately; the flag lets the
            // frontend nudge toward verifying without gating anything yet.
            emailVerified: Boolean(newUser.emailVerified)
        });
    } catch (err) {
        console.error("Error during signup:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};

const handleUserLogin = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await userModel.findOne({ where: { email } });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Compare the hashed password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Incorrect password" });
        }

        // Generate JWT token
        const token = jwt.sign({ userId: user.id, role: 'customer' }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({ 
            message: "User logged in successfully", 
            token, 
            userId: user.id 
        });
    } catch (err) {
        console.error("Error logging in user:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

// ── Password reset ──────────────────────────────────────────────────────
// Reset links carry a random 256-bit token; only its SHA-256 hash is stored,
// so a leaked database can't be replayed against the live endpoint. Tokens
// expire after 60 minutes and are cleared as soon as a reset succeeds.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const hashResetToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

// ── Email verification ─────────────────────────────────────────────────
// Same hashed-token pattern as password reset, but with a 24-hour window and
// SOFT semantics: an unverified account can still log in, book, and be
// verified later — the flag exists for the frontend / future gating only.
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await userModel.findOne({ where: { email } });
        if (user) {
            const token = crypto.randomBytes(32).toString('hex');
            user.resetTokenHash = hashResetToken(token);
            user.resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
            await user.save();

            const appUrl = process.env.APP_URL || '';
            const resetLink = `${appUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

            // Fire-and-forget: an unconfigured or broken mailer must neither
            // crash this endpoint nor leak whether the account exists.
            await emailService.sendPasswordResetEmail({
                to: user.email,
                name: user.name,
                resetLink,
            });
            logger.info('Password reset requested');
        }

        // Identical response either way — no user enumeration.
        return res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });
    } catch (error) {
        logger.error('Error handling forgot-password:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

const resetPassword = async (req, res) => {
    try {
        const { token, email, newPassword } = req.body;

        const user = await userModel.findOne({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Token must match the stored hash AND still be inside its window.
        const expiresAt = user.resetTokenExpiresAt ? new Date(user.resetTokenExpiresAt).getTime() : 0;
        const valid = Boolean(user.resetTokenHash)
            && user.resetTokenHash === hashResetToken(token)
            && expiresAt > Date.now();
        if (!valid) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        // Same bcrypt cost as signup, then burn the token so it can't be reused.
        user.password = await bcrypt.hash(newPassword, 10);
        user.resetTokenHash = null;
        user.resetTokenExpiresAt = null;
        await user.save();

        logger.info('Password reset completed');
        return res.status(200).json({ message: 'Password updated successfully.' });
    } catch (error) {
        logger.error('Error resetting password:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// Marks the account verified when email + token match the stored hash inside
// the 24h window; the token is burned on success so a link can't be replayed.
// Unknown email, wrong token, and expired token all get the same generic 400
// — no signal about which part failed (or that the account exists).
const verifyEmail = async (req, res) => {
    try {
        const { email, token } = req.body;

        const user = await userModel.findOne({ where: { email } });
        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired verification link' });
        }

        // Token must match the stored hash AND still be inside its window.
        const expiresAt = user.verificationExpiresAt ? new Date(user.verificationExpiresAt).getTime() : 0;
        const valid = Boolean(user.verificationTokenHash)
            && user.verificationTokenHash === hashToken(token)
            && expiresAt > Date.now();
        if (!valid) {
            return res.status(400).json({ error: 'Invalid or expired verification link' });
        }

        user.emailVerified = true;
        user.verificationTokenHash = null;
        user.verificationExpiresAt = null;
        await user.save();

        logger.info('Email verified');
        return res.status(200).json({ message: 'Email verified successfully.' });
    } catch (error) {
        logger.error('Error verifying email:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// Re-issues a verification link. Always answers the same generic 200 whether
// or not the account exists (no enumeration); a known email gets its token
// rotated so an old link stops working as soon as a new one is requested.
const resendVerification = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await userModel.findOne({ where: { email } });
        if (user && emailService.isConfigured()) {
            const token = crypto.randomBytes(32).toString('hex');
            user.verificationTokenHash = hashToken(token);
            user.verificationExpiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
            await user.save();

            const appUrl = process.env.APP_URL || '';
            const verifyLink = `${appUrl}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
            // Fire-and-forget, same contract as signup.
            emailService.sendVerificationEmail({
                to: user.email,
                name: user.name,
                verifyLink,
            }).catch((mailErr) => logger.error('Error sending verification email:', mailErr));
            logger.info('Verification email re-sent');
        }

        // Identical response either way — no user enumeration.
        return res.status(200).json({ message: 'If that email needs verification, a new link has been sent.' });
    } catch (error) {
        logger.error('Error resending verification:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// ── GDPR account self-deletion (#32) ───────────────────────────────────
// Customers can erase their own account. SOFT deletion by design: the user
// row is anonymized IN PLACE instead of destroyed, because Appointments
// reference users via plain integers (no FK) and salon-side booking history
// must stay coherent — a completed booking keeps resolving to a real row.
// Every identifying attribute is scrubbed, so the surviving row identifies
// nobody; subsequent logins fail naturally (the password is replaced with a
// hash of a discarded random value).
const ANONYMIZED_EMAIL_RE = /^deleted\+\d+@anonymized\.local$/;
const ACCOUNT_DELETED_MESSAGE = 'Your account has been deleted.';

const deleteMyAccount = async (req, res) => {
    const userId = req.user.userId;

    try {
        const user = await userModel.findByPk(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Idempotency guard, checked BEFORE the password: an already-
        // anonymized row no longer carries any usable credential (its stored
        // hash belongs to a random value nobody knows), so demanding the old
        // password here could never succeed and would wrongly 401 a replayed
        // request. The early return performs ZERO writes and answers the byte-
        // identical generic 200 of a fresh deletion — no information leaks
        // either way.
        if (ANONYMIZED_EMAIL_RE.test(String(user.email))) {
            return res.status(200).json({ message: ACCOUNT_DELETED_MESSAGE });
        }

        // Re-authentication: the caller must prove ownership of the account.
        const { password } = req.body;
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Incorrect password' });
        }

        // Future bookings only — status pending|confirmed AND start strictly
        // after now — expressed as two SQL branches over the LOCAL calendar
        // frame exactly like getUpcomingAppointments (#29). One bulk UPDATE
        // lands these rows in the same end state the cancel path produces
        // (status='cancelled'); PAST rows and every terminal status
        // (completed/declined/cancelled/no-show) are untouched so salon-side
        // history keeps its integrity.
        //
        // DELIBERATE: no notifications fire for these cancellations. The
        // house cancel path notifies the customer + salon (+ waitlist), but
        // this account is being erased — alerting its owner creates fresh
        // personal-data rows we would then have to destroy, and one salon/
        // waitlist ping per erased booking is noise without action. The
        // cancelled rows themselves are visible in the salon's ledger, which
        // is the history-preserving signal.
        const pad = (n) => String(n).padStart(2, '0');
        const now = new Date();
        const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        const [cancelledCount] = await appointmentModel.update(
            { status: 'cancelled' },
            {
                where: {
                    userId,
                    status: { [Sequelize.Op.in]: ['pending', 'confirmed'] },
                    [Sequelize.Op.or]: [
                        { date: { [Sequelize.Op.gt]: today } },
                        { date: today, time: { [Sequelize.Op.gt]: nowTime } },
                    ],
                },
            }
        );

        // Personal-data cleanup FIRST, anonymization LAST: if any step below
        // fails, the account still carries its original email/password, the
        // caller gets a clean 500, and every step is safe to simply redo on
        // retry. Once the final anonymization lands, all cleanup has already
        // happened (and the idempotency guard above makes further calls no-ops).

        // Favorites are pure personal data — destroyed outright.
        await favoriteModel.destroy({ where: { userId } });

        // Waitlist entries go soft-'left' (rows kept, per that table's
        // lifecycle): 'left' never blocks anything and keeps salon day-sheets
        // coherent.
        await waitlistModel.update({ status: 'left' }, { where: { userId } });

        // Notifications are personal data — destroyed for THIS recipient
        // identity only (salon notifications belong to salons, not to it).
        await notificationModel.destroy({
            where: { recipientRole: 'customer', recipientId: userId },
        });

        // Anonymize in place. referredByUserId stays (it describes who brought
        // the signup in and does not identify this row); lifetimePointsEarned
        // stays too (a cumulative counter, listed deliberately untouched by
        // the spec — only the spendable balance zeroes).
        user.name = 'Deleted';
        user.email = `deleted+${userId}@anonymized.local`; // unique per id
        // Unusable credential: a random value nobody ever knew, hashed at the
        // same cost as signup. No login can ever succeed against it again.
        user.password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
        // phoneNumber is NOT NULL on this model, so it cannot be nulled — ''
        // is the only PII-free value the column accepts.
        user.phoneNumber = '';
        user.emailVerified = false;
        user.verificationTokenHash = null;
        user.verificationExpiresAt = null;
        user.resetTokenHash = null;
        user.resetTokenExpiresAt = null;
        user.loyaltyPoints = 0;
        user.referralCode = null; // frees the unique code for the living
        await user.save();

        // Audit trail (fire-and-forget, recordAudit contract): this is a
        // CUSTOMER-initiated action, so adminEmail carries an actor descriptor
        // rather than an admin identity, and details carry NO PII — this whole
        // feature exists to scrub identifying data, so writing the old
        // email/name into an append-only log would defeat it.
        recordAudit({
            adminEmail: 'self-service',
            action: 'account.self_delete',
            targetType: 'user',
            targetId: String(userId),
            details: `gdpr self-deletion; ${cancelledCount} future booking(s) cancelled`,
        }).catch(() => { }); // never throws; belt-and-braces for lint

        return res.status(200).json({ message: ACCOUNT_DELETED_MESSAGE });
    } catch (error) {
        logger.error('Error deleting account:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

const searchUsers = async (req, res) => {
    const { query } = req.query; 

    try {
        
        const users = await userModel.findAll({
            where: {
                [Sequelize.Op.or]: [
                    { name: { [Sequelize.Op.like]: `%${query}%` } },
                    { email: { [Sequelize.Op.like]: `%${query}%` } },
                    { phoneNumber: { [Sequelize.Op.like]: `%${query}%` } },
                ],
            },
            attributes: ['id', 'name', 'email', 'phoneNumber'], 
        });

        res.status(200).json({ status: "Success", users });
    } catch (error) {
        console.error("Error searching for users:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
const getUserProfile = async (req, res) => {
    const userId = req.user.userId; 

    try {
        const user = await userModel.findOne({ where: { id: userId } });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        
        delete user.dataValues.password;

        res.status(200).json(user);
    } catch (error) {
        console.error("Error fetching user profile:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
// ── Loyalty points (#27) + referral code (#28) ──────────────────────────
// The caller's own balance. Values are coerced with `|| 0` so a legacy row
// that somehow carries NULL (or a row written before the boot backfill ran)
// reads as zero rather than leaking null to the SPA. The response also
// carries the caller's personal referral code (lazily assigned here on
// first read, so clients can show points and code side by side).
const getLoyaltyBalance = async (req, res) => {
    try {
        // Full instance on purpose: ensureReferralCode may need to save a
        // freshly generated code onto the row.
        const user = await userModel.findByPk(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        const referralCode = await ensureReferralCode(user);
        return res.status(200).json({
            points: Number(user.loyaltyPoints) || 0,
            lifetimePointsEarned: Number(user.lifetimePointsEarned) || 0,
            referralCode: referralCode || null,
        });
    } catch (error) {
        logger.error('Error fetching loyalty balance:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// ── Referral code (#28) ────────────────────────────────────────────────
// The caller's personal code, assigned lazily on first request (generation
// never happens at signup). APP_URL is the existing base-URL convention used
// for building frontend links (verification / password-reset emails), so when
// it is set the response gains a ready-to-share signup link; unset → the
// field is omitted entirely rather than sent as a broken relative URL.
const getMyReferralCode = async (req, res) => {
    try {
        const user = await userModel.findByPk(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const code = await ensureReferralCode(user);
        if (!code) {
            logger.error(`Referral assignment failed for user ${req.user.userId}`);
            return res.status(500).json({ message: 'Internal server error' });
        }

        const payload = { referralCode: code };
        const appUrl = process.env.APP_URL || '';
        if (appUrl) {
            payload.referralUrl = `${appUrl.replace(/\/+$/, '')}/user/signup?ref=${code}`;
        }
        return res.status(200).json(payload);
    } catch (error) {
        logger.error('Error fetching referral code:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

const editProfile = async (req, res) => {
    const userId = req.user.userId; // Get the user ID from the JWT token
    const { name, email, phoneNumber } = req.body;

    try {
        const user = await userModel.findOne({ where: { id: userId } });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Update user details
        user.name = name;
        user.email = email;
        user.phoneNumber = phoneNumber;

        await user.save();

        res.status(200).json({ message: "Profile updated successfully", user });
    } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};


module.exports = { handleUserLogin, handleUserSignup, searchUsers, getUserProfile, editProfile, forgotPassword, resetPassword, verifyEmail, resendVerification, getLoyaltyBalance, getMyReferralCode, deleteMyAccount };
