'use strict';

const jwt = require('jsonwebtoken');

/**
 * JWT Authentication Middleware
 * Verifies Bearer token on every protected route.
 * Attaches decoded user payload to req.user.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error:   'Authentication required. No token provided.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { email, role, name, iat, exp }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error:   'Session expired. Please log in again.',
      });
    }
    return res.status(401).json({
      success: false,
      error:   'Invalid authentication token.',
    });
  }
}

/**
 * Role-Based Access Guard
 * Use after authMiddleware to restrict by role.
 * Example: router.delete('/...', authMiddleware, requireRole('controller'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error:   `Access denied. Required role: ${roles.join(' or ')}.`,
      });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
