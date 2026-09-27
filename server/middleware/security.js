/**
 * EstateLead - SecureEstate Security Middleware
 * Provides Input Sanitization (XSS Prevention), Password Strength Policies,
 * Rate Limiting (Brute-Force & Anti-Spam), and Role-Based PII Data Masking.
 */
const rateLimit = require('express-rate-limit');
const validator = require('validator');

function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required.' };
  }
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long.' };
  }
  if (!/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one digit or special character.' };
  }
  return { valid: true };
}

function sanitizeInput(str) {
  if (typeof str !== 'string') return str;
  return validator.escape(str.trim());
}

function maskLeadData(lead, user) {
  if (!lead) return lead;
  const isCopy = { ...lead };

  const hasFullAccess =
    user && (user.role === 'admin' || (user.role === 'agent' && (lead.assigned_agent_id === user.id || lead.assigned_to === user.id)));

  if (!hasFullAccess) {
    if (isCopy.phone) {
      const cleanPhone = String(isCopy.phone).replace(/[\s-]/g, '');
      if (cleanPhone.length > 5) {
        isCopy.phone = cleanPhone.substring(0, 5) + '*****';
      } else {
        isCopy.phone = '*****';
      }
    }
    if (isCopy.email && isCopy.email.includes('@')) {
      const [name, domain] = isCopy.email.split('@');
      isCopy.email = name.charAt(0) + '***@' + domain;
    }
  }

  return isCopy;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    error: 'Too many authentication attempts from this IP. Please wait 15 minutes before trying again.',
    code: 'AUTH_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const enquiryLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 50,
  message: {
    success: false,
    error: 'Form submission rate limit reached. Please wait a few minutes before submitting another request.',
    code: 'SPAM_RATE_LIMIT',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: {
    success: false,
    error: 'API rate limit reached. Please slow down your requests.',
    code: 'API_RATE_LIMIT',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  validatePasswordStrength,
  sanitizeInput,
  maskLeadData,
  authLimiter,
  enquiryLimiter,
  apiLimiter,
};
