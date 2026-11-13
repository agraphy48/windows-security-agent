const vpsClusterSyncer = require('../src/vpsClusterSyncer');

async function test() {
  console.log('Testing VpsClusterSyncer...');
  const res = await vpsClusterSyncer.runFullSync();
  console.log('=== TEST RESULT ===');
  console.log(JSON.stringify(res, null, 2));
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
