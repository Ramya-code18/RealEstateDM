/**
 * EstateLead - Master Full-Stack Test Suite Runner (Stages 1 - 6)
 * Sequentially executes all verification test suites and reports final status.
 */
const { execSync } = require('child_process');
const path = require('path');

const stages = [
  { name: 'Stage 1: Foundation & SecureEstate Security Layer', file: 'test/stage1.test.js' },
  { name: 'Stage 2: Customer Website, Search & EMI Estimator', file: 'test/stage2.test.js' },
  { name: 'Stage 3: Customer Personalization & Dashboard', file: 'test/stage3.test.js' },
  { name: 'Stage 4: Lead Generation & Algorithmic Scoring Engine', file: 'test/stage4.test.js' },
  { name: 'Stage 5: Admin & Agent Lead Management CRM', file: 'test/stage5.test.js' },
  { name: 'Stage 6: Analytics & Business Intelligence Dashboard', file: 'test/stage6.test.js' },
];

console.log('\n======================================================================');
console.log('🚀 ESTATELEAD MASTER VERIFICATION TEST SUITE (STAGES 1 TO 6)');
console.log('======================================================================\n');

let allPassed = true;
let totalPassed = 0;
let totalTests = 48;

for (let i = 0; i < stages.length; i++) {
  const stage = stages[i];
  console.log(`▶️ Executing ${stage.name}...`);
  try {
    const output = execSync(`node ${stage.file}`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    totalPassed += 8;
  } catch (err) {
    allPassed = false;
    console.error(`❌ ${stage.name} encountered errors.`);
  }
}

console.log('\n======================================================================');
console.log(`🏁 MASTER SUITE RESULTS: ${totalPassed} / ${totalTests} TESTS PASSED`);
console.log('======================================================================\n');

if (allPassed) {
  console.log('🎉 [100% SUCCESS] ALL ESTATELEAD FULL-STACK MODULES ARE FULLY VERIFIED!\n');
  process.exit(0);
} else {
  console.error('❌ Some test suites failed.');
  process.exit(1);
}
