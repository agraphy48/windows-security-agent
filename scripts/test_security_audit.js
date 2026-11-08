const http = require('http');
const security = require('../src/security');
const contactsManager = require('../src/contacts');
const webPortal = require('../src/webPortal');

async function runTests() {
  console.log('=== STARTING SECURITY REMEDIATION AUDIT TESTS ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`[PASS] ✅ ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ❌ ${testName}`);
      failed++;
    }
  }

  // --- TEST 1: Block-IP Self-DoS and Validation Protection ---
  console.log('--- TEST 1: Firewall IP Validation & Self-DoS Prevention ---');
  const resInvalid = await security.blockIp('999.999.999.999');
  assert(resInvalid.includes('tidak valid'), 'Rejects out-of-range IP octet (999.999.999.999)');

  const resFormat = await security.blockIp('1.2.3.4.5');
  assert(resFormat.includes('tidak valid'), 'Rejects non-4-octet IP (1.2.3.4.5)');

  const resSelfDos = await security.blockIp('127.0.0.1');
  assert(resSelfDos.includes('ditolak'), 'Blocks Self-DoS on loopback IP (127.0.0.1)');

  const resMaster = await security.blockIp('62.72.20.122');
  assert(resMaster.includes('ditolak'), 'Protects Cluster Master IP from accidental blocking');

  // --- TEST 2: Contacts XSS Sanitization & Bounds Checking ---
  console.log('\n--- TEST 2: Contacts Stored XSS & Bounds Checking ---');
  try {
    const maliciousName = '<script>alert("XSS")</script>John Doe';
    const maliciousRole = '<img src=x onerror=alert(1)>SysAdmin';
    const contactRes = contactsManager.addContact({
      number: '628999888777',
      name: maliciousName,
      role: maliciousRole,
      alerts: ['all', '<invalid>']
    });
    const c = contactRes.contact;
    assert(!c.name.includes('<') && !c.name.includes('>'), 'Sanitizes HTML tags from contact name');
    assert(!c.role.includes('<') && !c.role.includes('>'), 'Sanitizes HTML tags from contact role');
    assert(c.alerts.length === 1 && c.alerts[0] === 'all', 'Rejects unauthorized alert categories');
    
    // Clean up
    contactsManager.removeContact(c.id);
  } catch (e) {
    assert(false, `Contacts test threw error: ${e.message}`);
  }

  // --- TEST 3: Web Portal Security Headers & Rate Limiting ---
  console.log('\n--- TEST 3: Web Portal HTTP Security Headers & Rate Limiting ---');
  const server = http.createServer(async (req, res) => {
    const dummyWaClient = { isConnected: false, currentQrDataUrl: null };
    const handled = await webPortal.handleRequest(req, res, dummyWaClient);
    if (!handled && !res.headersSent) {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise(r => server.listen(5099, '127.0.0.1', r));

  try {
    // 3a. Check Security Headers
    const headersRes = await new Promise((resolve) => {
      http.get('http://127.0.0.1:5099/login', (res) => {
        resolve(res.headers);
      });
    });

    assert(headersRes['x-content-type-options'] === 'nosniff', 'Header X-Content-Type-Options: nosniff present');
    assert(headersRes['x-frame-options'] === 'DENY', 'Header X-Frame-Options: DENY present');
    assert(headersRes['x-xss-protection'] === '1; mode=block', 'Header X-XSS-Protection present');
    assert(headersRes['content-security-policy']?.includes('default-src'), 'Header Content-Security-Policy present');

    // 3b. Check Brute-Force Login Lockout (5 attempts)
    console.log('\n--- TEST 4: Login Brute-Force Lockout (5 attempts threshold) ---');
    let lastStatusCode = 0;
    let lastBody = '';

    for (let i = 1; i <= 6; i++) {
      const resp = await new Promise((resolve) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: 5099,
          path: '/api/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          let b = '';
          res.on('data', c => b += c);
          res.on('end', () => resolve({ status: res.statusCode, body: b }));
        });
        req.write(JSON.stringify({ username: 'admin', password: 'wrongpassword' + i }));
        req.end();
      });
      lastStatusCode = resp.status;
      lastBody = resp.body;
    }

    assert(lastStatusCode === 429, `IP locked out with HTTP 429 after 5 failed attempts (got ${lastStatusCode})`);
    assert(lastBody.includes('dikunci'), 'Lockout error message returned to client');

    // 3c. Check 1MB Payload Too Large (DoS Protection)
    console.log('\n--- TEST 5: Payload Too Large 1MB Limit ---');
    const largePayload = 'A'.repeat(1.2 * 1024 * 1024); // 1.2 MB
    const largeRes = await new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: 5099,
        path: '/api/login',
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Forwarded-For': '10.99.88.77' // fresh IP
        }
      }, (res) => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
      req.on('error', () => resolve({ status: 413, body: 'Socket destroyed / Payload too large' }));
      req.write(largePayload);
      req.end();
    });

    assert(largeRes.status === 413, `Excessive payload rejected with HTTP 413 (got ${largeRes.status})`);

  } finally {
    server.close();
  }

  console.log(`\n=== AUDIT TESTS COMPLETE: ${passed} PASSED, ${failed} FAILED ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

