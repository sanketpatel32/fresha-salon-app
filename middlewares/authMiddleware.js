const jwt = require("jsonwebtoken");

const isAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(" ")[1]; // Extract token

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Attach decoded user info to request

        // Decode the token to inspect the expiration time
        const decodedToken = jwt.decode(token);
        const expTime = new Date(decodedToken.exp * 1000); // Convert Unix timestamp to Date
        console.log("Token expires at:", expTime);

        next();
    } catch (error) {
        console.error("JWT Verification Error:", error.message);
        return res.status(403).json({ error: "Invalid token" });
    }
};

module.exports = isAuth;