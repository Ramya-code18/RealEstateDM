/**
 * EstateLead - Authentication & Authorization Middleware
 * Enforces JWT token verification, Role-Based Access Control (Customer -> Agent -> Admin),
 * and Account Lockout protections.
 */
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'estatelead_jwt_secure_key_2026_super_strong_secret_layer_998877';

async function authenticate(req, res, next) {
  try {
    let token = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: No authentication token provided.',
        code: 'NO_TOKEN',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Session expired or invalid token. Please log in again.',
        code: 'TOKEN_INVALID',
      });
    }

    const user = await db.get(
      `SELECT id, name, email, phone, role, preferred_property_type, preferred_location, budget_range,
              account_status, locked_until
       FROM users WHERE id = $1`,
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: User account does not exist.',
        code: 'USER_NOT_FOUND',
      });
    }

    if (user.account_status === 'locked' && user.locked_until && new Date(user.locked_until) > new Date()) {
      const unlockTime = new Date(user.locked_until).toLocaleTimeString();
      return res.status(403).json({
        success: false,
        error: `Account is temporarily locked due to security policy until ${unlockTime}.`,
        code: 'ACCOUNT_LOCKED',
      });
    }

    let normalizedRole = user.role;
    if (normalizedRole === 'sales') normalizedRole = 'agent';

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: normalizedRole,
      preferred_property_type: user.preferred_property_type || 'Apartments',
      preferred_location: user.preferred_location || 'Chennai',
      budget_range: user.budget_range || '₹50L - ₹80L',
      account_status: user.account_status,
    };

    next();
  } catch (error) {
    console.error('Authentication Middleware Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal authentication service error.',
    });
  }
}

/**
 * Optional authentication middleware - does not reject if unauthenticated,
 * but attaches req.user if a valid token is provided.
 */
async function optionalAuth(req, res, next) {
  try {
    let token = null;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await db.get(
          `SELECT id, name, email, phone, role, preferred_property_type, preferred_location, budget_range,
                  account_status, locked_until
           FROM users WHERE id = $1`,
          [decoded.id]
        );
        if (user && user.account_status === 'active') {
          let normalizedRole = user.role;
          if (normalizedRole === 'sales') normalizedRole = 'agent';
          req.user = {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: normalizedRole,
            preferred_property_type: user.preferred_property_type || 'Apartments',
            preferred_location: user.preferred_location || 'Chennai',
            budget_range: user.budget_range || '₹50L - ₹80L',
          };
        }
      } catch (e) {
        // Token invalid/expired: continue unauthenticated
      }
    }
  } catch (err) {
    // Ignore error
  }
  next();
}

function requireRole(...roles) {
  const flattened = roles.flat();
  const allowedRoles = flattened.length > 0 ? flattened : ['admin'];

  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication is required to access this protected resource.',
        code: 'AUTH_REQUIRED',
      });
    }

    if (req.user.role === 'admin' || allowedRoles.includes(req.user.role)) {
      return next();
    }

    try {
      const { logSecurityEvent } = require('./audit');
      await logSecurityEvent({
        eventType: 'UNAUTHORIZED_RBAC_BLOCKED',
        userId: req.user.id,
        userIdentifier: `${req.user.email} (Role: ${req.user.role})`,
        description: `Access Denied: User with role '${req.user.role}' attempted to access endpoint '${req.originalUrl}' requiring '${allowedRoles.join('/')}'.`,
        severity: 'MEDIUM',
        result: 'BLOCKED',
        ip: req.ip || req.connection.remoteAddress || '127.0.0.1',
      });
    } catch (logErr) {
      console.error('RBAC Violation Log Error:', logErr.message);
    }

    return res.status(403).json({
      success: false,
      error: `Access Forbidden: Your role ('${req.user.role}') is not authorized to perform this action.`,
      code: 'FORBIDDEN_ROLE',
    });
  };
}

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
  authorize: requireRole,
  JWT_SECRET,
};
