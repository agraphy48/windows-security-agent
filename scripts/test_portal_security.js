const assert = require('assert');
const portal = require('../src/webPortal');

async function runTests() {
  console.log('🧪 Starting SecOps Portal Hardening Tests...\n');

  // Test 1: getClientIp spoofing protection
  console.log('Test 1: Testing IP Spoofing Prevention...');
  const fakeProxyReq = {
    socket: { remoteAddress: '198.51.100.23' }, // Public internet IP
    headers: {
      'x-forwarded-for': '1.1.1.1',
      'cf-connecting-ip': '2.2.2.2'
    }
  };
  const detectedIp = portal.getClientIp(fakeProxyReq);
  assert.strictEqual(detectedIp, '198.51.100.23', 'Attacker directly connecting cannot spoof X-Forwarded-For or CF-Connecting-IP!');
  console.log('✅ PASS: Direct internet IP cannot spoof proxy headers.');

  // Test 2: Local loopback proxy IP resolution
  console.log('Test 2: Testing Trusted Local Reverse Proxy IP Resolution...');
  const localProxyReq = {
    socket: { remoteAddress: '127.0.0.1' }, // Local OpenLiteSpeed
    headers: {
      'cf-connecting-ip': '203.0.113.55'
    }
  };
  const trustedIp = portal.getClientIp(localProxyReq);
  assert.strictEqual(trustedIp, '203.0.113.55', 'Local reverse proxy correctly resolves real client IP from Cloudflare header.');
  console.log('✅ PASS: Local reverse proxy trusted headers resolved accurately.');

  // Test 3: Anti-bot CSRF & Timing Token
  console.log('Test 3: Testing Anti-Bot Timing Token...');
  const token = portal.generateLoginCsrf('203.0.113.55');
  assert.ok(token, 'CSRF token must be generated');

  // Submit immediately (simulating a curl or python script)
  const speedCheck = portal.verifyLoginCsrf(token, '203.0.113.55');
  assert.strictEqual(speedCheck.valid, false, 'Instant submission (<700ms) must be detected as bot');
  assert.strictEqual(speedCheck.isBotSpeed, true, 'isBotSpeed flag must be true');
  console.log('✅ PASS: Automated script (<700ms) blocked by timing barrier.');

  // Test 4: Anti-bot Honeypot
  console.log('Test 4: Testing Anti-Bot Honeypot Field...');
  let resStatus = 0;
  let resJson = null;
  const mockRes = {
    setHeader: () => {},
    writeHead: (st) => { resStatus = st; },
    end: (str) => { resJson = JSON.parse(str); }
  };
  const mockReq = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'cf-connecting-ip': '192.0.2.99' },
    on: (evt, cb) => {
      if (evt === 'data') cb(JSON.stringify({
        username: 'admin',
        password: 'wrongpassword',
        _hp_website: 'http://spambot.com', // BOT FILLING HONEYPOT
        _sec_token: 'dummy'
      }));
      if (evt === 'end') cb();
    }
  };
  await portal.handleApiLogin(mockReq, mockRes, { isConnected: false });
  assert.strictEqual(resStatus, 403, 'Honeypot trigger must return 403 Forbidden');
  assert.strictEqual(portal.bannedIps.has('192.0.2.99'), true, 'IP must be banned for 24h immediately');
  console.log('✅ PASS: Honeypot trap triggered -> Bot IP banned immediately for 24 hours.');

  // Test 5: Session Fingerprint Binding (Anti-Hijacking)
  console.log('Test 5: Testing Session Anti-Hijacking...');
  const sessionReq = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'cf-connecting-ip': '203.0.113.88',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };
  let setCookieHeader = '';
  const sessionRes = {
    setHeader: (k, v) => { if (k === 'Set-Cookie') setCookieHeader = v; }
  };
  const sessionToken = portal.createSession('admin', sessionReq, sessionRes);
  assert.ok(sessionToken, 'Session token must be created');

  // Verify valid session
  const verifyValidReq = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'cf-connecting-ip': '203.0.113.88',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      cookie: `secops_session=${sessionToken}`
    }
  };
  const validSession = portal.getSession(verifyValidReq);
  assert.ok(validSession, 'Session should be valid for the legitimate user');

  // Attacker steals session token and uses it from a different IP
  const hijackedReq = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'cf-connecting-ip': '185.220.101.5', // Attacker Tor Exit Node
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      cookie: `secops_session=${sessionToken}`
    }
  };
  const hijackedSession = portal.getSession(hijackedReq);
  assert.strictEqual(hijackedSession, null, 'Hijacked session from different IP must be immediately destroyed!');
  assert.strictEqual(portal.sessions.has(sessionToken), false, 'Compromised session token must be purged from memory!');
  console.log('✅ PASS: Session hijacking attempt blocked and token destroyed.');

  console.log('\n🎉 ALL 5 HARDENING TESTS PASSED WITH 100% SUCCESS!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

