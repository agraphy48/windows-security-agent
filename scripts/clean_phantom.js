const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const contactsPath = path.join(rootDir, 'inventory', 'emergency_contacts.json');

console.log('=== Cleaning Phantom / Ghost Numbers ===');

// 1. Update .env
if (fs.existsSync(envPath)) {
  let env = fs.readFileSync(envPath, 'utf8');
  if (env.includes('135463369228519')) {
    env = env.replace(/ADMIN_NUMBERS=.*/g, 'ADMIN_NUMBERS=6285378587299');
    fs.writeFileSync(envPath, env, 'utf8');
    console.log('[OK] Updated .env ADMIN_NUMBERS to 6285378587299');
  } else {
    console.log('[SKIP] .env does not contain ghost number');
  }
}

// 2. Clean emergency_contacts.json
if (fs.existsSync(contactsPath)) {
  try {
    let contacts = JSON.parse(fs.readFileSync(contactsPath, 'utf8'));
    const beforeCount = contacts.length;
    contacts = contacts.filter(c => c.number !== '135463369228519');
    fs.writeFileSync(contactsPath, JSON.stringify(contacts, null, 2), 'utf8');
    console.log(`[OK] emergency_contacts.json cleaned (from ${beforeCount} to ${contacts.length})`);
  } catch (err) {
    console.error('[ERROR] Failed to clean emergency_contacts.json:', err.message);
  }
}

console.log('=== Cleanup complete ===');

