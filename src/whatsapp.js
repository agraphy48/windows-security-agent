const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const http = require('http');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const security = require('./security');

class WhatsAppClient {
  constructor() {
    this.sock = null;
    this.currentQrDataUrl = null;
    this.isConnected = false;
    this.httpServer = null;
    this.pendingActions = new Map(); // cleanSender -> { action, target, expiresAt }
    this.intruderAlerts = new Map(); // cleanSender -> lastAlertTimestamp
  }

  async start() {
    this.startQrWebServer();
    await this.initBaileys();
  }

  startQrWebServer() {
    this.httpServer = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/qr') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (this.isConnected) {
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Security Agent Status</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="font-family:sans-serif;text-align:center;padding:50px;background:#0d1117;color:#fff;">
              <h1 style="color:#2ea44f;">✅ WhatsApp Terhubung!</h1>
              <p>Security Agent siap memantau server Windows.</p>
              <p>Ketik <b>!help</b> di WhatsApp untuk melihat daftar perintah.</p>
            </body>
            </html>
          `);
        } else if (this.currentQrDataUrl) {
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Scan WhatsApp Security Agent</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <meta http-equiv="refresh" content="5">
            </head>
            <body style="font-family:sans-serif;text-align:center;padding:30px;background:#0d1117;color:#fff;">
              <h2>Scan QR Code WhatsApp Security Agent</h2>
              <p>Buka WhatsApp di Ponsel &gt; Perangkat Tertaut &gt; Tautkan Perangkat</p>
              <div style="background:#fff;padding:20px;display:inline-block;border-radius:12px;margin:20px 0;">
                <img src="${this.currentQrDataUrl}" alt="WhatsApp QR Code" style="width:280px;height:280px;" />
              </div>
              <p style="color:#8b949e;font-size:14px;">Halaman akan memperbarui status otomatis setiap 5 detik.</p>
            </body>
            </html>
          `);
        } else {
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><meta http-equiv="refresh" content="2"></head>
            <body style="font-family:sans-serif;text-align:center;padding:50px;background:#0d1117;color:#fff;">
              <h3>Membuat QR Code...</h3>
              <p>Tunggu sebentar...</p>
            </body>
            </html>
          `);
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.httpServer.listen(config.qrPort, () => {
      console.log(`[🌐 QR Web Portal] Siap di http://localhost:${config.qrPort}`);
    });
  }

  async initBaileys() {
    if (!fs.existsSync(config.sessionDir)) {
      fs.mkdirSync(config.sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[WA] Menggunakan WA Web v${version.join('.')}, isLatest: ${isLatest}`);

    this.sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: ['Windows Security Agent', 'Chrome', '1.0.0'],
      generateHighQualityLinkPreview: false
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n================== SCAN QR CODE DI BAWAH INI ==================');
        qrcodeTerminal.generate(qr, { small: true });
        console.log(`Atau buka di browser: http://localhost:${config.qrPort}`);
        console.log('================================================================\n');

        try {
          this.currentQrDataUrl = await QRCode.toDataURL(qr);
        } catch (e) {
          console.error('Gagal generate QR DataURL:', e.message);
        }
      }

      if (connection === 'close') {
        this.isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[WA] Koneksi terputus (status: ${statusCode}). Mencoba hubungkan ulang: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(() => this.initBaileys(), 3000);
        } else {
          console.log('[WA] Sesi telah logout. Silakan scan ulang QR Code.');
          try {
            fs.rmSync(config.sessionDir, { recursive: true, force: true });
          } catch {}
          setTimeout(() => this.initBaileys(), 2000);
        }
      } else if (connection === 'open') {
        this.isConnected = true;
        this.currentQrDataUrl = null;
        console.log('\n================================================================');
        console.log('🎉 WHATSAPP SECURITY AGENT BERHASIL TERHUBUNG!');
        console.log(`Admin terdaftar: ${config.adminNumbers.length > 0 ? config.adminNumbers.join(', ') : '(Belum ada - Nomor yang pertama kirim pesan akan dijadikan admin)'}`);
        console.log('================================================================\n');
      }
    });

    this.sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      for (const msg of m.messages) {
        if (!msg.message || msg.key.fromMe) continue;
        await this.handleIncomingMessage(msg);
      }
    });
  }

  async handleIncomingMessage(msg) {
    const senderJid = msg.key.remoteJid;
    if (senderJid.endsWith('@g.us') || senderJid === 'status@broadcast') return; // Abaikan grup dan status

    const text = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ''
    ).trim();

    if (!text) return;

    // Verifikasi Otorisasi Admin
    const cleanSender = senderJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

    // Jika admin list masih kosong, jadikan pengirim pertama sebagai admin otomatis
    if (config.adminNumbers.length === 0) {
      config.addAdmin(cleanSender);
      // Simpan nomor ke file .env
      try {
        const envPath = path.join(__dirname, '..', '.env');
        let content = fs.readFileSync(envPath, 'utf8');
        content = content.replace(/ADMIN_NUMBERS=.*/g, `ADMIN_NUMBERS=${cleanSender}`);
        fs.writeFileSync(envPath, content, 'utf8');
        console.log(`[Auth] Nomor ${cleanSender} otomatis didaftarkan sebagai Admin Utama di .env!`);
      } catch (err) {
        console.error('Gagal update .env:', err.message);
      }

      await this.reply(senderJid, `🛡️ *Security Agent:* Nomor Anda (*${cleanSender}*) telah didaftarkan sebagai *Admin Utama Server*.\nKetik *!help* untuk melihat daftar kendali.`);
    }

    if (!config.isAdmin(senderJid)) {
      console.log(`[⚠️ Akses Ditolak] Pesan dari nomor tidak dikenal: ${cleanSender}`);

      // Intruder Alert ke WhatsApp Admin Utama
      if (config.intruderAlert && config.adminNumbers.length > 0) {
        const now = Date.now();
        const lastAlert = this.intruderAlerts.get(cleanSender) || 0;
        // Batasi notifikasi max 1 kali per 3 menit per nomor asing agar tidak spam
        if (now - lastAlert > 3 * 60 * 1000) {
          this.intruderAlerts.set(cleanSender, now);
          const alertMsg = 
`🚨 *PERINGATAN PENYUSUP (AKSES DITOLAK)* 🚨
-----------------------------------------
Ada nomor tidak dikenal mencoba menghubungi bot server Anda!
• *Nomor Pengirim:* +${cleanSender}
• *Waktu:* ${new Date().toLocaleString('id-ID')}
• *Isi Pesan:* "${text.substring(0, 150)}"
• *Status:* 🛡️ Akses diblokir otomatis. Pesan tidak dibalas.
-----------------------------------------`;

          for (const adminNum of config.adminNumbers) {
            try {
              await this.sock.sendMessage(`${adminNum}@s.whatsapp.net`, { text: alertMsg });
            } catch (err) {
              console.error('Gagal kirim alert penyusup:', err.message);
            }
          }
        }
      }
      return; // Abaikan diam-diam untuk keamanan
    }

    // Periksa apakah Admin sedang dalam proses konfirmasi PIN tindakan kritis
    if (this.pendingActions.has(cleanSender)) {
      const pending = this.pendingActions.get(cleanSender);
      const now = Date.now();

      if (now > pending.expiresAt) {
        this.pendingActions.delete(cleanSender);
      } else {
        const trimmed = text.trim().toLowerCase();

        // Admin membatalkan
        if (trimmed === 'batal' || trimmed === 'cancel') {
          this.pendingActions.delete(cleanSender);
          return await this.reply(senderJid, '✅ Tindakan kritis telah dibatalkan.');
        }

        // Cek PIN
        let inputPin = text.trim();
        if (inputPin.toLowerCase().startsWith('pin ')) {
          inputPin = inputPin.substring(4).trim();
        }

        if (inputPin === config.securityPin) {
          this.pendingActions.delete(cleanSender);
          await this.reply(senderJid, '🔑 PIN terverifikasi. Mengeksekusi tindakan...');
          return await this.executeAction(senderJid, pending.action, pending.target);
        } else {
          this.pendingActions.delete(cleanSender);
          return await this.reply(senderJid, '❌ PIN keamanan salah! Tindakan dibatalkan demi keamanan server.');
        }
      }
    }

    console.log(`[📩 Pesan Masuk dari ${cleanSender}]: "${text}"`);

    // Proses Perintah
    try {
      await this.processCommand(senderJid, text);
    } catch (err) {
      console.error('[Command Error]', err);
      await this.reply(senderJid, `❌ Terjadi kesalahan saat memproses perintah: ${err.message}`);
    }
  }

  async processCommand(senderJid, text) {
    const raw = text.trim();
    const lower = raw.toLowerCase();
    const cleanSender = senderJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

    // 1. Menu Perintah / Monitor
    if (
      lower === 'monitor' ||
      lower === '!monitor' ||
      lower === 'menu' ||
      lower === '!menu' ||
      lower === 'help' ||
      lower === '!help' ||
      lower === '1' ||
      lower === '!1'
    ) {
      const menu = 
`🛡️ *PANEL MONITORING & KEAMANAN SERVER* 🛡️
-----------------------------------------
Silakan balas dengan *NOMOR* atau *NAMA PERINTAH*:

*1.* !help
   ↳ Menampilkan menu bantuan dan daftar semua perintah.

*2.* !status
   ↳ Ringkasan pemakaian CPU, RAM (dari 64 GB), sisa Disk, Uptime, & Defender.

*3.* !threats
   ↳ Riwayat ancaman/virus yang pernah terdeteksi & diisolasi Defender.

*4.* !scan
   ↳ Memicu Quick Scan antivirus Windows Defender di latar belakang.

*5.* !scan-full
   ↳ Memicu Full Scan menyeluruh pada seluruh drive server.

*6.* !ports
   ↳ Memindai port TCP aktif (80, 443, 3001, 5432, 8080, 11434, dll.) & prosesnya.

*7.* !docker
   ↳ Cek status semua container Docker yang sedang berjalan.

*8.* !docker restart <nama>
   ↳ Me-restart container Docker tertentu.
   _(Contoh: ketik *8 ujian_backend* atau cukup ketik *8*)_

*9.* !block <IP>
   ↳ Menambahkan aturan blokir IP langsung ke Firewall (${security.isWindows ? 'Windows Firewall' : 'UFW/IPTables'}).
   _(Contoh: ketik *9 192.168.1.100* atau cukup ketik *9*)_

*10.* !lockdown
   ↳ Mode Darurat: Memutus Cloudflare Tunnel seketika jika diserang.

*11.* !restore
   ↳ Mengaktifkan kembali Cloudflare Tunnel ke domain kedukanaksara.com.
-----------------------------------------
💡 *Cukup ketik nomornya saja (contoh: 2) untuk memilih.*`;
      return await this.reply(senderJid, menu);
    }

    // 2. Status Server
    if (lower === '2' || lower === '!2' || lower === '!status' || lower === 'status') {
      await this.reply(senderJid, '⏳ Mengambil data performa dan kesehatan server...');
      const health = await security.getSystemHealth();
      const def = await security.getDefenderStatus();

      const driveStr = (health.Drives || []).map(d => `  - Drive ${d.Name}: ${d.UsedGB} GB terpakai / ${d.TotalGB} GB (Sisa ${d.FreeGB} GB)`).join('\n');

      const response = 
`💻 *STATUS SERVER ${security.osName.toUpperCase()}*
-----------------------------------------
• *Uptime:* ${health.Uptime || 'N/A'}
• *CPU Load:* ${health.CPU || 0}%
• *RAM Terpakai:* ${health.UsedRamGB || 0} GB / ${health.TotalRamGB || 0} GB (${health.RamPercent || 0}%)
• *Penyimpanan Disk:*
${driveStr || '  - Tidak ada data drive'}

🛡️ *${def.Name || (security.isWindows ? 'Windows Defender' : 'Keamanan Linux')}:*
• *Antivirus:* ${def.AntivirusEnabled ? '✅ Aktif' : '❌ Nonaktif / Belum Terpasang'}
• *Proteksi Real-Time:* ${def.RealTimeProtection ? '✅ Aktif' : '❌ Nonaktif'}
• *Engine Version:* ${def.EngineVersion || 'N/A'}
-----------------------------------------`;
      return await this.reply(senderJid, response);
    }

    // 3. Riwayat Virus / Threats
    if (lower === '3' || lower === '!3' || lower === '!threats' || lower === 'threats') {
      await this.reply(senderJid, '⏳ Memeriksa riwayat deteksi Windows Defender...');
      const threats = await security.getRecentThreats(5);
      if (!threats || threats.length === 0) {
        return await this.reply(senderJid, '✅ *Kondisi Bersih:* Tidak ada ancaman virus atau malware aktif yang terdeteksi.');
      }

      let res = `🛡️ *DAFTAR ANCAMAN TERDETEKSI (${threats.length})*\n-----------------------------------------\n`;
      threats.forEach((t, i) => {
        res += `${i + 1}. *${t.ThreatName}*\n`;
        res += `   • Waktu: ${t.Time}\n`;
        res += `   • Status: ${t.Remediated ? '✅ Telah Diisolasi' : '⚠️ Masih Berbahaya'}\n`;
        res += `   • Target: \`${t.Resources?.substring(0, 100) || 'N/A'}...\`\n\n`;
      });
      res += `Ketik *4* atau *!scan* untuk memulai pembersihan mendalam.`;
      return await this.reply(senderJid, res);
    }

    // 4. Quick Scan Antivirus
    if (lower === '4' || lower === '!4' || lower === '!scan' || lower === 'scan') {
      await this.reply(senderJid, '🚀 Memulai *Quick Scan* Windows Defender di latar belakang...');
      const res = await security.startQuickScan();
      return await this.reply(senderJid, `✅ ${res}\nAnda akan menerima notifikasi jika ada virus yang ditemukan.`);
    }

    // 5. Full Scan Antivirus
    if (lower === '5' || lower === '!5' || lower === '!scan-full' || lower === 'scan full') {
      await this.reply(senderJid, '🚀 Memulai *Full Scan* menyeluruh pada semua partisi Windows Defender...');
      const res = await security.startFullScan();
      return await this.reply(senderJid, `✅ ${res}\nProses ini memerlukan waktu lebih lama.`);
    }

    // 6. Cek Port Terbuka
    if (lower === '6' || lower === '!6' || lower === '!ports' || lower === 'ports') {
      await this.reply(senderJid, '⏳ Memindai port TCP yang sedang mendengar (LISTENING)...');
      const ports = await security.getListeningPorts();
      if (!ports || ports.length === 0) {
        return await this.reply(senderJid, 'Tidak ada data port yang dapat diakses.');
      }

      const importantPorts = ports.filter(p => [80, 443, 3000, 3001, 4000, 5005, 5432, 5433, 6380, 8080, 9090, 11434].includes(p.Port));
      let out = `🔌 *RINGKASAN PORT LAYANAN UTAMA*\n-----------------------------------------\n`;
      importantPorts.forEach(p => {
        out += `• Port *${p.Port}* : ${p.Process} (PID: ${p.PID})\n`;
      });
      out += `\nTotal port aktif di sistem: ${ports.length} port.`;
      return await this.reply(senderJid, out);
    }

    // 7. Cek Docker
    if (lower === '7' || lower === '!7' || lower === '!docker' || lower === 'docker') {
      await this.reply(senderJid, '⏳ Memeriksa kontainer Docker...');
      const status = await security.getDockerStatus();
      return await this.reply(senderJid, `🐳 *STATUS DOCKER CONTAINERS*\n-----------------------------------------\n${status}\n\n💡 Ketik *8 <nama_container>* untuk me-restart container.`);
    }

    // 8. Restart Docker Container
    if (lower === '8' || lower === '!8') {
      const status = await security.getDockerStatus();
      return await this.reply(
        senderJid,
        `🐳 *RESTART DOCKER CONTAINER*\nSilakan ketik nomor 8 diikuti nama container.\n*Contoh:* \`8 ujian_backend\`\n\n*Container yang aktif saat ini:*\n${status}`
      );
    }
    if (lower.startsWith('8 ') || lower.startsWith('!8 ') || lower.startsWith('!docker restart ')) {
      const parts = raw.replace(/^(!docker restart|!8|8)\s+/i, '').trim().split(/\s+/);
      const containerName = parts[0];
      const inlinePin = parts[1] || null;
      return await this.requestPinOrExecute(
        senderJid,
        cleanSender,
        'restart_docker',
        containerName,
        'Restart Docker Container',
        containerName,
        inlinePin
      );
    }

    // 9. Blokir IP
    if (lower === '9' || lower === '!9') {
      return await this.reply(
        senderJid,
        `🧱 *BLOKIR IP DI FIREWALL*\nSilakan ketik nomor 9 diikuti alamat IP yang ingin diblokir.\n*Contoh:* \`9 192.168.1.100\` atau \`!block 192.168.1.100\``
      );
    }
    if (lower.startsWith('9 ') || lower.startsWith('!9 ') || lower.startsWith('!block ')) {
      const parts = raw.replace(/^(!block|!9|9)\s+/i, '').trim().split(/\s+/);
      const ip = parts[0];
      const inlinePin = parts[1] || null;
      return await this.requestPinOrExecute(
        senderJid,
        cleanSender,
        'block_ip',
        ip,
        'Blokir IP di Firewall',
        ip,
        inlinePin
      );
    }

    // 10. Emergency Lockdown
    if (
      lower === '10' ||
      lower === '!10' ||
      lower === '!lockdown' ||
      lower === 'lockdown' ||
      lower.startsWith('10 ') ||
      lower.startsWith('!10 ') ||
      lower.startsWith('!lockdown ')
    ) {
      const parts = raw.split(/\s+/);
      const inlinePin = parts.length > 1 ? parts[1] : null;
      return await this.requestPinOrExecute(
        senderJid,
        cleanSender,
        'lockdown',
        null,
        'Emergency Lockdown (Putus Akses Luar)',
        'Cloudflare Tunnel',
        inlinePin
      );
    }

    // 11. Restore Tunnel
    if (lower === '11' || lower === '!11' || lower === '!restore' || lower === 'restore') {
      await this.reply(senderJid, '⏳ Mengaktifkan kembali Cloudflare Tunnel...');
      const result = await security.restoreCloudflare();
      return await this.reply(senderJid, `✅ ${result}`);
    }

    // 12. Fallback AI Response via Ollama (jika pesan berupa pertanyaan santai/diskusi)
    await this.replyWithAI(senderJid, text);
  }

  async requestPinOrExecute(senderJid, cleanSender, action, target, title, desc, inlinePin) {
    if (!config.requirePin) {
      return await this.executeAction(senderJid, action, target);
    }

    // Jika admin menyertakan PIN langsung (inline)
    if (inlinePin) {
      if (inlinePin === config.securityPin) {
        await this.reply(senderJid, '🔑 PIN terverifikasi. Mengeksekusi...');
        return await this.executeAction(senderJid, action, target);
      } else {
        return await this.reply(senderJid, '❌ PIN keamanan salah! Tindakan dibatalkan.');
      }
    }

    // Minta konfirmasi PIN secara interaktif
    this.pendingActions.set(cleanSender, {
      action,
      target,
      expiresAt: Date.now() + 60000
    });

    const msg = 
`⚠️ *KONFIRMASI TINDAKAN KRITIS* ⚠️
-----------------------------------------
• *Tindakan:* ${title}
• *Target:* \`${desc}\`

Silakan balas dengan PIN keamanan Anda:
Contoh: \`PIN 1234\` (atau cukup ketik angka PIN)

_Konfirmasi berlaku 60 detik. Ketik *batal* untuk batalkan._
-----------------------------------------`;
    return await this.reply(senderJid, msg);
  }

  async executeAction(senderJid, action, target) {
    if (action === 'restart_docker') {
      await this.reply(senderJid, `⏳ Merestart container *${target}*...`);
      const result = await security.restartDockerContainer(target);
      return await this.reply(senderJid, result);
    }
    if (action === 'block_ip') {
      await this.reply(senderJid, `🧱 Menerapkan aturan blokir untuk IP *${target}* di Firewall...`);
      const result = await security.blockIp(target);
      return await this.reply(senderJid, `🛡️ ${result}`);
    }
    if (action === 'lockdown') {
      await this.reply(senderJid, '🚨 Menjalankan protokol EMERGENSI: Memutus Cloudflare Tunnel...');
      const result = await security.emergencyLockdown();
      return await this.reply(senderJid, `${result}\nUntuk mengaktifkan kembali, ketik *11* atau *!restore*.`);
    }
  }

  async replyWithAI(senderJid, userQuestion) {
    try {
      const health = await security.getSystemHealth();
      const prompt = `Anda adalah SysAdmin & Security Guard Agent cerdas untuk server Windows ini.
Kondisi server saat ini:
- CPU: ${health.CPU}%
- RAM: ${health.UsedRamGB}GB / ${health.TotalRamGB}GB
- Uptime: ${health.Uptime}

Pertanyaan Admin: "${userQuestion}"

Jawablah dengan ringkas, ramah, dan profesional dalam Bahasa Indonesia. Jika memerlukan tindakan sistem, sarankan perintah yang sesuai (seperti !status, !scan, !threats, !ports, !docker).`;

      const response = await fetch(`${config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.ollamaModel,
          prompt,
          stream: false
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.response) {
          return await this.reply(senderJid, data.response.trim());
        }
      }
    } catch {
      // Jika Ollama tidak aktif / timeout
    }

    // Standby fallback
    await this.reply(
      senderJid,
      `🤖 Perintah tidak dikenali. Ketik *!help* untuk melihat daftar kendali yang tersedia, atau ketik *!status* untuk cek server.`
    );
  }

  async reply(jid, text) {
    if (!this.sock) return;
    try {
      await this.sock.sendMessage(jid, { text });
    } catch (err) {
      console.error(`[WA] Gagal membalas ke ${jid}:`, err.message);
    }
  }
}

module.exports = WhatsAppClient;

