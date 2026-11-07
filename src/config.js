const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const rawAdmins = (process.env.ADMIN_NUMBERS || '')
  .split(',')
  .map(n => n.replace(/[^0-9]/g, ''))
  .filter(Boolean);

const config = {
  adminNumbers: rawAdmins,
  qrPort: parseInt(process.env.QR_PORT, 10) || 5005,
  watcherIntervalSeconds: parseInt(process.env.WATCHER_INTERVAL_SECONDS, 10) || 30,
  ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2:3b',
  sessionDir: path.join(__dirname, '..', 'session_auth'),
  cloudflareExe: process.env.CLOUDFLARE_EXE || 'D:\\AI-Server\\tools\\cloudflared.exe',
  cloudflareArgs: process.env.CLOUDFLARE_ARGS || 'tunnel --config C:\\Users\\agrap\\.cloudflared\\config.yml run 67775b37-cc35-49c5-9cf2-7135fabea95a',
  securityPin: process.env.SECURITY_PIN || '1234',
  requirePin: (process.env.REQUIRE_PIN || 'true').toLowerCase() === 'true',
  requirePinAll: (process.env.REQUIRE_PIN_ALL ?? 'true').toLowerCase() === 'true',
  pinTimeoutMinutes: parseInt(process.env.PIN_TIMEOUT_MINUTES ?? '15', 10),
  intruderAlert: (process.env.INTRUDER_ALERT || 'true').toLowerCase() === 'true',

  isAdmin(senderJid) {
    if (!senderJid) return false;
    const cleanNumber = senderJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    // If no admin numbers configured yet, allow the first user who scans or sends command (with a warning)
    if (this.adminNumbers.length === 0) {
      return true;
    }
    return this.adminNumbers.includes(cleanNumber);
  },

  addAdmin(number) {
    const clean = number.replace(/[^0-9]/g, '');
    if (clean && !this.adminNumbers.includes(clean)) {
      this.adminNumbers.push(clean);
      return true;
    }
    return false;
  }
};

module.exports = config;

