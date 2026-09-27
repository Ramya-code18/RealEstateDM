/**
 * EstateLead - Stage 5 Automated Verification Test Suite
 * Tests Lead Management CRM, RBAC Authorization, Pipeline Status Transitions,
 * Consultant Re-assignment, Dynamic Follow-up Timeline, and CSV Exports.
 */
const assert = require('assert');
const http = require('http');
const db = require('../server/config/db');
const { app } = require('../server/index');

const PORT = 5006;
let server;
let adminToken;
let agentToken;
let customerToken;
let testLeadId;
let testAgentId;

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
          resolve({ status: res.statusCode, data: parsed, raw: data, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data, headers: res.headers });
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

async function runStage5Tests() {
  console.log('\n======================================================');
  console.log('🧪 Starting Stage 5: Lead Management CRM & Follow-up Tests');
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
    testAgentId = agentLogin.data.user.id;

    const customerLogin = await makeRequest('POST', '/api/auth/login', {}, {
      email: 'priya.sundaram@example.com',
      password: 'Customer@123',
    });
    customerToken = customerLogin.data.token;

    // Get an existing lead for testing
    const leadRow = await db.get('SELECT id FROM leads ORDER BY id ASC LIMIT 1');
    testLeadId = leadRow ? leadRow.id : 1;

    // Test 1: RBAC Security Protection (Customer blocked from CRM endpoints)
    await test('Security: Customer account is rejected from CRM endpoints (403 Forbidden)', async () => {
      const res = await makeRequest('GET', '/api/crm/leads', {
        Authorization: `Bearer ${customerToken}`,
      });
      assert.strictEqual(res.status, 403, 'Customer role must be denied access with 403');
      assert.strictEqual(res.data.success, false);
    });

    // Test 2: CRM Metrics Overview (GET /api/crm/stats)
    await test('CRM Metrics: Admin & Agents retrieve real-time lead counts and conversion rate', async () => {
      const res = await makeRequest('GET', '/api/crm/stats', {
        Authorization: `Bearer ${adminToken}`,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.stats, 'Response includes stats object');
      assert.ok(typeof res.data.stats.total_leads === 'number', 'Total leads is a number');
      assert.ok(typeof res.data.stats.hot_leads === 'number', 'Hot leads count is present');
      assert.ok(res.data.stats.conversion_rate.includes('%'), 'Conversion rate formatted as percentage');
    });

    // Test 3: Filtered Lead Pipeline List (GET /api/crm/leads)
    await test('Lead Pipeline: Admin retrieves lead list with multi-criteria category filtering', async () => {
      const res = await makeRequest('GET', '/api/crm/leads?category=HOT', {
        Authorization: `Bearer ${adminToken}`,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(Array.isArray(res.data.leads), 'Returns leads array');
      assert.ok(typeof res.data.total === 'number', 'Includes total pagination count');

      for (const lead of res.data.leads) {
        assert.strictEqual(lead.lead_category || lead.score_category, 'HOT', 'Filtered leads must all be HOT');
      }
    });

    // Test 4: Single Lead Inspection (GET /api/crm/leads/:id)
    await test('Lead Details: Fetches complete prospect info, explainable score & follow-up logs', async () => {
      const res = await makeRequest('GET', `/api/crm/leads/${testLeadId}`, {
        Authorization: `Bearer ${adminToken}`,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.lead.id, testLeadId);
      assert.ok(res.data.lead.name, 'Lead includes prospect name');
      assert.ok(Array.isArray(res.data.followups), 'Includes follow-up logs array');
    });

    // Test 5: Pipeline Status Progression (PATCH /api/crm/leads/:id/status)
    await test('Status Progression: Transitions lead status (Contacted -> Site Visit) and creates audit log', async () => {
      const res = await makeRequest('PATCH', `/api/crm/leads/${testLeadId}/status`, {
        Authorization: `Bearer ${adminToken}`,
      }, {
        status: 'Site Visit',
        notes: 'Prospect confirmed attendance for Saturday 11 AM.',
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.new_status, 'Site Visit');

      // Verify DB update
      const updated = await db.get('SELECT status, notes FROM leads WHERE id = $1', [testLeadId]);
      assert.strictEqual(updated.status, 'Site Visit');
      assert.ok(updated.notes.includes('Saturday 11 AM'));

      // Verify Audit Trail
      const audit = await db.get(
        `SELECT * FROM audit_logs WHERE action = 'LEAD_STATUS_UPDATED' AND entity_id = $1 ORDER BY id DESC LIMIT 1`,
        [String(testLeadId)]
      );
      assert.ok(audit, 'Audit trail must record status transition');
    });

    // Test 6: Agent Re-assignment (PATCH /api/crm/leads/:id/assign)
    await test('Consultant Assignment: Reassigns lead to target agent and produces audit trail', async () => {
      const res = await makeRequest('PATCH', `/api/crm/leads/${testLeadId}/assign`, {
        Authorization: `Bearer ${adminToken}`,
      }, {
        agent_id: testAgentId,
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.assigned_agent.id, testAgentId);

      // Verify DB
      const lead = await db.get('SELECT assigned_to, assigned_agent_id FROM leads WHERE id = $1', [testLeadId]);
      assert.strictEqual(lead.assigned_to, testAgentId);

      // Verify Audit Log
      const audit = await db.get(
        `SELECT * FROM audit_logs WHERE action = 'LEAD_REASSIGNED' AND entity_id = $1 ORDER BY id DESC LIMIT 1`,
        [String(testLeadId)]
      );
      assert.ok(audit, 'Audit trail must record reassignment');
    });

    // Test 7: Dynamic Follow-up Interaction Logging (POST /api/crm/leads/:id/followups)
    await test('Follow-up System: Logs interaction notes, schedules next date, and retrieves timeline', async () => {
      const nextDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const res = await makeRequest('POST', `/api/crm/leads/${testLeadId}/followups`, {
        Authorization: `Bearer ${agentToken}`,
      }, {
        followup_date: nextDate,
        followup_time: '02:30 PM',
        notes: 'Discussed home loan eligibility with HDFC pre-approval team.',
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.followup_id);

      // Verify follow-up timeline retrieval
      const timelineRes = await makeRequest('GET', `/api/crm/leads/${testLeadId}/followups`, {
        Authorization: `Bearer ${agentToken}`,
      });
      assert.strictEqual(timelineRes.status, 200);
      assert.ok(timelineRes.data.followups.length > 0);
      assert.ok(timelineRes.data.followups.some(f => f.notes.includes('HDFC pre-approval')));
    });

    // Test 8: CSV Export with Audit Log (GET /api/crm/export)
    await test('CSV Export: Generates downloadable CSV content with audit logging', async () => {
      const res = await makeRequest('GET', '/api/crm/export', {
        Authorization: `Bearer ${adminToken}`,
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/csv'), 'Must return text/csv content type');
      assert.ok(res.raw.includes('Lead ID,Customer Name,Phone Number,Email Address'), 'CSV must contain standard headers');
      assert.ok(res.raw.split('\n').length >= 2, 'CSV contains header + data rows');

      // Verify Export Audit Log
      const audit = await db.get(
        `SELECT * FROM audit_logs WHERE action = 'LEADS_EXPORTED' ORDER BY id DESC LIMIT 1`
      );
      assert.ok(audit, 'Audit log must record CSV exports');
    });

  } catch (err) {
    console.error('Fatal Test Runner Error:', err);
  } finally {
    if (server) {
      server.close();
    }
  }

  console.log('\n------------------------------------------------------');
  console.log(`Stage 5 Test Results: ${passed}/${total} Passed`);
  console.log('------------------------------------------------------\n');

  if (passed === total) {
    console.log('🎉 [SUCCESS] STAGE 5 CRM & LEAD MANAGEMENT FULLY VERIFIED!\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runStage5Tests();
