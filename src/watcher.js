const security = require('./security');
const config = require('./config');

class SecurityWatcher {
  constructor(whatsappClient) {
    this.wa = whatsappClient;
    this.seenThreats = new Set();
    this.lastCpuAlert = 0;
    this.highCpuStreak = 0;
    this.intervalId = null;
    this.initialized = false;
  }

  start() {
    if (this.intervalId) return;
    console.log(`[🛡️ Watcher] Memulai monitoring keamanan setiap ${config.watcherIntervalSeconds} detik...`);
    
    // Initial populate existing threats so we don't alert on past events on reboot
    this.initExistingThreats().then(() => {
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
      this.initialized = true;
      console.log(`[🛡️ Watcher] Database ancaman awal dimuat: ${this.seenThreats.size} ancaman lampau.`);
    } catch (err) {
      console.error('[🛡️ Watcher] Gagal inisialisasi ancaman:', err.message);
      this.initialized = true;
    }
  }

  async check() {
    if (!this.initialized) return;

    try {
      // 1. Cek Windows Defender Threat Detection
      await this.checkNewThreats();

      // 2. Cek CPU & RAM Spikes
      await this.checkSystemHealth();
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

  async broadcastAlert(message) {
    console.log(`[🔔 Security Alert]\n${message}`);
    if (!this.wa || !this.wa.sock) {
      // Jika node ini adalah worker/standby tanpa WA socket aktif, teruskan alert ke Master
      if (config.clusterRole !== 'master') {
        const cluster = require('./cluster');
        await cluster.sendAlertToMaster(message, 'SECURITY_ALERT');
      }
      return;
    }

    for (const adminNumber of config.adminNumbers) {
      try {
        const jid = `${adminNumber}@s.whatsapp.net`;
        await this.wa.sock.sendMessage(jid, { text: message });
      } catch (err) {
        console.error(`[Watcher] Gagal kirim notif ke ${adminNumber}:`, err.message);
      }
    }
  }
}

module.exports = SecurityWatcher;

