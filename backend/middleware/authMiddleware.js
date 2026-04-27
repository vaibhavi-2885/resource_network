const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { normalizeRole } = require('../utils/roles');

exports.protect = async (req, res, next) => {
    let token;

    // Check if token exists in Headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // Get token from header (Format: Bearer <token>)
            token = req.headers.authorization.split(' ')[1];

            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Get user from database and attach to the 'req' object
            req.user = await User.findById(decoded.id).select('-password');

            if (!req.user) {
                return res.status(401).json({ message: "Not authorized, user not found" });
            }

            req.user.role = normalizeRole(req.user.role);

            next(); // Move to the next function (The Dashboard)
        } catch (error) {
            res.status(401).json({ message: "Not authorized, token failed" });
        }
    }

    if (!token) {
        res.status(401).json({ message: "Not authorized, no token" });
    }
};

// Gatekeeper for Roles (Admin, NGO, etc.)
exports.authorize = (...roles) => {
    return (req, res, next) => {
        const normalizedRoles = roles.map(normalizeRole);
        if (!normalizedRoles.includes(normalizeRole(req.user.role))) {
            return res.status(403).json({ 
                message: `User role '${req.user.role}' is not authorized to access this route` 
            });
        }
        next();
    };
};
