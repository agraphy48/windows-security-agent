const assert = require('assert');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const portal = require('../src/webPortal');
const cluster = require('../src/cluster');

async function testPinChange() {
  console.log('🧪 Starting Security PIN Module Tests...\n');

  const originalPin = config.securityPin;
  const originalEnvContent = fs.existsSync(path.join(__dirname, '..', '.env'))
    ? fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
    : null;

  try {
    // Helper to create mock request/response
    function createMockReqRes(body, session = null) {
      let resStatus = 0;
      let resHeaders = {};
      let resJson = null;

      const mockRes = {
        setHeader: (k, v) => { resHeaders[k] = v; },
        writeHead: (st, hdrs = {}) => {
          resStatus = st;
          resHeaders = { ...resHeaders, ...hdrs };
        },
        end: (str) => {
          if (str) {
            try {
              resJson = JSON.parse(str);
            } catch {
              resJson = str;
            }
          }
        }
      };

      const payload = Buffer.from(JSON.stringify(body));
      const mockReq = {
        socket: { remoteAddress: '127.0.0.1' },
        headers: {},
        on: (evt, cb) => {
          if (evt === 'data') cb(payload);
          if (evt === 'end') cb();
        }
      };

      return {
        req: mockReq,
        res: mockRes,
        getStatus: () => resStatus,
        getBody: () => resJson
      };
    }

    const mockWaClient = {
      sock: {
        sendMessage: async () => ({ status: 'sent' })
      },
      isConnected: true,
      adminSessions: new Map([['admin1', { session: true }]]),
      pendingActions: new Map([['act1', {}]]),
      pendingCommands: new Map([['cmd1', {}]])
    };

    const validSession = {
      username: 'admin',
      authenticated: true,
      role: 'superadmin'
    };

    // Test 1: Reject unauthenticated request
    console.log('Test 1: Rejecting unauthenticated access to PIN change...');
    {
      const { req, res, getStatus, getBody } = createMockReqRes(
        { currentPin: originalPin, newPin: '987654', confirmPin: '987654' },
        null
      );
      await portal.handleApiChangePin(req, res, null, '127.0.0.1', mockWaClient);
      assert.strictEqual(getStatus(), 401, 'Unauthenticated user must receive 401');
      assert.strictEqual(getBody().success, false);
      console.log('✅ PASS: Unauthenticated access blocked (401).');
    }

    // Test 2: Reject wrong current PIN
    console.log('Test 2: Rejecting wrong current PIN...');
    {
      const { req, res, getStatus, getBody } = createMockReqRes(
        { currentPin: '000000', newPin: '987654', confirmPin: '987654' },
        validSession
      );
      await portal.handleApiChangePin(req, res, validSession, '127.0.0.1', mockWaClient);
      assert.strictEqual(getStatus(), 400, 'Wrong current PIN must return 400');
      assert.strictEqual(getBody().error, 'PIN keamanan saat ini salah.');
      console.log('✅ PASS: Wrong current PIN rejected.');
    }

    // Test 3: Reject non-numeric new PIN
    console.log('Test 3: Rejecting non-numeric new PIN...');
    {
      const { req, res, getStatus, getBody } = createMockReqRes(
        { currentPin: originalPin, newPin: 'abcd12', confirmPin: 'abcd12' },
        validSession
      );
      await portal.handleApiChangePin(req, res, validSession, '127.0.0.1', mockWaClient);
      assert.strictEqual(getStatus(), 400, 'Non-numeric PIN must return 400');
      assert.ok(getBody().error.includes('angka numerik'));
      console.log('✅ PASS: Non-numeric PIN rejected.');
    }

    // Test 4: Reject too short or too long new PIN
    console.log('Test 4: Rejecting invalid length new PIN (<4 or >8 digits)...');
    {
      const { req, res, getStatus, getBody } = createMockReqRes(
        { currentPin: originalPin, newPin: '12', confirmPin: '12' },
        validSession
      );
      await portal.handleApiChangePin(req, res, validSession, '127.0.0.1', mockWaClient);
      assert.strictEqual(getStatus(), 400, 'Short PIN must return 400');
      console.log('✅ PASS: Short PIN (<4) rejected.');
    }

    // Test 5: Reject mismatched confirmPin
    console.log('Test 5: Rejecting mismatched confirmation PIN...');
    {
      const { req, res, getStatus, getBody } = createMockReqRes(
        { currentPin: originalPin, newPin: '987654', confirmPin: '987655' },
        validSession
      );
      await portal.handleApiChangePin(req, res, validSession, '127.0.0.1', mockWaClient);
      assert.strictEqual(getStatus(), 400, 'Mismatch confirmation must return 400');
      assert.ok(getBody().error.includes('tidak sesuai') || getBody().error.includes('tidak cocok'));
      console.log('✅ PASS: Mismatched confirmation rejected.');
    }

    // Test 6: Reject identical new PIN (same as current)
    console.log('Test 6: Rejecting new PIN identical to current PIN...');
    {
      const { req, res, getStatus, getBody } = createMockReqRes(
        { currentPin: originalPin, newPin: originalPin, confirmPin: originalPin },
        validSession
      );
      await portal.handleApiChangePin(req, res, validSession, '127.0.0.1', mockWaClient);
      assert.strictEqual(getStatus(), 400, 'Identical PIN must return 400');
      assert.ok(getBody().error.includes('tidak boleh sama'));
      console.log('✅ PASS: Identical PIN rejected.');
    }

    // Test 7: Successful PIN change
    console.log('Test 7: Accepting valid PIN change...');
    const targetNewPin = '741852';
    {
      const { req, res, getStatus, getBody } = createMockReqRes(
        { currentPin: originalPin, newPin: targetNewPin, confirmPin: targetNewPin },
        validSession
      );
      await portal.handleApiChangePin(req, res, validSession, '127.0.0.1', mockWaClient);
      assert.strictEqual(getStatus(), 200, 'Valid PIN change must return 200');
      assert.strictEqual(getBody().success, true);
      assert.strictEqual(config.securityPin, targetNewPin, 'config.securityPin must be updated');
      assert.strictEqual(config.dashboardPass, targetNewPin, 'config.dashboardPass must be updated');
      assert.strictEqual(mockWaClient.adminSessions.size, 0, 'Active WA sessions must be cleared');
      assert.strictEqual(mockWaClient.pendingActions.size, 0, 'Pending actions must be cleared');
      assert.strictEqual(mockWaClient.pendingCommands.size, 0, 'Pending commands must be cleared');

      // Verify persistence in .env
      const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
      assert.ok(envContent.includes(`SECURITY_PIN=${targetNewPin}`), '.env must contain updated SECURITY_PIN');
      assert.ok(envContent.includes(`DASHBOARD_PASS=${targetNewPin}`), '.env must contain updated DASHBOARD_PASS');
      console.log('✅ PASS: PIN changed successfully, in-memory updated, .env persisted, bot sessions invalidated.');
    }

    // Test 8: Cluster sync-pin command execution
    console.log('Test 8: Testing cluster sync-pin command execution...');
    {
      const clusterNewPin = '852963';
      const syncResult = await cluster.executeLocalSecurityCommand('sync-pin', { pin: clusterNewPin });
      assert.strictEqual(syncResult.success, true);
      assert.strictEqual(config.securityPin, clusterNewPin, 'Cluster sync must update config.securityPin');
      assert.strictEqual(config.dashboardPass, clusterNewPin, 'Cluster sync must update config.dashboardPass');
      const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
      assert.ok(envContent.includes(`SECURITY_PIN=${clusterNewPin}`), 'Cluster sync must update .env');
      console.log('✅ PASS: Cluster sync-pin command verified.');
    }

    console.log('\n🎉 ALL SECURITY PIN MODULE TESTS PASSED PERFECTLY!\n');
  } finally {
    // Restore original state
    if (originalEnvContent !== null) {
      fs.writeFileSync(path.join(__dirname, '..', '.env'), originalEnvContent, 'utf8');
    }
    config.securityPin = originalPin;
    config.dashboardPass = originalPin;
    process.env.SECURITY_PIN = originalPin;
    process.env.DASHBOARD_PASS = originalPin;
    console.log('ℹ️ Environment and config restored to initial state.');
  }
}

testPinChange().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

