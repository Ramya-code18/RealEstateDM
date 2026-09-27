/**
 * EstateLead - User Management REST API (SecureEstate Layer)
 * Supports role-based user management, agent roster listings for CRM assignments,
 * and administrative account lockout controls.
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const validator = require('validator');
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { sanitizeInput, validatePasswordStrength } = require('../middleware/security');

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const roleFilter = req.query.role;
    let queryText = `
      SELECT id, name, email, phone, role, preferred_property_type, preferred_location, budget_range,
             account_status, failed_login_attempts, locked_until, created_at
      FROM users
    `;
    const params = [];

    if (roleFilter) {
      queryText += ' WHERE role = $1';
      params.push(roleFilter);
    }

    queryText += ' ORDER BY id ASC';

    const users = await db.all(queryText, params);

    return res.json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    console.error('Fetch Users Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve user list.' });
  }
});

router.get('/agents', authenticate, requireRole(['admin', 'agent']), async (req, res) => {
  try {
    const agents = await db.all(
      `SELECT id, name, email, phone, role, account_status
       FROM users
       WHERE (role = 'agent' OR role = 'sales' OR role = 'admin') AND account_status = 'active'
       ORDER BY name ASC`
    );

    return res.json({
      success: true,
      agents,
    });
  } catch (error) {
    console.error('Fetch Agents Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve agent list.' });
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  let { name, email, password, phone = '', role = 'agent', preferred_location = 'Chennai', preferred_property_type = 'Apartments', budget_range = '₹50L - ₹80L' } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, error: 'Please provide name, email, and password.' });
  }

  name = sanitizeInput(name);
  email = email.trim().toLowerCase();
  phone = sanitizeInput(phone);

  if (!validator.isEmail(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email format.' });
  }

  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.valid) {
    return res.status(400).json({ success: false, error: pwCheck.message });
  }

  const validRoles = ['admin', 'agent', 'customer'];
  const userRole = validRoles.includes(role) ? role : 'agent';

  try {
    const existing = await db.get('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) {
      return res.status(409).json({ success: false, error: 'A user with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await db.query(
      `INSERT INTO users (
        name, email, phone, password_hash, role,
        preferred_property_type, preferred_location, budget_range,
        account_status, failed_login_attempts
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', 0) RETURNING id`,
      [name, email, phone, passwordHash, userRole, preferred_property_type, preferred_location, budget_range]
    );

    const newUserId = (result.rows && result.rows[0] && result.rows[0].id) || result.lastID;

    await logAudit({
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'USER_CREATE',
      entity: 'USER',
      entityId: newUserId,
      result: 'SUCCESS',
      ip,
      details: `Admin created user account '${name}' (${email}) with role '${userRole}'.`,
    });

    return res.status(201).json({
      success: true,
      message: `${userRole.toUpperCase()} account created successfully.`,
      userId: newUserId,
    });
  } catch (error) {
    console.error('Create User Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create user account.' });
  }
});

router.put('/:id/status', authenticate, requireRole('admin'), async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const targetId = req.params.id;
  const { account_status } = req.body;

  try {
    const target = await db.get('SELECT id, name, email FROM users WHERE id = $1', [targetId]);
    if (!target) {
      return res.status(404).json({ success: false, error: 'User account not found.' });
    }

    const newStatus = account_status === 'locked' ? 'locked' : 'active';
    const lockedUntil = newStatus === 'locked' ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null;
    const failedAttempts = newStatus === 'active' ? 0 : 5;

    await db.query(
      'UPDATE users SET account_status = $1, locked_until = $2, failed_login_attempts = $3 WHERE id = $4',
      [newStatus, lockedUntil, failedAttempts, targetId]
    );

    await logAudit({
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'USER_STATUS_CHANGE',
      entity: 'USER',
      entityId: targetId,
      result: 'SUCCESS',
      ip,
      details: `Admin changed account status of '${target.name}' to '${newStatus}'.`,
    });

    return res.json({
      success: true,
      message: `User account '${target.name}' status set to '${newStatus}'.`,
    });
  } catch (error) {
    console.error('Update User Status Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update account status.' });
  }
});

module.exports = router;
