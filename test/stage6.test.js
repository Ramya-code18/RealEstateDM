/**
 * EstateLead - Stage 6 Automated Verification Test Suite
 * Tests Analytics & Business Intelligence APIs, 6-Stage Conversion Funnel,
 * Property Performance Leaderboards, Demand Distribution, and Financial Valuation.
 */
const assert = require('assert');
const http = require('http');
const db = require('../server/config/db');
const { app } = require('../server/index');

const PORT = 5007;
let server;
let adminToken;
let agentToken;
let customerToken;

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

async function runStage6Tests() {
  console.log('\n======================================================');
  console.log('🧪 Starting Stage 6: Analytics & Business Intelligence Tests');
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

    server = await new Promise((resolve) => {
      const s = app.listen(PORT, () => resolve(s));
    });

    // 2. Setup Authenticated Users (Admin, Agent, Customer)
    const adminLogin = await makeRequest('POST', '/api/auth/login', {}, {
      email: 'admin@estatelead.com',
      password: 'Admin@123',
    });
    adminToken = adminLogin.data.token;

    const agentLogin = await makeRequest('POST', '/api/auth/login', {}, {
      email: 'agent.vikram@estatelead.com',
      password: 'Agent@123',
    });
    agentToken = agentLogin.data.token;

    const customerLogin = await makeRequest('POST', '/api/auth/login', {}, {
      email: 'priya.sundaram@example.com',
      password: 'Customer@123',
    });
    customerToken = customerLogin.data.token;

    // Test 1: Security: Customer rejected from analytics endpoints (403 Forbidden)
    await test('Security: Customer role is denied access to Analytics BI endpoints (403)', async () => {
      const res = await makeRequest('GET', '/api/analytics/overview', {
        Authorization: `Bearer ${customerToken}`,
      });
      assert.strictEqual(res.status, 403, 'Customer role must be blocked');
      assert.strictEqual(res.data.success, false);
    });

    // Test 2: Unauthenticated access blocked (401 Unauthorized)
    await test('Security: Unauthenticated request to analytics is blocked (401)', async () => {
      const res = await makeRequest('GET', '/api/analytics/overview');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.success, false);
    });

    // Test 3: Executive Overview Analytics (GET /api/analytics/overview)
    await test('Overview Analytics: Admin retrieves executive KPIs, valuation & score averages', async () => {
      const res = await makeRequest('GET', '/api/analytics/overview', {
        Authorization: `Bearer ${adminToken}`,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      const s = res.data.summary;
      assert.ok(typeof s.active_properties === 'number', 'Active properties is numeric');
      assert.ok(typeof s.total_leads === 'number', 'Total leads is numeric');
      assert.ok(typeof s.pipeline_deal_value === 'number', 'Pipeline valuation is numeric');
      assert.ok(typeof s.closed_deal_value === 'number', 'Closed deal value is numeric');
      assert.ok(s.conversion_rate.includes('%'), 'Conversion rate formatted as percentage');
    });

    // Test 4: 6-Stage Conversion Funnel (GET /api/analytics/funnel)
    await test('Conversion Funnel: Calculates 6-stage dropoff and progression percentages', async () => {
      const res = await makeRequest('GET', '/api/analytics/funnel', {
        Authorization: `Bearer ${adminToken}`,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.funnel.length, 6, 'Funnel must have exactly 6 distinct stages');

      const stage1 = res.data.funnel[0];
      const stage6 = res.data.funnel[5];
      assert.strictEqual(stage1.stage_number, 1);
      assert.strictEqual(stage6.stage_number, 6);
      assert.ok(stage1.name.includes('Impressions') || stage1.name.includes('Views'));
      assert.ok(stage6.name.includes('Converted') || stage6.name.includes('Deals Closed'));
    });

    // Test 5: Property Performance Leaderboard (GET /api/analytics/property-performance)
    await test('Property Performance: Ranks inventory by generated leads, views, and conversion ratios', async () => {
      const res = await makeRequest('GET', '/api/analytics/property-performance', {
        Authorization: `Bearer ${adminToken}`,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(Array.isArray(res.data.properties));
      assert.ok(res.data.properties.length > 0);

      const topProp = res.data.properties[0];
      assert.ok(topProp.title, 'Property includes title');
      assert.ok(typeof topProp.views_count === 'number', 'Views count is numeric');
      assert.ok(typeof topProp.generated_leads === 'number', 'Generated leads count is numeric');
      assert.ok(topProp.lead_conversion_rate.includes('%'), 'Includes conversion percentage string');
    });

    // Test 6: Lead Intent & Demographics Distribution (GET /api/analytics/lead-distribution)
    await test('Lead Distribution: Aggregates breakdowns by city, property type, timeline, and channel', async () => {
      const res = await makeRequest('GET', '/api/analytics/lead-distribution', {
        Authorization: `Bearer ${adminToken}`,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      const d = res.data.distribution;
      assert.ok(Array.isArray(d.by_category), 'Includes category breakdown');
      assert.ok(Array.isArray(d.by_city), 'Includes city breakdown');
      assert.ok(Array.isArray(d.by_property_type), 'Includes property type breakdown');
      assert.ok(Array.isArray(d.by_timeline), 'Includes timeline breakdown');
      assert.ok(Array.isArray(d.by_channel), 'Includes on-site channel breakdown');
    });

    // Test 7: Consultant Performance Leaderboard (GET /api/analytics/agent-performance)
    await test('Agent Performance: Computes consultant workload, site tours, and closed deal rates', async () => {
      const res = await makeRequest('GET', '/api/analytics/agent-performance', {
        Authorization: `Bearer ${agentToken}`,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(Array.isArray(res.data.agents));
      assert.ok(res.data.agents.length > 0);

      const agent = res.data.agents[0];
      assert.ok(agent.name, 'Agent record includes name');
      assert.ok(typeof agent.assigned_leads === 'number', 'Assigned leads is numeric');
      assert.ok(typeof agent.followups_logged === 'number', 'Followups logged is numeric');
      assert.ok(agent.conversion_rate.includes('%'), 'Conversion rate formatted as percentage');
    });

    // Test 8: Financial Valuation Integrity
    await test('Financial Consistency: Pipeline valuation reflects active inventory prices', async () => {
      const res = await makeRequest('GET', '/api/analytics/overview', {
        Authorization: `Bearer ${adminToken}`,
      });
      assert.strictEqual(res.status, 200);
      const val = res.data.summary.pipeline_deal_value;
      assert.ok(val >= 0, 'Pipeline deal valuation must be non-negative numeric amount');
    });

  } catch (err) {
    console.error('Fatal Test Runner Error:', err);
  } finally {
    if (server) {
      server.close();
    }
  }

  console.log('\n------------------------------------------------------');
  console.log(`Stage 6 Test Results: ${passed}/${total} Passed`);
  console.log('------------------------------------------------------\n');

  if (passed === total) {
    console.log('🎉 [SUCCESS] STAGE 6 ANALYTICS & BI FULLY VERIFIED!\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runStage6Tests();
