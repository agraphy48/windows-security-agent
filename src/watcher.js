const path = require('path');
const fs = require('fs');
const security = require('./security');
const config = require('./config');

class SecurityWatcher {
  constructor(whatsappClient) {
    this.wa = whatsappClient;
    this.seenThreats = new Set();
    this.knownServices = new Map();
    this.inventoryPath = path.join(__dirname, '..', 'inventory', 'services_inventory.json');
    this.lastCpuAlert = 0;
    this.highCpuStreak = 0;
    this.intervalId = null;
    this.initialized = false;
  }

  start() {
    if (this.intervalId) return;
    console.log(`[🛡️ Watcher] Memulai monitoring keamanan & inventori layanan setiap ${config.watcherIntervalSeconds} detik...`);
    
    // Initial populate existing threats & services so we don't alert on past events on reboot
    Promise.all([
      this.initExistingThreats(),
      this.initServicesInventory()
    ]).then(() => {
      this.intervalId = setInterval(() => this.check(), config.watcherIntervalSeconds * 1000);
      // Run first check after 5s
      setTimeout(() => this.check(), 5000);
    });
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async initExistingThreats() {
    try {
      const threats = await security.getRecentThreats(10);
      for (const t of threats) {
        if (t.DetectionID) this.seenThreats.add(t.DetectionID);
      }
      console.log(`[🛡️ Watcher] Database ancaman awal dimuat: ${this.seenThreats.size} ancaman lampau.`);
    } catch (err) {
      console.error('[🛡️ Watcher] Gagal inisialisasi ancaman:', err.message);
    }
  }

  async initServicesInventory() {
    try {
      const invDir = path.dirname(this.inventoryPath);
      if (!fs.existsSync(invDir)) {
        fs.mkdirSync(invDir, { recursive: true });
      }

      if (fs.existsSync(this.inventoryPath)) {
        const raw = fs.readFileSync(this.inventoryPath, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          for (const s of data) {
            this.knownServices.set(s.id, s);
          }
        }
        console.log(`[📋 Watcher] Inventori layanan awal dimuat dari disk: ${this.knownServices.size} layanan.`);
      } else {
        const services = await security.getDiscoveredServices();
        for (const s of services) {
          this.knownServices.set(s.id, {
            ...s,
            firstSeen: Date.now()
          });
        }
        this.saveServicesInventory();
        console.log(`[📋 Watcher] Inventori layanan awal diinisialisasi: ${this.knownServices.size} layanan terdaftar.`);
      }
      this.initialized = true;
    } catch (err) {
      console.error('[📋 Watcher] Gagal inisialisasi inventori layanan:', err.message);
      this.initialized = true;
    }
  }

  saveServicesInventory() {
    try {
      const invDir = path.dirname(this.inventoryPath);
      if (!fs.existsSync(invDir)) {
        fs.mkdirSync(invDir, { recursive: true });
      }
      fs.writeFileSync(this.inventoryPath, JSON.stringify(Array.from(this.knownServices.values()), null, 2), 'utf8');
    } catch (err) {
      console.error('[📋 Watcher] Gagal menyimpan inventori layanan:', err.message);
    }
  }

  async check() {
    if (!this.initialized) return;

    try {
      // 1. Cek Windows Defender Threat Detection
      await this.checkNewThreats();

      // 2. Cek CPU & RAM Spikes
      await this.checkSystemHealth();

      // 3. Cek Layanan & Aplikasi Baru (Dynamic Auto-Discovery)
      await this.checkNewServices();
    } catch (err) {
      console.error('[🛡️ Watcher Error]', err.message);
    }
  }

  async checkNewThreats() {
    const threats = await security.getRecentThreats(5);
    for (const t of threats) {
      if (t.DetectionID && !this.seenThreats.has(t.DetectionID)) {
        this.seenThreats.add(t.DetectionID);

        const alertMessage = 
`🚨 *PERINGATAN VIRUS/MALWARE BARU!* 🚨
--------------------------------------
• *Server/Node:* ${config.nodeName} (${config.nodeId})
• *Ancaman:* ${t.ThreatName}
• *Waktu:* ${t.Time}
• *Status:* ${t.Remediated ? '✅ Telah Diisolasi / Karantina' : '⚠️ BUTUH TINDAKAN!'}
• *Path / Target:* 
\`\`\`${t.Resources}\`\`\`
--------------------------------------
Ketik *threats* atau *node ${config.nodeId} threats* untuk riwayat lengkap.`;

        await this.broadcastAlert(alertMessage);
      }
    }
  }

  async checkSystemHealth() {
    const health = await security.getSystemHealth();
    if (!health || typeof health.CPU !== 'number') return;

    const now = Date.now();
    if (health.CPU >= 90) {
      this.highCpuStreak++;
      // Alert jika bertahan 2 kali berturut-turut dan belum dialert dalam 10 menit
      if (this.highCpuStreak >= 2 && (now - this.lastCpuAlert > 10 * 60 * 1000)) {
        this.lastCpuAlert = now;
        const msg = 
`⚠️ *PERINGATAN RESOURCE TINGGI* ⚠️
--------------------------------------
• *Server/Node:* ${config.nodeName} (${config.nodeId})
• *Beban CPU:* ${health.CPU}%
• *Penggunaan RAM:* ${health.UsedRamGB} GB / ${health.TotalRamGB} GB (${health.RamPercent}%)
• *Uptime:* ${health.Uptime}
--------------------------------------
Ketik *status* atau *node ${config.nodeId} status* untuk cek proses aktif.`;

        await this.broadcastAlert(msg);
      }
    } else {
      this.highCpuStreak = 0;
    }
  }

  async checkNewServices() {
    try {
      const current = await security.getDiscoveredServices();
      let hasNew = false;

      for (const s of current) {
        if (!this.knownServices.has(s.id)) {
          hasNew = true;
          const newEntry = {
            ...s,
            firstSeen: Date.now()
          };
          this.knownServices.set(s.id, newEntry);

          const portStr = s.ports && s.ports.length > 0 ? s.ports.join(', ') : 'Background / Internal';
          const catStr = s.category === 'application' ? '🌐 Aplikasi / Web Service' : '⚙️ Layanan Sistem';

          const alertMsg = 
`🆕 *DETEKSI LAYANAN / APLIKASI BARU!* 🆕
-----------------------------------------
• *Server/Node:* ${config.nodeName} (\`${config.nodeId}\`)
• *Nama Layanan:* *${s.name}*
• *Deskripsi:* ${s.displayName || s.name}
• *Kategori:* ${catStr}
• *Port Terikat:* \`${portStr}\`
• *Status:* 🟢 ${s.status.toUpperCase()}
• *Waktu Deteksi:* ${new Date().toLocaleString('id-ID')}
-----------------------------------------
ℹ️ Layanan ini otomatis dicatat ke inventori server & menu laporan.
👉 Balas *services* atau *report* untuk membuka menu laporan layanan.`;

          await this.broadcastAlert(alertMsg);
        }
      }

      if (hasNew) {
        this.saveServicesInventory();
      }
    } catch (err) {
      console.error('[📋 Watcher Error] Gagal memeriksa layanan baru:', err.message);
    }
  }

  async broadcastAlert(message, category = 'all') {
    console.log(`[🔔 Security Alert]\n${message}`);
    if (!this.wa || !this.wa.sock) {
      // Jika node ini adalah worker/standby tanpa WA socket aktif, teruskan alert ke Master
      if (config.clusterRole !== 'master') {
        const cluster = require('./cluster');
        await cluster.sendAlertToMaster(message, 'SECURITY_ALERT');
      }
      return;
    }

    await this.wa.broadcastToAdmins(message, category);
  }
}

module.exports = SecurityWatcher;
