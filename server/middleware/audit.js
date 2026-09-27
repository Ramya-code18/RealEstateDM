/**
 * EstateLead - SecureEstate Audit & Security Logging System
 * Records critical user actions, administrative interventions, and threat alerts
 * to guarantee non-repudiation, traceability, and CIA Triad compliance.
 */
const db = require('../config/db');

async function logAudit({
  userId = null,
  userName = 'Anonymous',
  userRole = 'customer',
  action,
  entity,
  entityId = null,
  result = 'SUCCESS',
  ip = '127.0.0.1',
  details = '',
}) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, entity, entity_id, result, ip_address, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, userName, userRole, action, entity, entityId ? String(entityId) : null, result, ip, details]
    );
  } catch (err) {
    console.error('Audit Logging Error:', err.message);
  }
}

async function logSecurityEvent({
  eventType,
  userId = null,
  userIdentifier = 'Anonymous',
  description,
  severity = 'MEDIUM',
  result = 'BLOCKED',
  ip = '127.0.0.1',
}) {
  try {
    await db.query(
      `INSERT INTO security_events (event_type, user_id, user_identifier, description, severity, result, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [eventType, userId, userIdentifier, description, severity, result, ip]
    );
  } catch (err) {
    console.error('Security Event Logging Error:', err.message);
  }
}

module.exports = {
  logAudit,
  logSecurityEvent,
};
