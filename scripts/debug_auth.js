const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const credsPath = path.join(rootDir, 'session_auth', 'creds.json');
const envPath = path.join(rootDir, '.env');
const contactsPath = path.join(rootDir, 'inventory', 'emergency_contacts.json');

// Auto-attach LID to contacts if needed
if (fs.existsSync(contactsPath)) {
  const d = JSON.parse(fs.readFileSync(contactsPath, 'utf8'));
  if (d.length > 0) {
    d[0].lid = '135463369228519';
    if (!d[0].lids) d[0].lids = [];
    if (!d[0].lids.includes('135463369228519')) d[0].lids.push('135463369228519');
    fs.writeFileSync(contactsPath, JSON.stringify(d, null, 2), 'utf8');
    console.log('[Contacts] Synced LID 135463369228519 to:', d[0].name);
  }
}

const config = require('../src/config');
const contactsManager = require('../src/contacts');

console.log('=== DEBUG AUTH & BOT SESSION ===');

if (fs.existsSync(credsPath)) {
  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    console.log('[Creds] me:', creds.me);
  } catch (e) {
    console.log('[Creds] Error:', e.message);
  }
}

console.log('[Config] adminNumbers:', config.adminNumbers);
console.log('[Config] isAdmin(6285378587299@s.whatsapp.net):', config.isAdmin('6285378587299@s.whatsapp.net'));
console.log('[Config] isAdmin(135463369228519@lid):', config.isAdmin('135463369228519@lid'));
console.log('[Contacts] isEmergencyContact(135463369228519):', contactsManager.isEmergencyContact('135463369228519'));
console.log('[Contacts] isEmergencyContact(6285378587299):', contactsManager.isEmergencyContact('6285378587299'));
