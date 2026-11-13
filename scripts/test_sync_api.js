const http = require('http');

function post(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cluster-secret': 'secops-cluster-token-secret-2026',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch { resolve(b); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  console.log('Testing sync-db-status on VPS (via http://62.72.20.122:5005/api/cluster/execute)...');
  const res = await post('http://62.72.20.122:5005/api/cluster/execute', { command: 'sync-db-status' });
  console.log('Response:', JSON.stringify(res, null, 2));
}

run().catch(console.error);

