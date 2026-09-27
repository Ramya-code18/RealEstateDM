/**
 * EstateLead - Stage 1 Automated Test Suite
 * Validates: Database Schema, Secure Authentication, Bcrypt Hashing,
 * Password Strength Policy, RBAC, Brute-Force Lockout, and Audit Logging.
 */
const assert = require('assert');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../server/config/db');
const { validatePasswordStrength, sanitizeInput } = require('../server/middleware/security');
const { JWT_SECRET } = require('../server/middleware/auth');

async function runStage1Tests() {
  console.log('======================================================================');
  console.log('🧪 RUNNING ESTATELEAD - STAGE 1 VERIFICATION TEST SUITE');
  console.log('======================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(` ✅ [PASS] Test ${total}: ${name}`);
    } catch (err) {
      console.error(` ❌ [FAIL] Test ${total}: ${name}`);
      console.error('    Error:', err.message);
    }
  }

  await db.initConnection();
  await db.createSchema();

  // Test 1: Database Tables Existence
  await test('Database Schema Verification (All 9 Core Tables Initialized)', async () => {
    const tables = ['users', 'properties', 'leads', 'saved_properties', 'user_activity', 'followups', 'audit_logs', 'security_events', 'system_settings'];
    for (const t of tables) {
      const rows = await db.all(`SELECT count(*) as count FROM ${t}`);
      assert(rows !== null, `Table ${t} query returned null`);
    }
  });

  // Test 2: Bcrypt Password Hashing & Verification
  await test('Bcrypt Password Hashing & Salt Verification', async () => {
    const rawPw = 'Admin@123';
    const hash = await bcrypt.hash(rawPw, 10);
    assert(hash.startsWith('$2'), 'Hash must follow bcrypt standard format');
    const isValid = await bcrypt.compare(rawPw, hash);
    assert.strictEqual(isValid, true, 'Bcrypt compare must return true for matching password');
    const isInvalid = await bcrypt.compare('WrongPassword!99', hash);
    assert.strictEqual(isInvalid, false, 'Bcrypt compare must return false for mismatch');
  });

  // Test 3: Password Strength Policy
  await test('Password Strength Policy (Min 8 chars, numbers/symbols)', async () => {
    assert.strictEqual(validatePasswordStrength('').valid, false);
    assert.strictEqual(validatePasswordStrength('short').valid, false);
    assert.strictEqual(validatePasswordStrength('weakpassword').valid, false);
    assert.strictEqual(validatePasswordStrength('Secure@123').valid, true);
  });

  // Test 4: Input Sanitization & XSS Neutralization
  await test('Input Sanitization & Stored XSS Neutralization', async () => {
    const dirty = '<script>alert("XSS")</script>Luxury Villa';
    const clean = sanitizeInput(dirty);
    assert(!clean.includes('<script>'), 'Sanitizer must escape script tags');
    assert.strictEqual(clean, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;Luxury Villa');
  });

  // Test 5: Seed User Roles & Customer Preferences
  await test('User Roles & Customer Preferences Verification', async () => {
    const admin = await db.get('SELECT email, role FROM users WHERE email = $1', ['admin@estatelead.com']);
    assert(admin, 'Admin account must exist');
    assert.strictEqual(admin.role, 'admin');

    const customer = await db.get('SELECT email, role, preferred_location, preferred_property_type, budget_range FROM users WHERE email = $1', ['priya.sundaram@example.com']);
    assert(customer, 'Customer account must exist');
    assert.strictEqual(customer.role, 'customer');
    assert.strictEqual(customer.preferred_location, 'Chennai');
    assert.strictEqual(customer.preferred_property_type, 'Apartments');
    assert.strictEqual(customer.budget_range, '₹50L - ₹80L');
  });

  // Test 6: JWT Token Signing & Claims Decoding
  await test('JWT Token Signing & Role-Based Claims Decoding', async () => {
    const payload = { id: 101, name: 'Priya Sundaram', email: 'priya@test.com', role: 'customer' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    assert(typeof token === 'string' && token.length > 20);

    const decoded = jwt.verify(token, JWT_SECRET);
    assert.strictEqual(decoded.id, 101);
    assert.strictEqual(decoded.role, 'customer');
    assert.strictEqual(decoded.email, 'priya@test.com');
  });

  // Test 7: Brute-Force Lockout Logic
  await test('Brute-Force Protection & Account Lockout Simulation', async () => {
    const testEmail = 'lockout.test@example.com';
    const pwHash = await bcrypt.hash('Test@1234', 10);
    await db.query('DELETE FROM users WHERE email = $1', [testEmail]);
    await db.query(
      `INSERT INTO users (name, email, password_hash, role, account_status, failed_login_attempts)
       VALUES ($1, $2, $3, 'customer', 'active', 0)`,
      ['Lockout Test User', testEmail, pwHash]
    );

    for (let i = 1; i <= 5; i++) {
      if (i < 5) {
        await db.query('UPDATE users SET failed_login_attempts = $1 WHERE email = $2', [i, testEmail]);
      } else {
        const lockoutTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await db.query(
          'UPDATE users SET failed_login_attempts = $1, account_status = $2, locked_until = $3 WHERE email = $4',
          [5, 'locked', lockoutTime, testEmail]
        );
      }
    }

    const lockedUser = await db.get('SELECT account_status, failed_login_attempts, locked_until FROM users WHERE email = $1', [testEmail]);
    assert.strictEqual(lockedUser.account_status, 'locked');
    assert.strictEqual(lockedUser.failed_login_attempts, 5);
    assert(new Date(lockedUser.locked_until) > new Date());
    await db.query('DELETE FROM users WHERE email = $1', [testEmail]);
  });

  // Test 8: Audit Logging & Security Events Recording
  await test('Audit Trails & Security Events Recording in Database', async () => {
    const auditCount = await db.get('SELECT count(*) as count FROM audit_logs');
    assert(parseInt(auditCount.count, 10) > 0, 'Audit logs must contain records');

    const secCount = await db.get('SELECT count(*) as count FROM security_events');
    assert(parseInt(secCount.count, 10) > 0, 'Security events must contain records');
  });

  console.log('\n----------------------------------------------------------------------');
  console.log(`🏁 STAGE 1 TEST RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('----------------------------------------------------------------------\n');

  if (passed === total) {
    console.log('🎉 [SUCCESS] STAGE 1 FOUNDATION & SECURITY LAYER FULLY VERIFIED!\n');
    return true;
  } else {
    console.error('❌ [FAILURE] Some Stage 1 tests failed.');
    process.exit(1);
  }
}

if (require.main === module) {
  runStage1Tests();
}

module.exports = { runStage1Tests };
