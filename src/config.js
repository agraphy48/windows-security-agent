const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const rawAdmins = (process.env.ADMIN_NUMBERS || '')
  .split(',')
  .map(n => n.replace(/[^0-9]/g, ''))
  .filter(Boolean);

let rawMasterUrl = (process.env.MASTER_URL || 'http://127.0.0.1:5005').trim();
if (!/^https?:\/\//i.test(rawMasterUrl)) {
  rawMasterUrl = `https://${rawMasterUrl}`;
}
rawMasterUrl = rawMasterUrl.replace(/\/+$/, '');

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

  // Web Portal Dashboard Authentication
  dashboardUser: process.env.DASHBOARD_USER || 'admin',
  dashboardPass: process.env.DASHBOARD_PASS || process.env.SECURITY_PIN || '465157',
  dashboard2Fa: (process.env.DASHBOARD_2FA ?? 'true').toLowerCase() === 'true',

  // Email & 2FA Configuration
  adminEmail: process.env.ADMIN_EMAIL || 'agraphylearn@gmail.com',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpSecure: (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || '',

  // Cluster & High-Availability Failover Configuration
  clusterEnabled: (process.env.CLUSTER_ENABLED || 'false').toLowerCase() === 'true',
  clusterRole: (process.env.CLUSTER_ROLE || 'master').toLowerCase(), // 'master' | 'standby' | 'worker'
  nodeId: process.env.NODE_ID || 'node-01',
  nodeName: process.env.NODE_NAME || 'Server Utama (Windows)',
  clusterPort: parseInt(process.env.CLUSTER_PORT || '5005', 10),
  clusterUrl: process.env.CLUSTER_URL || '',
  masterUrl: rawMasterUrl,
  knownWorkers: (process.env.KNOWN_WORKERS || '')
    .split(',')
    .map(w => w.trim())
    .filter(Boolean),
  clusterSecret: process.env.CLUSTER_SECRET || 'secops-cluster-token-secret-2026',
  failoverTimeoutSeconds: parseInt(process.env.FAILOVER_TIMEOUT_SECONDS || '30', 10),

  isAdmin(senderJid) {
    if (!senderJid) return false;
    const cleanNumber = senderJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    // If no admin numbers configured yet, allow the first user who scans or sends command (with a warning)
    if (this.adminNumbers.length === 0) {
      return true;
    }
    if (this.adminNumbers.includes(cleanNumber)) {
      return true;
    }
    try {
      const contacts = require('./contacts');
      return contacts.isEmergencyContact(senderJid);
    } catch {
      return false;
    }
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

