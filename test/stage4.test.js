/**
 * EstateLead - Stage 4 Automated Verification Test Suite
 * Tests Lead Generation APIs, Algorithmic Lead Scoring Engine,
 * Hot/Warm/Cold Categorization, Explainable Rationale, Site Visit Schedulers,
 * Brochure Gate, and Audit Logging.
 */
const assert = require('assert');
const http = require('http');
const db = require('../server/config/db');
const { app } = require('../server/index');
const { computeLeadScore } = require('../server/routes/leads');

const PORT = 5005;
let server;
let customerToken;
let customerUser;
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

async function runStage4Tests() {
  console.log('\n======================================================');
  console.log('🧪 Starting Stage 4: Lead Generation & Algorithmic Lead Scoring Tests');
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

    testProperty = await db.get('SELECT id, title, price, location, property_type FROM properties LIMIT 1');

    server = await new Promise((resolve) => {
      const s = app.listen(PORT, () => resolve(s));
    });

    // 2. Setup Authenticated Test Customer (Priya Sundaram)
    const loginRes = await makeRequest('POST', '/api/auth/login', {}, {
      email: 'priya.sundaram@example.com',
      password: 'Customer@123',
    });
    customerToken = loginRes.data.token;
    customerUser = loginRes.data.user;

    // Test 1: Algorithmic Scoring Engine - HOT Lead Calculation
    await test('Lead Scoring Engine: High-intent inquiry yields score >= 75 (HOT Lead)', async () => {
      const hotScore = await computeLeadScore({
        enquiry_type: 'Schedule Site Visit',
        timeline: 'Immediate / Within 15 days',
        budget: 'Above ₹1.5 Cr',
        phone: '+91 98401 22334',
        email: 'vip.buyer@example.com',
        userId: customerUser.id,
      });

      assert.ok(hotScore.score >= 75, `Expected score >= 75, got ${hotScore.score}`);
      assert.strictEqual(hotScore.category, 'HOT', 'Must be categorized as HOT Lead');
      assert.ok(hotScore.reasons.length >= 4, 'Must have itemized explainable reasons');
      assert.ok(hotScore.reasonSummary.includes('HOT Lead'), 'Reason summary includes HOT tag');
    });

    // Test 2: Algorithmic Scoring Engine - COLD / Exploratory Lead
    await test('Lead Scoring Engine: Exploratory inquiry yields score < 50 (COLD Lead)', async () => {
      const coldScore = await computeLeadScore({
        enquiry_type: 'General Enquiry',
        timeline: 'Exploring / Long-term',
        budget: 'Under ₹50 Lakhs',
        phone: '',
        email: 'casual@example.com',
        userId: null,
      });

      assert.ok(coldScore.score < 50, `Expected score < 50, got ${coldScore.score}`);
      assert.strictEqual(coldScore.category, 'COLD', 'Must be categorized as COLD Lead');
    });

    // Test 3: Standard Lead Capture (POST /api/leads/enquire)
    await test('Lead Capture API: Submits enquiry, calculates score, and logs audit trail', async () => {
      const payload = {
        property_id: testProperty.id,
        name: 'Arun Varma',
        phone: '+91 98401 11223',
        email: 'arun.varma@example.com',
        location: 'Chennai',
        property_type: 'Apartments',
        budget: '₹80L - ₹1.5 Cr',
        timeline: 'Within 1-3 months',
        enquiry_type: 'Property Enquiry',
        message: 'Interested in corner unit with sea view.',
        source_page: 'Property Details #1',
      };

      const res = await makeRequest('POST', '/api/leads/enquire', {}, payload);
      assert.strictEqual(res.status, 201, 'Should return 201 Created');
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.lead_id, 'Must return generated lead_id');
      assert.ok(res.data.lead_summary.assigned_agent, 'Must assign an active consultant');

      // Verify Lead persisted in DB
      const leadInDb = await db.get('SELECT * FROM leads WHERE id = $1', [res.data.lead_id]);
      assert.ok(leadInDb, 'Lead must exist in database');
      assert.strictEqual(leadInDb.name, 'Arun Varma');
      assert.strictEqual(leadInDb.source, 'Website');
      assert.ok(leadInDb.lead_score > 0, 'Lead score must be calculated and stored');

      // Verify Audit Log generated
      const audit = await db.get(
        `SELECT * FROM audit_logs WHERE action = 'LEAD_CAPTURED' AND entity_id = $1`,
        [res.data.lead_id]
      );
      assert.ok(audit, 'Audit log record must be logged for lead capture');
    });

    // Test 4: Dedicated Site Visit Scheduler (POST /api/leads/site-visit)
    await test('Site Visit API: Schedules on-site tour with date and generates high-intent lead', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const payload = {
        property_id: testProperty.id,
        name: 'Meenakshi Sundaram',
        phone: '+91 98401 55443',
        email: 'meenakshi@example.com',
        visit_date: tomorrow,
        visit_time: '11:00 AM',
        notes: 'Need parking spot for 2 cars.',
      };

      const res = await makeRequest('POST', '/api/leads/site-visit', {}, payload);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);

      // Verify site visit record in DB
      const lead = await db.get('SELECT * FROM leads WHERE id = $1', [res.data.lead_id]);
      assert.strictEqual(lead.enquiry_type, 'Schedule Site Visit');
      assert.ok(lead.message.includes(tomorrow), 'Message must record scheduled visit date');
      assert.strictEqual(lead.lead_category, 'HOT', 'Site visit must be classified as HOT lead');
    });

    // Test 5: Instant 1-Click Callback (POST /api/leads/callback)
    await test('Instant Callback API: Captures phone number and initiates fast response pipeline', async () => {
      const payload = {
        property_id: testProperty.id,
        property_title: testProperty.title,
        name: 'Rajesh Nair',
        phone: '+91 98401 77889',
        preferred_time: 'Immediate',
      };

      const res = await makeRequest('POST', '/api/leads/callback', {}, payload);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.lead_id);
    });

    // Test 6: Gated Brochure Download (POST /api/leads/brochure)
    await test('Gated Brochure API: Unlocks specifications package and captures verified lead', async () => {
      const payload = {
        property_id: testProperty.id,
        name: 'Divya Ramesh',
        phone: '+91 98401 66554',
        email: 'divya.ramesh@example.com',
      };

      const res = await makeRequest('POST', '/api/leads/brochure', {}, payload);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.brochure_url.includes('.pdf'), 'Must return downloadable brochure URL');
      assert.ok(res.data.lead_id, 'Must record lead before unlocking');
    });

    // Test 7: Input Validation & Anti-Spam Verification
    await test('Validation: Rejects missing contact fields or invalid email format (400 Bad Request)', async () => {
      // Case A: Missing phone
      const resA = await makeRequest('POST', '/api/leads/enquire', {}, {
        name: 'Incomplete User',
        email: 'test@example.com',
      });
      assert.strictEqual(resA.status, 400);
      assert.strictEqual(resA.data.success, false);

      // Case B: Invalid email format
      const resB = await makeRequest('POST', '/api/leads/enquire', {}, {
        name: 'Bad Email User',
        phone: '+91 98401 00000',
        email: 'not-an-email',
      });
      assert.strictEqual(resB.status, 400);
      assert.strictEqual(resB.data.success, false);
    });

    // Test 8: Explainable Lead Score Breakdown Endpoint (GET /api/leads/score-breakdown/:id)
    await test('Explainability: Score breakdown endpoint returns itemized reasoning rationale', async () => {
      // First create a lead
      const createRes = await makeRequest('POST', '/api/leads/enquire', {}, {
        name: 'Kavitha Balan',
        phone: '+91 98401 99112',
        email: 'kavitha@example.com',
        timeline: 'Immediate / Within 15 days',
        budget: 'Above ₹1.5 Cr',
        enquiry_type: 'Schedule Site Visit',
      });
      const leadId = createRes.data.lead_id;

      // Query score breakdown
      const breakdownRes = await makeRequest('GET', `/api/leads/score-breakdown/${leadId}`);
      assert.strictEqual(breakdownRes.status, 200);
      assert.strictEqual(breakdownRes.data.success, true);
      assert.strictEqual(breakdownRes.data.lead_id, leadId);
      assert.ok(breakdownRes.data.score >= 75);
      assert.strictEqual(breakdownRes.data.category, 'HOT');
      assert.ok(breakdownRes.data.rationale.length > 20, 'Includes transparent scoring rationale string');
    });

  } catch (err) {
    console.error('Fatal Test Runner Error:', err);
  } finally {
    if (server) {
      server.close();
    }
  }

  console.log('\n------------------------------------------------------');
  console.log(`Stage 4 Test Results: ${passed}/${total} Passed`);
  console.log('------------------------------------------------------\n');

  if (passed === total) {
    console.log('🎉 [SUCCESS] STAGE 4 LEAD GENERATION & SCORING FULLY VERIFIED!\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runStage4Tests();
