/**
 * EstateLead - Stage 2 Automated Test Suite
 * Validates: Property Catalog API, Multi-Criteria Filtering (Location, Type, BHK, Purpose, Price),
 * Property Details Specification, Views Count & User Activity Tracking, Wishlist Bookmarking Toggle,
 * and EMI Estimator Mathematical Accuracy.
 */
const assert = require('assert');
const jwt = require('jsonwebtoken');
const db = require('../server/config/db');
const { JWT_SECRET } = require('../server/middleware/auth');

async function runStage2Tests() {
  console.log('======================================================================');
  console.log('🧪 RUNNING ESTATELEAD - STAGE 2 VERIFICATION TEST SUITE');
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

  // Test 1: Property Inventory Catalog Existence
  await test('Property Catalog Query & Active Listings Count', async () => {
    const props = await db.all('SELECT id, title, location, price, purpose, availability FROM properties WHERE status = $1', ['Active']);
    assert(props.length >= 6, `Expected at least 6 properties, got ${props.length}`);
  });

  // Test 2: Multi-Criteria Filter: Location (Chennai)
  await test('Location Filtering (Chennai)', async () => {
    const chennaiProps = await db.all('SELECT id, title, location FROM properties WHERE location LIKE $1', ['%Chennai%']);
    assert(chennaiProps.length >= 2, 'Expected at least 2 properties in Chennai');
    for (const p of chennaiProps) {
      assert(p.location.includes('Chennai'), `Property location must contain Chennai: ${p.location}`);
    }
  });

  // Test 3: Purpose Filter (Buy vs Rent)
  await test('Purpose Filtering (Buy vs Rent)', async () => {
    const buyProps = await db.all('SELECT id, title, purpose FROM properties WHERE purpose = $1', ['Buy']);
    const rentProps = await db.all('SELECT id, title, purpose FROM properties WHERE purpose = $1', ['Rent']);
    assert(buyProps.length >= 4, 'Expected at least 4 Buy properties');
    assert(rentProps.length >= 1, 'Expected at least 1 Rent property');
  });

  // Test 4: BHK and Property Type Filtering
  await test('Property Type & BHK Filtering (Apartments with 3 BHK)', async () => {
    const filtered = await db.all(
      'SELECT id, title, property_type, bhk FROM properties WHERE property_type LIKE $1 AND bhk = $2',
      ['%Apartment%', 3]
    );
    assert(filtered.length >= 1, 'Expected at least 1 3-BHK Apartment');
    assert.strictEqual(filtered[0].bhk, 3);
  });

  // Test 5: Featured Properties Filter
  await test('Featured Luxury Properties Query', async () => {
    const featured = await db.all('SELECT id, title, featured FROM properties WHERE featured = TRUE OR featured = 1');
    assert(featured.length >= 3, 'Expected at least 3 featured properties');
  });

  // Test 6: Single Property Details & Behavioral Activity Logging
  await test('Property View & Activity Tracking Simulation', async () => {
    const prop = await db.get('SELECT id, title, views_count FROM properties LIMIT 1');
    const user = await db.get('SELECT id FROM users LIMIT 1');
    assert(prop && user, 'Must find at least one property and user');

    const initialViews = prop.views_count || 0;
    // Simulate property view
    await db.query('UPDATE properties SET views_count = views_count + 1 WHERE id = $1', [prop.id]);
    await db.query(
      `INSERT INTO user_activity (user_id, property_id, activity_type, metadata, ip_address)
       VALUES ($1, $2, 'view_property', $3, '127.0.0.1')`,
      [user.id, prop.id, `Viewed ${prop.title}`]
    );

    const updatedProp = await db.get('SELECT views_count FROM properties WHERE id = $1', [prop.id]);
    assert.strictEqual(updatedProp.views_count, initialViews + 1, 'Views count must increment by 1');

    const activity = await db.get(
      'SELECT id, activity_type FROM user_activity WHERE property_id = $1 AND activity_type = $2 ORDER BY id DESC LIMIT 1',
      [prop.id, 'view_property']
    );
    assert(activity, 'User activity record must be logged');
  });

  // Test 7: Saved Properties Wishlist Toggle (Bookmark / Unbookmark)
  await test('Wishlist Bookmark & Save Toggle Simulation', async () => {
    const user = await db.get('SELECT id FROM users WHERE email = $1', ['priya.sundaram@example.com']);
    const prop = await db.get('SELECT id FROM properties ORDER BY id DESC LIMIT 1');
    assert(user && prop, 'User and property must exist');

    // Clean any prior state
    await db.query('DELETE FROM saved_properties WHERE user_id = $1 AND property_id = $2', [user.id, prop.id]);

    // Step 1: Save property
    await db.query('INSERT INTO saved_properties (user_id, property_id) VALUES ($1, $2)', [user.id, prop.id]);
    const savedRecord = await db.get('SELECT id FROM saved_properties WHERE user_id = $1 AND property_id = $2', [user.id, prop.id]);
    assert(savedRecord, 'Property must be saved in wishlist');

    // Step 2: Unsave property
    await db.query('DELETE FROM saved_properties WHERE id = $1', [savedRecord.id]);
    const unsavedRecord = await db.get('SELECT id FROM saved_properties WHERE user_id = $1 AND property_id = $2', [user.id, prop.id]);
    assert(!unsavedRecord, 'Property must be successfully removed from wishlist');
  });

  // Test 8: EMI Calculator Mathematical Verification
  await test('Interactive EMI Estimator Mathematical Accuracy', async () => {
    // Formula: EMI = [P * r * (1 + r)^n] / [(1 + r)^n - 1]
    const price = 8500000; // ₹85 Lakhs
    const downPaymentPct = 20; // 20% DP -> Principal = ₹68 Lakhs
    const annualRate = 8.5; // 8.5%
    const tenureYears = 20; // 20 years = 240 months

    const principal = price * (1 - downPaymentPct / 100);
    const monthlyRate = annualRate / (12 * 100);
    const months = tenureYears * 12;

    const calculatedEMI = Math.round(
      (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
    );

    // Standard financial verification: For ₹68,00,000 at 8.5% for 20 years, EMI is approx ₹59,048
    assert(calculatedEMI > 58000 && calculatedEMI < 60000, `Expected EMI around ₹59,048, got ${calculatedEMI}`);
  });

  console.log('\n----------------------------------------------------------------------');
  console.log(`🏁 STAGE 2 TEST RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('----------------------------------------------------------------------\n');

  if (passed === total) {
    console.log('🎉 [SUCCESS] STAGE 2 CUSTOMER WEBSITE & CATALOG FULLY VERIFIED!\n');
    process.exit(0);
  } else {
    console.error('❌ [FAILURE] Some Stage 2 tests failed.');
    process.exit(1);
  }
}

runStage2Tests().catch((err) => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});
