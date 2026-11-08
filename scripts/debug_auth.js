const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const credsPath = path.join(rootDir, 'session_auth', 'creds.json');
const envPath = path.join(rootDir, '.env');
const contactsPath = path.join(rootDir, 'inventory', 'emergency_contacts.json');
const config = require('../src/config');
const cluster = require('../src/cluster');

console.log('=== DEBUG AUTH & BOT SESSION ===');

if (fs.existsSync(credsPath)) {
  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    console.log('[Creds] me:', creds.me);
    console.log('[Creds] account:', creds.account ? 'Exists' : 'None');
  } catch (e) {
    console.log('[Creds] Error reading:', e.message);
  }
} else {
  console.log('[Creds] creds.json does NOT exist');
}

console.log('[Config] adminNumbers:', config.adminNumbers);
console.log('[Config] isAdmin(6285378587299@s.whatsapp.net):', config.isAdmin('6285378587299@s.whatsapp.net'));
console.log('[Config] isAdmin(135463369228519@lid):', config.isAdmin('135463369228519@lid'));

const nodes = Array.from(cluster.nodes.values());
console.log('[Cluster] Node count:', nodes.length);
nodes.forEach((n, idx) => {
  console.log(`  ${idx + 1}. ${n.name} (${n.nodeId}) - ${n.status}`);
});
