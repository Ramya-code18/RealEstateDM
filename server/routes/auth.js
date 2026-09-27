/**
 * EstateLead - Authentication REST API (SecureEstate Layer)
 * Handles customer registration with personalization preferences, secure bcrypt login,
 * brute-force lockout, JWT token issuance, and audit trail generation.
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const db = require('../config/db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');
const { logAudit, logSecurityEvent } = require('../middleware/audit');
const { authLimiter, sanitizeInput, validatePasswordStrength } = require('../middleware/security');

const MAX_FAILED_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOCKOUT_MINUTES = parseInt(process.env.LOCKOUT_TIME_MINUTES || '15', 10);

router.post('/register', authLimiter, async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  let {
    name,
    email,
    phone,
    password,
    preferred_property_type = 'Apartments',
    preferred_location = 'Chennai',
    budget_range = '₹50L - ₹80L',
    role = 'customer',
  } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Please provide full name, email address, and a secure password.',
      code: 'MISSING_FIELDS',
    });
  }

  name = sanitizeInput(name);
  email = email.trim().toLowerCase();
  phone = phone ? sanitizeInput(phone) : '';
  preferred_property_type = sanitizeInput(preferred_property_type || 'Apartments');
  preferred_location = sanitizeInput(preferred_location || 'Chennai');
  budget_range = sanitizeInput(budget_range || '₹50L - ₹80L');

  if (!validator.isEmail(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }

  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.valid) {
    return res.status(400).json({ success: false, error: pwCheck.message });
  }

  const allowedRoles = ['customer', 'agent'];
  const assignedRole = allowedRoles.includes(role) ? role : 'customer';

  try {
    const existing = await db.get('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with this email address already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await db.query(
      `INSERT INTO users (
        name, email, phone, password_hash, role,
        preferred_property_type, preferred_location, budget_range,
        account_status, failed_login_attempts
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', 0) RETURNING id`,
      [name, email, phone, passwordHash, assignedRole, preferred_property_type, preferred_location, budget_range]
    );

    const newUserId = (result.rows && result.rows[0] && result.rows[0].id) || result.lastID;

    const token = jwt.sign(
      { id: newUserId, name, email, role: assignedRole },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    await logAudit({
      userId: newUserId,
      userName: name,
      userRole: assignedRole,
      action: 'USER_REGISTER',
      entity: 'USER',
      entityId: newUserId,
      result: 'SUCCESS',
      ip,
      details: `New ${assignedRole} registered with preferences: ${preferred_location}, ${preferred_property_type}, ${budget_range}`,
    });

    return res.status(201).json({
      success: true,
      message: 'Account created successfully! Welcome to EstateLead.',
      token,
      user: {
        id: newUserId,
        name,
        email,
        phone,
        role: assignedRole,
        preferred_property_type,
        preferred_location,
        budget_range,
      },
    });
  } catch (error) {
    console.error('Registration Error:', error);
    return res.status(500).json({ success: false, error: 'Registration failed due to a server database error.' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  let { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Please provide both your registered email address and password.' });
  }

  email = email.trim().toLowerCase();

  try {
    const user = await db.get(
      `SELECT id, name, email, phone, password_hash, role, preferred_property_type, preferred_location, budget_range,
              account_status, failed_login_attempts, locked_until
       FROM users WHERE email = $1`,
      [email]
    );

    if (!user) {
      await logSecurityEvent({
        eventType: 'FAILED_LOGIN_UNKNOWN_USER',
        userIdentifier: email,
        description: `Failed login attempt for unknown email: ${email}`,
        severity: 'LOW',
        result: 'FAILED',
        ip,
      });
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    if (user.account_status === 'locked' && user.locked_until && new Date(user.locked_until) > new Date()) {
      const unlockTime = new Date(user.locked_until).toLocaleTimeString();
      await logSecurityEvent({
        eventType: 'LOCKED_ACCOUNT_LOGIN_ATTEMPT',
        userId: user.id,
        userIdentifier: user.email,
        description: `Rejected login: Account locked until ${unlockTime}`,
        severity: 'HIGH',
        result: 'BLOCKED',
        ip,
      });
      return res.status(423).json({
        success: false,
        error: `Security Alert: Your account is temporarily locked. Please try again after ${unlockTime}.`,
        code: 'ACCOUNT_LOCKED',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      const newAttempts = (user.failed_login_attempts || 0) + 1;
      let updateSql = 'UPDATE users SET failed_login_attempts = $1 WHERE id = $2';
      let updateParams = [newAttempts, user.id];

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockoutTime = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        updateSql = 'UPDATE users SET failed_login_attempts = $1, account_status = $2, locked_until = $3 WHERE id = $4';
        updateParams = [newAttempts, 'locked', lockoutTime, user.id];

        await logSecurityEvent({
          eventType: 'BRUTE_FORCE_LOCKOUT',
          userId: user.id,
          userIdentifier: user.email,
          description: `Account automatically locked for ${LOCKOUT_MINUTES} minutes after ${newAttempts} failed password attempts.`,
          severity: 'HIGH',
          result: 'BLOCKED',
          ip,
        });

        await db.query(updateSql, updateParams);

        return res.status(423).json({
          success: false,
          error: `Security Alert: Account has been locked for ${LOCKOUT_MINUTES} minutes due to ${MAX_FAILED_ATTEMPTS} failed attempts.`,
          code: 'ACCOUNT_LOCKED',
        });
      }

      await db.query(updateSql, updateParams);
      await logSecurityEvent({
        eventType: 'FAILED_LOGIN_ATTEMPT',
        userId: user.id,
        userIdentifier: user.email,
        description: `Password mismatch for ${user.email} (Attempt ${newAttempts}/${MAX_FAILED_ATTEMPTS}).`,
        severity: 'MEDIUM',
        result: 'FAILED',
        ip,
      });

      return res.status(401).json({
        success: false,
        error: `Invalid email or password. Warning: ${MAX_FAILED_ATTEMPTS - newAttempts} attempt(s) remaining before lockout.`,
      });
    }

    await db.query(
      'UPDATE users SET failed_login_attempts = 0, account_status = $1, locked_until = NULL WHERE id = $2',
      ['active', user.id]
    );

    let role = user.role;
    if (role === 'sales') role = 'agent';

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    await logAudit({
      userId: user.id,
      userName: user.name,
      userRole: role,
      action: 'LOGIN_SUCCESS',
      entity: 'AUTH',
      entityId: user.id,
      result: 'SUCCESS',
      ip,
      details: `User successfully authenticated as '${role}'.`,
    });

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role,
        preferred_property_type: user.preferred_property_type || 'Apartments',
        preferred_location: user.preferred_location || 'Chennai',
        budget_range: user.budget_range || '₹50L - ₹80L',
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ success: false, error: 'An internal authentication error occurred.' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  return res.json({ success: true, user: req.user });
});

router.put('/profile', authenticate, async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  let { name, phone, preferred_property_type, preferred_location, budget_range } = req.body;

  name = name ? sanitizeInput(name) : req.user.name;
  phone = phone ? sanitizeInput(phone) : req.user.phone;
  preferred_property_type = preferred_property_type ? sanitizeInput(preferred_property_type) : req.user.preferred_property_type;
  preferred_location = preferred_location ? sanitizeInput(preferred_location) : req.user.preferred_location;
  budget_range = budget_range ? sanitizeInput(budget_range) : req.user.budget_range;

  try {
    await db.query(
      `UPDATE users
       SET name = $1, phone = $2, preferred_property_type = $3, preferred_location = $4, budget_range = $5
       WHERE id = $6`,
      [name, phone, preferred_property_type, preferred_location, budget_range, req.user.id]
    );

    await logAudit({
      userId: req.user.id,
      userName: name,
      userRole: req.user.role,
      action: 'PROFILE_UPDATE',
      entity: 'USER',
      entityId: req.user.id,
      result: 'SUCCESS',
      ip,
      details: 'Customer updated personal preferences and profile details.',
    });

    return res.json({
      success: true,
      message: 'Profile preferences updated successfully.',
      user: {
        id: req.user.id,
        name,
        email: req.user.email,
        phone,
        role: req.user.role,
        preferred_property_type,
        preferred_location,
        budget_range,
      },
    });
  } catch (error) {
    console.error('Profile Update Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update profile preferences.' });
  }
});

router.post('/logout', authenticate, async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  await logAudit({
    userId: req.user.id,
    userName: req.user.name,
    userRole: req.user.role,
    action: 'LOGOUT',
    entity: 'AUTH',
    entityId: req.user.id,
    result: 'SUCCESS',
    ip,
    details: 'User logged out and terminated active session token.',
  });

  return res.json({ success: true, message: 'Logged out successfully.' });
});

module.exports = router;
