const http = require('http');
const config = require('../src/config');
const cluster = require('../src/cluster');
const security = require('../src/security');
const webPortal = require('../src/webPortal');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 TESTING NEW SECOPS FEATURES');
  console.log('====================================================\n');

  // TEST 1: Cluster Status Report
  console.log('▶ TEST 1: Cluster Status Report Generation');
  try {
    const report = cluster.getClusterStatusReport();
    console.log('Cluster Report Preview:\n', report.substring(0, 300) + '...\n');
    if (report.includes('STATUS ARSITEKTUR & TOPOLOGI CLUSTER')) {
      console.log('✅ TEST 1 PASSED: Cluster report formatted successfully.\n');
    } else {
      console.error('❌ TEST 1 FAILED: Unexpected format');
    }
  } catch (err) {
    console.error('❌ TEST 1 FAILED:', err.message);
  }

  // TEST 2: GDrive Backup Status (Local)
  console.log('▶ TEST 2: GDrive Backup Status Query');
  try {
    const backupStatus = await security.getGdriveBackupStatus();
    console.log('Backup Status Result:', backupStatus);
    if (backupStatus.success) {
      console.log('✅ TEST 2 PASSED: Backup status queried cleanly.\n');
    } else {
      console.error('❌ TEST 2 FAILED');
    }
  } catch (err) {
    console.error('❌ TEST 2 FAILED:', err.message);
  }

  // TEST 3: Web Portal 2FA with Email & WhatsApp Channels
  console.log('▶ TEST 3: Web Portal 2FA Channel Verification');
  try {
    // Start temporary test server
    const server = http.createServer(async (req, res) => {
      const handled = await webPortal.handleRequest(req, res, {
        isConnected: true,
        broadcastToAdmins: async (msg) => {
          console.log('  [Mock WhatsApp] Broadcast dispatched:', msg.split('\n')[2]);
        }
      });
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(r => server.listen(5099, '127.0.0.1', r));
    console.log('  Test HTTP server running at http://127.0.0.1:5099');

    // 3a. Get Login Page with host: 'pentest.portal-egn.com' to bypass raw IP bouncer
    const getRes = await fetch('http://127.0.0.1:5099/login', {
      headers: { host: 'pentest.portal-egn.com' }
    });
    const html = await getRes.text();
    const tokenMatch = html.match(/id="secToken" value="([^"]+)"/);
    const csrfToken = tokenMatch ? tokenMatch[1] : '';
    console.log('  CSRF Token obtained:', csrfToken ? 'YES' : 'NO');
    console.log('  Email option in HTML:', html.includes('agraphylearn@gmail.com') ? 'YES' : 'NO');
    console.log('  Multi-channel resend buttons:', html.includes('resendEmailBtn') && html.includes('resendWaBtn') ? 'YES' : 'NO');

    // Wait 750ms to pass timing honeypot
    await new Promise(r => setTimeout(r, 750));

    // 3b. Login with preferredChannel: 'email'
    const loginRes = await fetch('http://127.0.0.1:5099/api/login', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        host: 'pentest.portal-egn.com'
      },
      body: JSON.stringify({
        username: config.dashboardUser || 'admin',
        password: config.dashboardPass || '465157',
        channel: 'email',
        _sec_token: csrfToken,
        _hp_website: '',
        _hp_sec_code: ''
      })
    });
    const loginData = await loginRes.json();
    console.log('  Login (channel: email) response:', loginData);

    if (loginData.require2FA && loginData.twoFaToken) {
      console.log('  2FA Token generated:', loginData.twoFaToken);
      const pending = webPortal.pending2Fa.get(loginData.twoFaToken);
      console.log('  Pending 2FA Record:', {
        username: pending?.username,
        channel: pending?.channel,
        otp: pending?.otp,
        expiresInSec: Math.round((pending?.expiresAt - Date.now()) / 1000)
      });

      // 3c. Verify OTP
      const verifyRes = await fetch('http://127.0.0.1:5099/api/login/verify-2fa', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          host: 'pentest.portal-egn.com'
        },
        body: JSON.stringify({
          twoFaToken: loginData.twoFaToken,
          otp: pending.otp
        })
      });
      const verifyData = await verifyRes.json();
      console.log('  Verify OTP response:', verifyData);

      if (verifyData.success) {
        console.log('✅ TEST 3 PASSED: Full 2FA lifecycle with Email/WhatsApp channel support successful!\n');
      } else {
        console.error('❌ TEST 3 FAILED: Verify OTP returned error');
      }
    } else {
      console.log('  Login response did not require 2FA:', loginData);
    }

    server.close();
  } catch (err) {
    console.error('❌ TEST 3 FAILED:', err.message);
  }

  console.log('====================================================');
  console.log('🎉 ALL FEATURE TESTS FINISHED');
  console.log('====================================================');
}

runTests();
