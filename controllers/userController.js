const userModel = require('../models/userModel'); // Adjust the path as necessary
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const Sequelize = require('sequelize'); 
const crypto = require('crypto');
const logger = require('../utils/logger');
const emailService = require('../services/emailService');

const handleUserSignup = async (req, res) => {
    const { name, email, password, phoneNumber } = req.body;

    try {
        // Check if the user already exists
        const existingUserEmail = await userModel.findOne({ where: { email } });
        const existingUserNumber = await userModel.findOne({ where: { phoneNumber } });
        if (existingUserEmail || existingUserNumber) {
            return res.status(409).json({ message: "User already exists" });
        }

        // Hash the password before storing it
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await userModel.create({ name, email, password: hashedPassword, phoneNumber });

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
// ── Loyalty points (#27) ────────────────────────────────────────────────
// The caller's own balance. Values are coerced with `|| 0` so a legacy row
// that somehow carries NULL (or a row written before the boot backfill ran)
// reads as zero rather than leaking null to the SPA.
const getLoyaltyBalance = async (req, res) => {
    try {
        const user = await userModel.findByPk(req.user.userId, {
            attributes: ['id', 'loyaltyPoints', 'lifetimePointsEarned'],
        });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        return res.status(200).json({
            points: Number(user.loyaltyPoints) || 0,
            lifetimePointsEarned: Number(user.lifetimePointsEarned) || 0,
        });
    } catch (error) {
        logger.error('Error fetching loyalty balance:', error);
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


module.exports = { handleUserLogin, handleUserSignup, searchUsers, getUserProfile, editProfile, forgotPassword, resetPassword, verifyEmail, resendVerification, getLoyaltyBalance };
