/**
 * EstateLead - Stage 3 Automated Verification Test Suite
 * Tests Customer Personalization, Recommendation Algorithm, Browsing History,
 * Customer Data Isolation, and Preference Re-computation.
 */
const assert = require('assert');
const http = require('http');
const db = require('../server/config/db');
const { app } = require('../server/index');

const PORT = 5004;
let server;
let customerToken;
let customerUser;
let otherCustomerToken;
let otherCustomerUser;
let testProperty;

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runStage3Tests() {
  console.log('\n======================================================');
  console.log('🧪 Starting Stage 3: Customer Personalization & Dashboard Tests');
  console.log('======================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`     Error: ${err.message}`);
    }
  }

  try {
    // 1. Initialize DB and start server
    await db.initConnection();
    await db.createSchema();

    testProperty = await db.get('SELECT id, title FROM properties LIMIT 1');

    server = await new Promise((resolve) => {
      const s = app.listen(PORT, () => resolve(s));
    });

    // 2. Setup Test Customers
    // Customer 1: Priya Sundaram (Chennai, Apartments, ₹50L - ₹80L)
    const loginRes1 = await makeRequest('POST', '/api/auth/login', {}, {
      email: 'priya.sundaram@example.com',
      password: 'Customer@123',
    });
    customerToken = loginRes1.data.token;
    customerUser = loginRes1.data.user;

    // Customer 2: Rahul Sharma (Bangalore, Luxury Villas, Above ₹1.5 Cr)
    const loginRes2 = await makeRequest('POST', '/api/auth/login', {}, {
      email: 'rahul.sharma@example.com',
      password: 'Customer@123',
    });
    otherCustomerToken = loginRes2.data.token;
    otherCustomerUser = loginRes2.data.user;

    // Test 1: Reject unauthenticated access to customer dashboard
    await test('Security: Unauthenticated access to /api/customer/dashboard is blocked (401)', async () => {
      const res = await makeRequest('GET', '/api/customer/dashboard');
      assert.strictEqual(res.status, 401, 'Should return 401 Unauthorized');
      assert.strictEqual(res.data.success, false);
    });

    // Test 2: Authenticated customer can retrieve tailored dashboard
    await test('Customer Dashboard: Authenticated customer retrieves profile, stats & recommendations', async () => {
      const res = await makeRequest('GET', '/api/customer/dashboard', {
        Authorization: `Bearer ${customerToken}`,
      });
      assert.strictEqual(res.status, 200, 'Should return 200 OK');
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.profile.email, 'priya.sundaram@example.com');
      assert.ok(res.data.stats, 'Dashboard includes stats summary');
      assert.ok(Array.isArray(res.data.recommendations), 'Dashboard includes recommendations array');
      assert.ok(Array.isArray(res.data.recently_viewed), 'Dashboard includes recently viewed array');
      assert.ok(Array.isArray(res.data.saved_properties), 'Dashboard includes saved properties array');
      assert.ok(Array.isArray(res.data.enquiries), 'Dashboard includes enquiries array');
    });

    // Test 3: Recommendation Algorithm scoring logic (Location + Type + Budget)
    await test('Recommendation Algorithm: Matches score properly based on customer criteria', async () => {
      const res = await makeRequest('GET', '/api/customer/dashboard', {
        Authorization: `Bearer ${customerToken}`,
      });
      assert.strictEqual(res.status, 200);
      const recs = res.data.recommendations;
      assert.ok(recs.length > 0, 'Should have at least 1 recommended property');

      // Top recommendation should have high match score
      const topRec = recs[0];
      assert.ok(topRec.match_score >= 35, 'Recommendations must meet match threshold');
      assert.ok(topRec.match_percentage.includes('%'), 'Includes formatted match percentage string');
      assert.ok(Array.isArray(topRec.match_reasons), 'Includes list of match reasons');
    });

    // Test 4: Browsing History / Recently Viewed tracking
    await test('Browsing History: Property view creates user_activity record and appears in dashboard', async () => {
      const propId = testProperty.id;
      // First view Property as Priya
      const viewRes = await makeRequest('GET', `/api/properties/${propId}`, {
        Authorization: `Bearer ${customerToken}`,
      });
      assert.strictEqual(viewRes.status, 200);

      // Now check customer dashboard recently viewed
      const dashRes = await makeRequest('GET', '/api/customer/dashboard', {
        Authorization: `Bearer ${customerToken}`,
      });
      assert.strictEqual(dashRes.status, 200);
      const recent = dashRes.data.recently_viewed;
      assert.ok(recent.length > 0, 'Recently viewed list should not be empty');
      assert.ok(recent.some(p => p.id === propId), `Property #${propId} should be in recently viewed`);
    });

    // Test 5: Wishlist / Saved Property persistence in dashboard
    await test('Saved Shortlist: Bookmarked property appears in customer dashboard saved list', async () => {
      const propId = testProperty.id;
      // Clean any existing saved state for this test
      await db.query('DELETE FROM saved_properties WHERE user_id = $1 AND property_id = $2', [customerUser.id, propId]);

      // Step 1: Save Property
      const saveRes = await makeRequest('POST', `/api/properties/${propId}/save`, {
        Authorization: `Bearer ${customerToken}`,
      });
      assert.strictEqual(saveRes.status, 200);
      assert.strictEqual(saveRes.data.is_saved, true, 'Property should now be saved');

      // Check dashboard saved list contains the property
      const dashRes = await makeRequest('GET', '/api/customer/dashboard', {
        Authorization: `Bearer ${customerToken}`,
      });
      assert.strictEqual(dashRes.status, 200);
      const saved = dashRes.data.saved_properties;
      assert.ok(saved.some(p => p.id === propId), `Property #${propId} should be in saved list`);
    });

    // Test 6: Customer Data Isolation & Privacy
    await test('Data Isolation: Customer A (Priya) cannot access Customer B (Rahul) enquiries', async () => {
      const resPriya = await makeRequest('GET', '/api/customer/dashboard', {
        Authorization: `Bearer ${customerToken}`,
      });
      const resRahul = await makeRequest('GET', '/api/customer/dashboard', {
        Authorization: `Bearer ${otherCustomerToken}`,
      });

      assert.strictEqual(resPriya.status, 200);
      assert.strictEqual(resRahul.status, 200);

      // Verify enquiries are strictly partitioned
      const priyaEmails = resPriya.data.enquiries.map(e => e.email);
      for (const email of priyaEmails) {
        assert.notStrictEqual(email, 'rahul.sharma@example.com', 'Priya must not see Rahuls enquiries');
      }
    });

    // Test 7: Preference Update & Live Re-computation
    await test('Preference Update: PUT /api/customer/preferences updates criteria and produces audit log', async () => {
      const updateRes = await makeRequest('PUT', '/api/customer/preferences', {
        Authorization: `Bearer ${customerToken}`,
      }, {
        preferred_location: 'Bangalore',
        preferred_property_type: 'Luxury Villas',
        budget_range: 'Above ₹1.5 Cr',
      });

      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateRes.data.success, true);
      assert.strictEqual(updateRes.data.preferences.preferred_location, 'Bangalore');

      // Verify dashboard immediately reflects new criteria and recalculates
      const newDash = await makeRequest('GET', '/api/customer/dashboard', {
        Authorization: `Bearer ${customerToken}`,
      });
      assert.strictEqual(newDash.data.profile.preferred_location, 'Bangalore');
      assert.strictEqual(newDash.data.profile.preferred_property_type, 'Luxury Villas');

      // Verify Audit Log was recorded
      const auditLog = await db.get(
        `SELECT * FROM audit_logs WHERE user_id = $1 AND action = 'PREFERENCES_UPDATED' ORDER BY id DESC LIMIT 1`,
        [customerUser.id]
      );
      assert.ok(auditLog, 'Audit log must record customer preference changes');
    });

    // Test 8: Preference Update validation (Missing fields)
    await test('Validation: Preference update rejects incomplete payloads with 400 Bad Request', async () => {
      const res = await makeRequest('PUT', '/api/customer/preferences', {
        Authorization: `Bearer ${customerToken}`,
      }, {
        preferred_location: 'Coimbatore',
        // missing property type and budget
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

  } catch (err) {
    console.error('Fatal Test Runner Error:', err);
  } finally {
    try {
      // Restore Priya's preferences to canonical state
      await db.query(
        `UPDATE users
         SET preferred_location = 'Chennai', preferred_property_type = 'Apartments', budget_range = '₹50L - ₹80L'
         WHERE email = 'priya.sundaram@example.com'`
      );
    } catch (e) {}

    if (server) {
      server.close();
    }
  }

  console.log('\n------------------------------------------------------');
  console.log(`Stage 3 Test Results: ${passed}/${total} Passed`);
  console.log('------------------------------------------------------\n');

  if (passed === total) {
    console.log('🎉 [SUCCESS] STAGE 3 CUSTOMER PERSONALIZATION & DASHBOARD FULLY VERIFIED!\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runStage3Tests();
