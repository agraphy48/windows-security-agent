const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const credsPath = path.join(rootDir, 'session_auth', 'creds.json');
const envPath = path.join(rootDir, '.env');
const contactsPath = path.join(rootDir, 'inventory', 'emergency_contacts.json');

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

if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  const m = env.match(/ADMIN_NUMBERS=(.*)/);
  console.log('[Env] ADMIN_NUMBERS:', m ? m[1] : 'Not found');
}

if (fs.existsSync(contactsPath)) {
  try {
    const contacts = JSON.parse(fs.readFileSync(contactsPath, 'utf8'));
    console.log('[Contacts] List:', contacts.map(c => ({ number: c.number, name: c.name, active: c.active })));
  } catch (e) {
    console.log('[Contacts] Error:', e.message);
  }
}
