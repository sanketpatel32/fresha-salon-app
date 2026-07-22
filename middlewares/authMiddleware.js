const jwt = require('jsonwebtoken');

/**
 * Verify the Bearer token and attach the decoded payload to req.user.
 *
 * The payload is normalized so downstream code can rely on a consistent
 * shape regardless of which login issued it:
 *   req.user.role  -> 'customer' | 'salon' | 'staff' | 'admin'
 *   req.user.id    -> the entity id (userId / salonId / staffId); null for admin
 *
 * The original role-specific keys (userId, salonId, staffId, admin) are also
 * kept on req.user for backward compatibility with existing controller code
 * that reads them directly.
 *
 * Tokens without a `role` claim are rejected — every login now signs one, so
 * a role-less token is either forged or from before the hardening pass.
 *
 * Exported as a callable function (the default export the route files already
 * use as `authMiddleware`), with `.requireRole` attached as a property so new
 * code can do `authMiddleware.requireRole('admin')`.
 */
const isAuth = function isAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded.role) {
            return res.status(403).json({ error: 'Invalid token' });
        }

        // Normalize the entity id under a single key. Admin tokens carry no id.
        const id =
            decoded.userId ?? decoded.salonId ?? decoded.staffId ?? null;

        req.user = {
            ...decoded,
            id, // normalized entity id
            role: decoded.role,
        };
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
};

/**
 * Role guard. Use after isAuth on any route restricted to specific roles.
 *   router.delete('/users/:id', authMiddleware, authMiddleware.requireRole('admin'), deleteUser)
 */
isAuth.requireRole = function requireRole(...roles) {
    return function roleGuard(req, res, next) {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    };
};

module.exports = isAuth;
