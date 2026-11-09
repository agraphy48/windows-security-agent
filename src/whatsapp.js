const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const security = require('./security');
const cluster = require('./cluster');
const webPortal = require('./webPortal');
const contactsManager = require('./contacts');

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

class WhatsAppClient {
  constructor() {
    this.sock = null;
    this.currentQrDataUrl = null;
    this.isConnected = false;
    this.httpServer = null;
    this.pendingActions = new Map(); // cleanSender -> { action, target, targetNodeId, expiresAt }
    this.pendingCommands = new Map(); // cleanSender -> textToExecuteAfterUnlock
    this.adminSessions = new Map(); // cleanSender -> lastAuthTimestamp
    this.intruderAlerts = new Map(); // cleanSender -> lastAlertTimestamp
    this.userMenuState = new Map(); // cleanSender -> { step: 'CHOOSE_SERVER' | 'SERVER_ACTIONS', targetNodeId, targetNodeName, serverList }
    this.failedPinAttempts = new Map(); // cleanSender -> { count, lockedUntil } (Brute-Force Lockout)
    this.lastPairingCode = null;
    this.pairingExpiresAt = 0;
    this.pairingPhone = null;
  }

  async start() {
    this.startQrWebServer();
    await this.initBaileys();
  }

  startQrWebServer() {
    this.httpServer = http.createServer(async (req, res) => {
      try {
        // 1. Cek routing antarmuka Web Portal & API
        const handled = await webPortal.handleRequest(req, res, this);
        if (handled) {
          return;
        }
        if (!res.headersSent) {
          res.writeHead(404);
          res.end();
        }
      } catch (err) {
        console.error('[WebPortal Error]', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    });

    // Inisialisasi API Cluster & Failover
    cluster.init(this.httpServer);

    this.httpServer.listen(config.qrPort, () => {
      console.log(`[🌐 Web Portal & Cluster] Siap di http://localhost:${config.qrPort}`);
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
      browser: ['Server Security Agent', 'Chrome', '1.0.0'],
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
        this.lastPairingCode = null;
        this.pairingExpiresAt = 0;
        this.pairingPhone = null;
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

  getBotStatus() {
    let botNumber = null;
    let botName = null;
    const hasUser = !!(this.sock && this.sock.user);
    if (hasUser) {
      botNumber = this.sock.user.id ? this.sock.user.id.split('@')[0].split(':')[0] : null;
      botName = this.sock.user.name || null;
    }
    const isConnected = this.isConnected || hasUser;
    const isPairingActive = Date.now() < this.pairingExpiresAt;
    return {
      isConnected,
      botNumber,
      botName,
      hasQr: !!this.currentQrDataUrl,
      isPairingActive,
      lastPairingCode: isPairingActive ? this.lastPairingCode : null,
      pairingPhone: isPairingActive ? this.pairingPhone : null,
      pairingExpiresIn: isPairingActive ? Math.ceil((this.pairingExpiresAt - Date.now()) / 1000) : 0
    };
  }

  async getQrDataUrl() {
    if (!this.sock && !this.isConnected) {
      try {
        await this.initBaileys();
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error('[WA Gateway] Gagal inisialisasi QR:', err.message);
      }
    }
    return this.currentQrDataUrl;
  }

  async requestPairingCode(phoneNumber) {
    if (this.isConnected) {
      throw new Error('Bot saat ini sedang terhubung. Untuk menautkan nomor baru, silakan putuskan (logout) sesi terlebih dahulu.');
    }
    if (!phoneNumber) {
      throw new Error('Nomor WhatsApp harus diisi.');
    }
    let clean = phoneNumber.replace(/[^0-9]/g, '');
    if (clean.startsWith('08')) {
      clean = '628' + clean.slice(2);
    } else if (!clean.startsWith('62') && clean.startsWith('8')) {
      clean = '62' + clean;
    }
    if (clean.length < 10 || clean.length > 15) {
      throw new Error('Nomor telepon tidak valid. Gunakan format internasional atau lokal (contoh: 08123456789 atau 628123456789).');
    }

    if (!this.sock) {
      await this.initBaileys();
      await new Promise(r => setTimeout(r, 2000));
    }

    try {
      const rawCode = await this.sock.requestPairingCode(clean);
      let formattedCode = rawCode;
      if (rawCode && rawCode.length === 8) {
        formattedCode = `${rawCode.substring(0, 4)}-${rawCode.substring(4)}`;
      }
      this.lastPairingCode = formattedCode;
      this.pairingPhone = clean;
      this.pairingExpiresAt = Date.now() + (60 * 1000); // 60 detik
      console.log(`[WA Gateway] Kode pairing dibuat untuk +${clean}: ${formattedCode}`);
      return {
        success: true,
        pairingCode: formattedCode,
        rawCode,
        targetNumber: clean,
        expiresInSeconds: 60
      };
    } catch (err) {
      console.error('[WA Gateway] Gagal request pairing code:', err);
      throw new Error(`Gagal meminta kode pairing: ${err.message}`);
    }
  }

  async logoutBot() {
    console.log('[WA Gateway] Memutuskan sesi bot atas permintaan web portal...');
    try {
      if (this.sock) {
        try {
          await this.sock.logout('Admin initiated logout from web portal');
        } catch (e) {
          console.log('[WA Gateway] Notice sock logout:', e.message);
        }
        try {
          this.sock.end(new Error('Logout by admin'));
        } catch {}
      }
    } catch (err) {
      console.log('[WA Gateway] Warning saat logout:', err.message);
    }

    this.isConnected = false;
    this.currentQrDataUrl = null;
    this.lastPairingCode = null;
    this.pairingExpiresAt = 0;
    this.pairingPhone = null;

    // Bersihkan sesi di folder disk
    try {
      if (fs.existsSync(config.sessionDir)) {
        fs.rmSync(config.sessionDir, { recursive: true, force: true });
        console.log('[WA Gateway] Folder session auth berhasil dibersihkan.');
      }
    } catch (e) {
      console.error('[WA Gateway] Gagal bersihkan session dir:', e.message);
    }

    // Inisialisasi ulang socket bersih
    setTimeout(() => {
      this.initBaileys();
    }, 1500);

    return {
      success: true,
      message: 'Sesi bot berhasil diputuskan. Silakan masukkan nomor baru untuk meminta kode pairing atau scan QR.'
    };
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

    // 0. Cek Proteksi Brute-Force PIN Lockout (Mencegah serangan tebak PIN / Dictionary Attack)
    const pinLock = this.failedPinAttempts.get(cleanSender);
    const now = Date.now();
    if (pinLock && pinLock.lockedUntil > now) {
      const waitSec = Math.ceil((pinLock.lockedUntil - now) / 1000);
      const waitMin = Math.ceil(waitSec / 60);
      console.warn(`[🚨 Lockout Active] Pesan dari ${cleanSender} ditolak karena terkunci brute-force (${waitSec}s remaining).`);
      return await this.reply(
        senderJid,
        `⏳ *AKSES DIBEKUKAN SEMENTARA (BRUTE-FORCE DETECTED)*\n` +
        `Terlalu banyak percobaan PIN salah (${pinLock.count} kali berturut-turut).\n` +
        `Nomor Anda dibekukan sementara selama ${waitMin} menit (${waitSec} detik lagi).\n` +
        `Insiden ini dicatat dalam sistem log keamanan.`
      );
    }

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

      await this.reply(senderJid, `🛡️ *Security Agent:* Nomor Anda (*${cleanSender}*) telah didaftarkan sebagai *Admin Utama Server*.\nKetik *monitor* untuk memilih server dan tindakan.`);
    }

    if (!config.isAdmin(senderJid)) {
      // Zero-Trust Auto-Binding: Jika pengguna memasukkan PIN keamanan yang valid,
      // kita tahu 100% ini adalah administrator resmi yang sedang chatting melalui WhatsApp LID!
      let inlinePin = '';
      const rawTrimmed = text.trim();
      if (/^\d{4,8}$/.test(rawTrimmed)) {
        inlinePin = rawTrimmed;
      } else if (/^pin[:\s]+(\d{4,8})/i.test(rawTrimmed)) {
        inlinePin = rawTrimmed.replace(/^pin[:\s]+/i, '').trim();
      } else {
        const pinMatch = rawTrimmed.match(/[\s+:,-]+(\d{4,8})$/);
        if (pinMatch) inlinePin = pinMatch[1];
      }

      if (safeCompare(inlinePin, String(config.securityPin))) {
        this.failedPinAttempts.delete(cleanSender);
        // Tautkan LID ini ke admin utama
        contactsManager.attachLidToContact('6285378587299', cleanSender);
        config.addAdmin(cleanSender);
        console.log(`[🔑 Zero-Trust Auth] Nomor/LID ${cleanSender} berhasil diverifikasi dengan Master PIN & ditautkan sebagai Admin!`);
      } else {
        console.log(`[⚠️ Akses Ditolak] Pesan dari nomor tidak dikenal: ${cleanSender}`);

        // Intruder Alert ke WhatsApp Admin Utama
        if (config.intruderAlert && config.adminNumbers.length > 0) {
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
    }

    // 1. Cek perintah KUNCI manual
    const trimmedLower = text.trim().toLowerCase();
    if (trimmedLower === 'lock' || trimmedLower === '!lock' || trimmedLower === 'kunci' || trimmedLower === '12' || trimmedLower === '!12' || trimmedLower === 'l') {
      this.adminSessions.delete(cleanSender);
      this.pendingCommands.delete(cleanSender);
      this.pendingActions.delete(cleanSender);
      this.userMenuState.delete(cleanSender);
      return await this.reply(senderJid, '🔒 *Akses bot telah dikunci.* Kirim PIN Anda untuk membuka sesi kembali.');
    }

    // 2. Jika konfigurasi requirePinAll aktif (SEMUA HARUS MENGGUNAKAN PIN):
    if (config.requirePinAll) {
      const lastAuth = this.adminSessions.get(cleanSender);
      const isSessionValid = lastAuth && (config.pinTimeoutMinutes > 0) && (Date.now() - lastAuth < config.pinTimeoutMinutes * 60 * 1000);
      const rawTrimmed = text.trim();

      // Cek apakah user menulis "monitor + pin" atau "monitor pin" (secara harfiah kata "pin"):
      if (/^(monitor|menu|status|help)\s*(\+)?\s*pin$/i.test(rawTrimmed)) {
        if (isSessionValid) {
          return await this.showServerSelectionMenu(senderJid, cleanSender);
        } else {
          this.pendingCommands.set(cleanSender, 'monitor');
          return await this.reply(
            senderJid,
`🔒 *BOT KEAMANAN TERKUNCI* 🔒
-----------------------------------------
Silakan masukkan angka PIN keamanan Anda (${config.securityPin.length} digit):
Contoh: langsung kirim \`${config.securityPin}\` atau \`monitor ${config.securityPin}\`
-----------------------------------------`
          );
        }
      }

      // Cek apakah pesan adalah input PIN murni (misal: "465157" atau "PIN 465157" atau "pin: 465157")
      let rawPinInput = rawTrimmed;
      if (/^pin[:\s]+/i.test(rawPinInput)) {
        rawPinInput = rawPinInput.replace(/^pin[:\s]+/i, '').trim();
      }

      if (safeCompare(rawPinInput, String(config.securityPin))) {
        this.failedPinAttempts.delete(cleanSender);
        this.adminSessions.set(cleanSender, Date.now());
        const pendingCmd = this.pendingCommands.get(cleanSender);
        this.pendingCommands.delete(cleanSender);

        if (pendingCmd) {
          await this.reply(senderJid, `🔓 *PIN BENAR - SESI DIBUKA!*\nMengeksekusi perintah sebelumnya: *${pendingCmd}*...`);
          return await this.processCommand(senderJid, pendingCmd);
        } else {
          const timeoutText = config.pinTimeoutMinutes > 0 ? `Sesi aktif selama ${config.pinTimeoutMinutes} menit.` : 'Setiap perintah wajib menyertakan PIN.';
          await this.reply(senderJid, `🔓 *PIN BENAR - AKSES DIBUKA!*\n${timeoutText}`);
          return await this.showServerSelectionMenu(senderJid, cleanSender);
        }
      }

      // Cek apakah perintah menyertakan PIN inline di akhir (misal: "monitor 465157", "monitor + 465157", "monitor+465157", "1 465157")
      const pinPattern = new RegExp(`[\\s+:,-]+${config.securityPin}$`);
      if (pinPattern.test(rawTrimmed)) {
        this.failedPinAttempts.delete(cleanSender);
        this.adminSessions.set(cleanSender, Date.now());
        const cmdWithoutPin = rawTrimmed.replace(pinPattern, '').trim();
        console.log(`[🔑 Auth Inline] Nomor ${cleanSender} mengotorisasi perintah: "${cmdWithoutPin}"`);
        return await this.processCommand(senderJid, cmdWithoutPin || 'monitor');
      }

      // Jika sesi belum dibuka dan input bukan PIN yang benar
      if (!isSessionValid) {
        // Jika tampaknya mencoba menebak PIN angka
        if (/^\d{4,8}$/.test(rawPinInput) || /^pin[:\s]+/i.test(rawTrimmed)) {
          const currentFails = ((pinLock ? pinLock.count : 0) + 1);
          if (currentFails >= 5) {
            const lockedUntil = now + (15 * 60 * 1000); // 15 menit lockout
            this.failedPinAttempts.set(cleanSender, { count: currentFails, lockedUntil });
            console.warn(`[🚨 BRUTE-FORCE DETECTED] Nomor ${cleanSender} telah gagal 5x memasukkan PIN. Dibekukan 15 menit.`);

            const alertMsg = 
`🚨 *PERINGATAN BRUTE-FORCE SECURITY PIN* 🚨
-----------------------------------------
Terdeteksi percobaan pembobolan PIN bot WhatsApp server!
• *Nomor Pengirim:* +${cleanSender}
• *Jumlah Kegagalan:* 5 kali berturut-turut
• *Waktu:* ${new Date().toLocaleString('id-ID')}
• *Tindakan Otomatis:* 🛡️ Nomor dibekukan dari sistem selama 15 menit.
-----------------------------------------`;

            for (const adminNum of config.adminNumbers) {
              if (adminNum !== cleanSender) {
                try {
                  await this.sock.sendMessage(`${adminNum}@s.whatsapp.net`, { text: alertMsg });
                } catch (e) {}
              }
            }

            return await this.reply(
              senderJid,
              `🚨 *AKSES DIBLOKIR SEMENTARA!* 🚨\nAnda telah 5 kali salah memasukkan PIN keamanan.\nNomor Anda dibekukan selama 15 menit dan peringatan keamanan telah dikirimkan ke Admin Server.`
            );
          } else {
            this.failedPinAttempts.set(cleanSender, { count: currentFails, lockedUntil: 0 });
            return await this.reply(
              senderJid,
              `❌ *PIN KEAMANAN SALAH!* (${currentFails}/5 percobaan)\nAkses bot tetap terkunci. Setelah 5 kegagalan, nomor Anda akan dibekukan selama 15 menit.`
            );
          }
        }

        // Simpan perintah yang ingin dijalankan agar otomatis dieksekusi setelah PIN dimasukkan
        this.pendingCommands.set(cleanSender, rawTrimmed);
        return await this.reply(
          senderJid,
`🔒 *BOT KEAMANAN TERKUNCI* 🔒
-----------------------------------------
Semua perintah membutuhkan verifikasi PIN.

Silakan masukkan PIN keamanan Anda:
Contoh: langsung kirim angka PIN (misal: \`${config.securityPin}\`)
Atau sertakan di akhir perintah: \`monitor ${config.securityPin}\`
-----------------------------------------`
        );
      }

      // Jika sesi valid, perbarui waktu aktifitas
      this.adminSessions.set(cleanSender, Date.now());
    }

    // Periksa apakah Admin sedang dalam proses konfirmasi PIN tindakan kritis lanjutan
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

        if (safeCompare(inputPin, String(config.securityPin))) {
          this.failedPinAttempts.delete(cleanSender);
          const { action, target, targetNodeId } = pending;
          this.pendingActions.delete(cleanSender);
          await this.reply(senderJid, '🔑 PIN terverifikasi. Mengeksekusi tindakan...');
          return await this.executeAction(senderJid, action, target, targetNodeId);
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

  // =========================================================================
  // ALUR 2-LANGKAH: PILIH SERVER -> PILIH TINDAKAN
  // =========================================================================

  /**
   * Langkah 1: Menampilkan Menu Pilihan Server
   */
  async showServerSelectionMenu(senderJid, cleanSender) {
    const rawNodes = Array.from(cluster.nodes.values());
    const seenNames = new Set();
    const nodes = [];

    // Deduplikasi berdasarkan nama server
    for (const n of rawNodes) {
      const cleanName = (n.name || n.nodeId).trim();
      if (!seenNames.has(cleanName)) {
        seenNames.add(cleanName);
        nodes.push(n);
      }
    }

    if (nodes.length === 0) {
      nodes.push({
        nodeId: config.nodeId,
        name: config.nodeName,
        role: config.clusterRole,
        status: 'online'
      });
    }

    this.userMenuState.set(cleanSender, {
      step: 'CHOOSE_SERVER',
      serverList: nodes
    });

    let msg = `🛡️ *PILIH SERVER UNTUK DIMONITOR* 🛡️\n-----------------------------------------\nSilakan balas dengan *NOMOR* server yang ingin Anda kelola:\n\n`;

    nodes.forEach((n, idx) => {
      const icon = n.status === 'online' ? '🟢' : '🔴';
      const isLocal = n.nodeId === config.nodeId ? ' *(Server Ini)*' : '';
      msg += `*${idx + 1}.* ${icon} *${n.name}* (\`${n.nodeId}\`)${isLocal}\n`;
      msg += `   ↳ Status: *${n.status.toUpperCase()}* | Peran: ${n.role.toUpperCase()}\n\n`;
    });

    msg += `-----------------------------------------\n`;
    msg += `📊 *A.* Laporan Status Seluruh Server (All Status)\n`;
    msg += `📋 *S.* Laporan Seluruh Layanan & Aplikasi (All Services)\n`;
    msg += `👥 *K.* Nomor WhatsApp Urgensi & Web Portal (:5005)\n`;
    msg += `🔒 *L.* Kunci Sesi Bot\n`;
    msg += `-----------------------------------------\n`;
    msg += `💡 *Ketik angka pilihan server (contoh: 1)*`;

    return await this.reply(senderJid, msg);
  }

  /**
   * Langkah 2: Menampilkan Menu Pilihan Tindakan pada Server Terpilih
   */
  async showServerActionsMenu(senderJid, cleanSender, targetNodeId) {
    let node = cluster.nodes.get(targetNodeId);
    if (!node) {
      if (targetNodeId === config.nodeId) {
        node = {
          nodeId: config.nodeId,
          name: config.nodeName,
          role: config.clusterRole,
          status: 'online'
        };
      } else {
        await this.reply(senderJid, `⚠️ Server \`${targetNodeId}\` tidak ditemukan.`);
        return await this.showServerSelectionMenu(senderJid, cleanSender);
      }
    }

    this.userMenuState.set(cleanSender, {
      step: 'SERVER_ACTIONS',
      targetNodeId: node.nodeId,
      targetNodeName: node.name
    });

    const icon = node.status === 'online' ? '🟢' : '🔴';
    const msg = 
`🎯 *SERVER TERPILIH:*
*${node.name}* (\`${node.nodeId}\`)
• Status: ${icon} ${node.status.toUpperCase()} | Peran: ${node.role.toUpperCase()}
-----------------------------------------
Silakan balas dengan *NOMOR* tindakan:

*1.* 💻 Status Server (CPU, RAM, Disk, Uptime)
*2.* 🛡️ Riwayat Ancaman & Log Mitigasi
*3.* 🔍 Quick Scan Antivirus
*4.* 🔬 Full Scan Antivirus
*5.* 🔌 Port & Layanan Aktif (Listening Ports)
*6.* 🐳 Status Container Docker
*7.* 🔄 Restart Container Docker tertentu
*8.* 🧱 Blokir Alamat IP di Firewall
*9.* 🚨 Emergency Lockdown (Putus Akses Luar)
*10.* 🌐 Restore Cloudflare Tunnel
*11.* 📋 Inventori & Laporan Layanan/Aplikasi (Auto-Discovery)
-----------------------------------------
*0.* 🔙 Ganti / Pilih Server Lain
*L.* 🔒 Kunci Sesi Bot
-----------------------------------------
💡 *Cukup ketik nomornya (contoh: 1) untuk menjalankan.*`;

    return await this.reply(senderJid, msg);
  }

  // =========================================================================
  // EKSEKUSI PERINTAH PADA SERVER (LOKAL ATAU REMOTE WORKER)
  // =========================================================================

  async executeServerStatus(senderJid, targetNodeId, targetNodeName) {
    await this.reply(senderJid, `⏳ Mengambil data performa server *${targetNodeName}*...`);
    const isLocal = !targetNodeId || targetNodeId === config.nodeId;

    let health, def;
    if (isLocal) {
      health = await security.getSystemHealth();
      def = await security.getDefenderStatus();
    } else {
      health = await cluster.dispatchCommand(targetNodeId, 'status');
      def = await cluster.dispatchCommand(targetNodeId, 'defender');
    }

    if (health?.error) {
      return await this.reply(senderJid, `❌ Gagal mengambil status dari *${targetNodeName}*: ${health.error}`);
    }

    const driveStr = (health?.Drives || []).map(d => `  - Drive ${d.Name}: ${d.UsedGB} GB terpakai / ${d.TotalGB} GB (Sisa ${d.FreeGB} GB)`).join('\n');
    const osHeader = health?.OS ? health.OS.toUpperCase() : (isLocal ? security.osName.toUpperCase() : 'SERVER');

    const response = 
`💻 *STATUS SERVER ${targetNodeName.toUpperCase()} (${osHeader})*
-----------------------------------------
• *Node ID:* \`${targetNodeId}\`
• *Uptime:* ${health?.Uptime || 'N/A'}
• *CPU Load:* ${health?.CPU || 0}%
• *RAM Terpakai:* ${health?.UsedRamGB || 0} GB / ${health?.TotalRamGB || 0} GB (${health?.RamPercent || 0}%)
• *Penyimpanan Disk:*
${driveStr || '  - Tidak ada data drive'}

🛡️ *${def?.Name || (security.isWindows ? 'Windows Defender' : 'Keamanan Linux')}:*
• *Antivirus:* ${def?.AntivirusEnabled ? '✅ Aktif' : '❌ Nonaktif / Belum Terpasang'}
• *Proteksi Real-Time:* ${def?.RealTimeProtection ? '✅ Aktif' : '❌ Nonaktif'}
• *Engine Version:* ${def?.EngineVersion || 'N/A'}
-----------------------------------------
💡 Balas nomor (1-10) untuk tindakan lain, atau ketik *0* untuk ganti server.`;

    return await this.reply(senderJid, response);
  }

  async executeServerThreats(senderJid, targetNodeId, targetNodeName) {
    await this.reply(senderJid, `⏳ Memeriksa riwayat deteksi ancaman pada *${targetNodeName}*...`);
    const isLocal = !targetNodeId || targetNodeId === config.nodeId;

    let threats;
    if (isLocal) {
      threats = await security.getRecentThreats(5);
    } else {
      threats = await cluster.dispatchCommand(targetNodeId, 'threats');
    }

    if (threats?.error) {
      return await this.reply(senderJid, `❌ Gagal membaca riwayat ancaman: ${threats.error}`);
    }

    if (!threats || threats.length === 0) {
      return await this.reply(
        senderJid,
        `✅ *Kondisi Bersih (${targetNodeName}):* Tidak ada ancaman virus atau malware aktif yang terdeteksi.\n\n💡 Balas nomor (1-10) untuk tindakan lain, atau ketik *0* untuk ganti server.`
      );
    }

    let res = `🛡️ *ANCAMAN TERDETEKSI: ${targetNodeName.toUpperCase()} (${threats.length})*\n-----------------------------------------\n`;
    threats.forEach((t, i) => {
      res += `${i + 1}. *${t.ThreatName}*\n`;
      res += `   • Waktu: ${t.Time}\n`;
      res += `   • Status: ${t.Remediated ? '✅ Telah Diisolasi' : '⚠️ Masih Berbahaya'}\n`;
      res += `   • Target: \`${t.Resources?.substring(0, 100) || 'N/A'}...\`\n\n`;
    });
    res += `-----------------------------------------\n`;
    res += `💡 Balas nomor (1-10) untuk tindakan lain, atau ketik *0* untuk ganti server.`;
    return await this.reply(senderJid, res);
  }

  async executeServerScan(senderJid, targetNodeId, targetNodeName, isFull = false) {
    const scanType = isFull ? 'Full Scan' : 'Quick Scan';
    await this.reply(senderJid, `🚀 Memulai *${scanType}* pada *${targetNodeName}* di latar belakang...`);
    const isLocal = !targetNodeId || targetNodeId === config.nodeId;

    let res;
    if (isLocal) {
      res = isFull ? await security.startFullScan() : await security.startQuickScan();
    } else {
      res = await cluster.dispatchCommand(targetNodeId, isFull ? 'scan-full' : 'scan');
    }

    const msg = typeof res === 'string' ? res : (res?.error ? `❌ Gagal: ${res.error}` : JSON.stringify(res));
    return await this.reply(
      senderJid,
      `✅ *${targetNodeName}:* ${msg}\nAnda akan menerima notifikasi jika ada virus yang ditemukan.\n\n💡 Balas nomor (1-10) untuk tindakan lain, atau ketik *0* untuk ganti server.`
    );
  }

  async executeServerPorts(senderJid, targetNodeId, targetNodeName) {
    await this.reply(senderJid, `⏳ Memindai port TCP aktif pada *${targetNodeName}*...`);
    const isLocal = !targetNodeId || targetNodeId === config.nodeId;

    let ports;
    if (isLocal) {
      ports = await security.getListeningPorts();
    } else {
      ports = await cluster.dispatchCommand(targetNodeId, 'ports');
    }

    if (ports?.error) {
      return await this.reply(senderJid, `❌ Gagal membaca port: ${ports.error}`);
    }

    if (!ports || ports.length === 0) {
      return await this.reply(senderJid, `Tidak ada data port yang dapat diakses dari *${targetNodeName}*.\n\n💡 Ketik *0* untuk ganti server.`);
    }

    const importantPorts = ports.filter(p => [80, 443, 3000, 3001, 4000, 5005, 5432, 5433, 6380, 8080, 9090, 11434].includes(p.Port));
    let out = `🔌 *PORT LAYANAN UTAMA: ${targetNodeName.toUpperCase()}*\n-----------------------------------------\n`;
    if (importantPorts.length > 0) {
      importantPorts.forEach(p => {
        out += `• Port *${p.Port}* : ${p.Process} (PID: ${p.PID})\n`;
      });
    } else {
      ports.slice(0, 10).forEach(p => {
        out += `• Port *${p.Port}* : ${p.Process} (PID: ${p.PID})\n`;
      });
    }
    out += `\nTotal port aktif di sistem: ${ports.length} port.`;
    out += `\n-----------------------------------------`;
    out += `\n💡 Balas nomor (1-10) untuk tindakan lain, atau ketik *0* untuk ganti server.`;
    return await this.reply(senderJid, out);
  }

  async executeServerDocker(senderJid, targetNodeId, targetNodeName) {
    await this.reply(senderJid, `⏳ Memeriksa kontainer Docker pada *${targetNodeName}*...`);
    const isLocal = !targetNodeId || targetNodeId === config.nodeId;

    let status;
    if (isLocal) {
      status = await security.getDockerStatus();
    } else {
      const res = await cluster.dispatchCommand(targetNodeId, 'docker');
      status = typeof res === 'string' ? res : (res?.error ? `❌ Gagal: ${res.error}` : JSON.stringify(res));
    }

    const out = 
`🐳 *STATUS DOCKER CONTAINERS: ${targetNodeName.toUpperCase()}*
-----------------------------------------
${status}

💡 Ketik *7 <nama_container>* untuk me-restart container.
💡 Ketik *0* untuk ganti server.`;

    return await this.reply(senderJid, out);
  }

  async showAllServersStatus(senderJid) {
    await this.reply(senderJid, '⏳ Mengumpulkan data performa seluruh server di cluster...');
    const reports = await cluster.aggregateStatus();
    let out = `📊 *LAPORAN PERFORMA SELURUH SERVER*\n-----------------------------------------\n`;
    for (const rep of reports) {
      out += `• *${rep.name}* [${rep.status} - ${rep.role.toUpperCase()}]\n`;
      if (rep.health && typeof rep.health.CPU !== 'undefined') {
        out += `  - CPU: ${rep.health.CPU}% | RAM: ${rep.health.UsedRamGB} GB / ${rep.health.TotalRamGB} GB (${rep.health.RamPercent}%)\n`;
        out += `  - Uptime: ${rep.health.Uptime || 'N/A'}\n`;
      } else {
        out += `  - Data: Tidak tersedia / Server offline\n`;
      }
      out += '\n';
    }
    out += `Total node terdaftar: ${reports.length} server.\n`;
    out += `-----------------------------------------\n`;
    out += `💡 Ketik *monitor* untuk memilih server spesifik.`;
    return await this.reply(senderJid, out);
  }

  /**
   * Menampilkan Menu Inventori Layanan & Aplikasi yang Terdeteksi Otomatis
   */
  async showServerServicesMenu(senderJid, cleanSender, targetNodeId, targetNodeName) {
    await this.reply(senderJid, `⏳ Membaca inventori layanan & aplikasi pada *${targetNodeName}*...`);
    const isLocal = !targetNodeId || targetNodeId === config.nodeId;

    let services;
    if (isLocal) {
      services = await security.getDiscoveredServices();
    } else {
      services = await cluster.dispatchCommand(targetNodeId, 'services');
    }

    if (!services || !Array.isArray(services) || services.length === 0) {
      return await this.reply(senderJid, `ℹ️ Tidak ada data layanan yang ditemukan pada *${targetNodeName}*.`);
    }

    // Ambil maksimal 15 layanan (utamakan aplikasi terlebih dahulu)
    const displayList = services.slice(0, 15);

    this.userMenuState.set(cleanSender, {
      step: 'SERVICES_MENU',
      targetNodeId,
      targetNodeName,
      servicesList: displayList
    });

    let msg = `📋 *INVENTORI LAYANAN & APLIKASI (AUTO-DISCOVERY)*\n`;
    msg += `*${targetNodeName.toUpperCase()}* (\`${targetNodeId}\`)\n`;
    msg += `-----------------------------------------\n`;
    msg += `Total terdeteksi: *${services.length}* layanan (Menampilkan ${displayList.length} teratas):\n\n`;

    displayList.forEach((s, idx) => {
      const portStr = s.ports && s.ports.length > 0 ? ` [Port: \`${s.ports.join(',')}\`]` : '';
      const catIcon = s.category === 'application' ? '🌐' : '⚙️';
      msg += `*${idx + 1}.* ${catIcon} *${s.name}*${portStr}\n`;
      msg += `   ↳ ${s.displayName || s.desc || s.name} (${s.status})\n\n`;
    });

    msg += `-----------------------------------------\n`;
    msg += `💡 *Ketik NOMOR layanan (contoh: 1)* untuk melihat *Laporan Detail Diagnostik & Log*.\n`;
    msg += `💡 Ketik *all services* untuk ringkasan semua server.\n`;
    msg += `💡 Ketik *0* untuk kembali ke menu tindakan server.`;

    return await this.reply(senderJid, msg);
  }

  /**
   * Menampilkan Laporan Detail Diagnostik untuk Layanan Tertentu
   */
  async showServiceDetailReport(senderJid, cleanSender, targetNodeId, targetNodeName, serviceName) {
    await this.reply(senderJid, `⏳ Mengambil laporan diagnostik lengkap untuk *${serviceName}*...`);
    const isLocal = !targetNodeId || targetNodeId === config.nodeId;

    let detail;
    if (isLocal) {
      detail = await security.getServiceDetail(serviceName);
    } else {
      detail = await cluster.dispatchCommand(targetNodeId, 'service-detail', { name: serviceName });
    }

    if (!detail || detail.error) {
      return await this.reply(senderJid, `❌ Gagal mengambil laporan layanan *${serviceName}*: ${detail?.error || 'Unknown error'}`);
    }

    let reportMsg = `📊 *LAPORAN DIAGNOSTIK LAYANAN: ${serviceName.toUpperCase()}*\n`;
    reportMsg += `-----------------------------------------\n`;
    reportMsg += `• *Server:* ${targetNodeName} (\`${targetNodeId}\`)\n`;
    reportMsg += `• *Nama Unit:* \`${detail.name || serviceName}\`\n`;
    reportMsg += `• *Deskripsi:* ${detail.displayName || '-'}\n`;
    reportMsg += `• *Status Layanan:* 🟢 ${detail.status || 'Active'}\n`;
    if (detail.mainPid && detail.mainPid !== 'N/A') reportMsg += `• *Main PID:* ${detail.mainPid}\n`;
    if (detail.memoryUsage && detail.memoryUsage !== 'N/A') reportMsg += `• *Penggunaan RAM:* ${detail.memoryUsage}\n`;
    if (detail.startedAt && detail.startedAt !== 'N/A') reportMsg += `• *Waktu Mulai:* ${detail.startedAt}\n`;

    reportMsg += `-----------------------------------------\n`;
    reportMsg += `📝 *Log Terakhir (Journal / Output):*\n`;
    reportMsg += `\`\`\`${(detail.recentLogs || 'Tidak ada log tersedia.').substring(0, 500)}\`\`\`\n`;
    reportMsg += `-----------------------------------------\n`;
    reportMsg += `🛠️ *Opsi Tindakan Layanan:*\n`;
    reportMsg += `• Ketik \`restart service ${serviceName}\` untuk restart layanan ini.\n`;
    reportMsg += `• Ketik *services* untuk kembali ke daftar layanan.\n`;
    reportMsg += `• Ketik *0* untuk menu utama server.`;

    return await this.reply(senderJid, reportMsg);
  }

  /**
   * Menampilkan Laporan Layanan & Aplikasi Seluruh Server Sekaligus
   */
  async showAllServersServicesReport(senderJid) {
    await this.reply(senderJid, '⏳ Mengumpulkan inventori layanan dan aplikasi dari seluruh server di cluster...');
    const nodes = Array.from(cluster.nodes.values());

    let out = `📋 *LAPORAN INVENTORI APLIKASI LINTAS SERVER*\n-----------------------------------------\n`;

    for (const node of nodes) {
      const isLocal = node.nodeId === config.nodeId;
      let services = [];

      try {
        if (isLocal) {
          services = await security.getDiscoveredServices();
        } else {
          services = await cluster.dispatchCommand(node.nodeId, 'services');
        }
      } catch (err) {
        services = { error: err.message };
      }

      const icon = node.status === 'online' ? '🟢' : '🔴';
      out += `🖥️ *${node.name}* (\`${node.nodeId}\`) [${icon} ${node.status.toUpperCase()}]\n`;

      if (Array.isArray(services) && services.length > 0) {
        const apps = services.filter(s => s.category === 'application');
        const displayApps = apps.length > 0 ? apps.slice(0, 8) : services.slice(0, 5);
        displayApps.forEach(a => {
          const portStr = a.ports && a.ports.length > 0 ? ` [Port: \`${a.ports.join(',')}\`]` : '';
          out += `  • *${a.name}*${portStr} (Status: ${a.status})\n`;
        });
        out += `  ↳ *Total Layanan:* ${services.length} (${apps.length} aplikasi utama)\n\n`;
      } else {
        out += `  - Data layanan tidak dapat dimuat atau server offline.\n\n`;
      }
    }

    out += `-----------------------------------------\n`;
    out += `💡 Ketik *services* untuk melihat dan mengelola menu layanan detail pada server terpilih.`;
    return await this.reply(senderJid, out);
  }

  // =========================================================================
  // PROCESS COMMAND (MAIN DISPATCHER)
  // =========================================================================

  async processCommand(senderJid, text) {
    const raw = text.trim();
    const lower = raw.toLowerCase();
    const cleanSender = senderJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

    // 1. Perintah KUNCI manual / Lock
    if (lower === 'lock' || lower === '!lock' || lower === 'kunci' || lower === '12' || lower === '!12' || lower === 'l') {
      this.adminSessions.delete(cleanSender);
      this.userMenuState.delete(cleanSender);
      return await this.reply(senderJid, '🔒 *Sesi bot telah dikunci.* Masukkan PIN Anda untuk membuka kembali.');
    }

    // 2. Perintah CLUSTER Global
    if (lower === 'nodes' || lower === 'servers' || lower === 'cluster' || lower === '!nodes' || lower === '!cluster') {
      let out = `🖥️ *STATUS CLUSTER & FLEET SERVER*\n-----------------------------------------\n`;
      for (const [id, node] of cluster.nodes.entries()) {
        const icon = node.status === 'online' ? '🟢' : '🔴';
        const isLocal = node.nodeId === config.nodeId ? ' (Server Ini)' : '';
        out += `${icon} *${node.name}* (\`${id}\`)${isLocal}\n   • Peran: *${node.role.toUpperCase()}* | Status: ${node.status.toUpperCase()}\n`;
      }
      out += `-----------------------------------------\n💡 Ketik *monitor* untuk memilih server yang akan dikelola.\n💡 Ketik *all status* untuk cek performa semua server.`;
      return await this.reply(senderJid, out);
    }

    if (lower === 'all status' || lower === 'status all' || lower === '!all status' || lower === 'a') {
      return await this.showAllServersStatus(senderJid);
    }

    if (lower === 'all services' || lower === 'services all' || lower === 'all apps' || lower === 'apps all' || lower === 'report all' || lower === '!all services' || lower === 's') {
      return await this.showAllServersServicesReport(senderJid);
    }

    if (lower === 'contacts' || lower === 'kontak' || lower === 'nomor darurat' || lower === '!contacts' || lower === '!kontak' || lower === 'k') {
      const list = contactsManager.getAll();
      let out = `👥 *NOMOR WHATSAPP PENERIMA NOTIFIKASI URGENSI*\n-----------------------------------------\n`;
      if (list.length === 0) {
        out += `Belum ada nomor darurat terdaftar.\n`;
      } else {
        list.forEach((c, i) => {
          const icon = c.active !== false ? '🟢' : '⚪';
          out += `*${i + 1}.* *${c.name}* (${c.role})\n`;
          out += `   • No: \`+${c.number}\` [${icon} ${c.active !== false ? 'Aktif' : 'Nonaktif'}]\n`;
          out += `   • Alert: \`${c.alerts.join(', ')}\`\n\n`;
        });
      }
      out += `-----------------------------------------\n`;
      out += `🌐 *Web Portal Manajemen (Form Login):*\n👉 \`http://localhost:${config.clusterPort}/dashboard\`\n\n`;
      out += `💡 Ketik *tambah kontak <nomor> <nama>* untuk mendaftarkan nomor baru via chat.\n`;
      out += `💡 Ketik *0* atau *menu* untuk kembali.`;
      return await this.reply(senderJid, out);
    }

    if (lower.startsWith('tambah kontak ') || lower.startsWith('!tambah kontak ')) {
      const parts = raw.replace(/^(!)?tambah kontak\s+/i, '').trim().split(/\s+/);
      const num = parts[0];
      const name = parts.slice(1).join(' ') || 'SysAdmin';
      try {
        const res = contactsManager.addContact({ number: num, name, alerts: ['all'] });
        return await this.reply(senderJid, `✅ *Berhasil Mendaftarkan Kontak Darurat:*\n-----------------------------------------\n• *Nama:* ${name}\n• *Nomor:* \`+${res.contact.number}\`\n• *Status:* 🟢 Aktif menerima pesan urgensi (serangan, server down, dll)\n-----------------------------------------\n💡 Kelola atau uji coba pengiriman via Web Portal: \`http://localhost:${config.clusterPort}/dashboard\``);
      } catch (err) {
        return await this.reply(senderJid, `❌ Gagal mendaftarkan kontak: ${err.message}`);
      }
    }

    if (lower.startsWith('node ')) {
      const parts = raw.split(/\s+/);
      if (parts.length < 3) {
        return await this.reply(senderJid, 'ℹ️ Format perintah salah. Gunakan: `node <id_node> <perintah>`\nContoh: `node node-01 status`');
      }
      const targetId = parts[1];
      const cmd = parts[2].toLowerCase();
      await this.reply(senderJid, `⏳ Mengirim perintah *${cmd}* ke node *${targetId}*...`);
      const res = await cluster.dispatchCommand(targetId, cmd);
      if (res && res.error) {
        return await this.reply(senderJid, `❌ ${res.error}`);
      }
      return await this.reply(senderJid, `✅ Hasil dari *${targetId}*:\n\`\`\`${JSON.stringify(res, null, 2).substring(0, 800)}\`\`\``);
    }

    // 3. Trigger MENU UTAMA: Pemilihan Server
    if (
      lower === 'monitor' ||
      lower === '!monitor' ||
      lower === 'menu' ||
      lower === '!menu' ||
      lower === 'help' ||
      lower === '!help' ||
      lower === 'pilih server'
    ) {
      return await this.showServerSelectionMenu(senderJid, cleanSender);
    }

    // Ambil status menu user saat ini
    const menuState = this.userMenuState.get(cleanSender);

    // KASUS A: Pengguna sedang berada di menu PILIH SERVER (CHOOSE_SERVER)
    if (menuState && menuState.step === 'CHOOSE_SERVER') {
      const num = parseInt(raw, 10);
      if (!isNaN(num) && num >= 1 && num <= menuState.serverList.length) {
        const chosenNode = menuState.serverList[num - 1];
        return await this.showServerActionsMenu(senderJid, cleanSender, chosenNode.nodeId);
      }

      // Cek jika mengetik langsung ID node (misal: "node-01")
      const matchedNode = menuState.serverList.find(n => n.nodeId.toLowerCase() === lower);
      if (matchedNode) {
        return await this.showServerActionsMenu(senderJid, cleanSender, matchedNode.nodeId);
      }

      return await this.reply(
        senderJid,
        `⚠️ Pilihan nomor tidak valid.\nSilakan balas dengan angka *1* sampai *${menuState.serverList.length}* untuk memilih server, atau ketik *A* untuk melihat semua server.`
      );
    }

    // KASUS S: Pengguna berada di menu INVENTORI LAYANAN (SERVICES_MENU)
    if (menuState && menuState.step === 'SERVICES_MENU') {
      const num = parseInt(raw, 10);
      if (!isNaN(num) && num >= 1 && num <= menuState.servicesList.length) {
        const chosen = menuState.servicesList[num - 1];
        return await this.showServiceDetailReport(senderJid, cleanSender, menuState.targetNodeId, menuState.targetNodeName, chosen.name);
      }
      if (lower === '0' || lower === 'back' || lower === 'kembali') {
        return await this.showServerActionsMenu(senderJid, cleanSender, menuState.targetNodeId);
      }
      if (lower === 'menu' || lower === 'monitor') {
        return await this.showServerSelectionMenu(senderJid, cleanSender);
      }
    }

    // KASUS B: Pengguna berada di menu TINDAKAN SERVER (SERVER_ACTIONS) atau Eksekusi Langsung
    let targetNodeId = menuState?.targetNodeId || config.nodeId;
    let targetNode = cluster.nodes.get(targetNodeId) || {
      nodeId: targetNodeId,
      name: config.nodeName,
      role: config.clusterRole,
      status: 'online'
    };
    let targetNodeName = targetNode.name;

    // Tombol KEMBALI / Ganti Server
    if (lower === '0' || lower === '!0' || lower === 'kembali' || lower === 'back' || lower === 'ganti' || lower === 'ganti server') {
      return await this.showServerSelectionMenu(senderJid, cleanSender);
    }

    // 1. Status Server
    if (lower === '1' || lower === '!1' || lower === '!status' || lower === 'status') {
      return await this.executeServerStatus(senderJid, targetNodeId, targetNodeName);
    }

    // 2. Riwayat Ancaman / Threats
    if (lower === '2' || lower === '!2' || lower === '!threats' || lower === 'threats') {
      return await this.executeServerThreats(senderJid, targetNodeId, targetNodeName);
    }

    // 3. Quick Scan Antivirus
    if (lower === '3' || lower === '!3' || lower === '!scan' || lower === 'scan') {
      return await this.executeServerScan(senderJid, targetNodeId, targetNodeName, false);
    }

    // 4. Full Scan Antivirus
    if (lower === '4' || lower === '!4' || lower === '!scan-full' || lower === 'scan full') {
      return await this.executeServerScan(senderJid, targetNodeId, targetNodeName, true);
    }

    // 5. Cek Port Terbuka
    if (lower === '5' || lower === '!5' || lower === '!ports' || lower === 'ports') {
      return await this.executeServerPorts(senderJid, targetNodeId, targetNodeName);
    }

    // 6. Cek Docker
    if (lower === '6' || lower === '!6' || lower === '!docker' || lower === 'docker') {
      return await this.executeServerDocker(senderJid, targetNodeId, targetNodeName);
    }

    // 7. Restart Docker Container
    if (lower === '7' || lower === '!7') {
      return await this.reply(
        senderJid,
        `🐳 *RESTART DOCKER CONTAINER (${targetNodeName})*\nSilakan ketik nomor 7 diikuti nama container.\n*Contoh:* \`7 ujian_backend\` atau \`!docker restart ujian_backend\``
      );
    }
    if (lower.startsWith('7 ') || lower.startsWith('!7 ') || lower.startsWith('!docker restart ')) {
      const parts = raw.replace(/^(!docker restart|!7|7)\s+/i, '').trim().split(/\s+/);
      const containerName = parts[0];
      const inlinePin = parts[1] || null;
      return await this.requestPinOrExecute(
        senderJid,
        cleanSender,
        'restart_docker',
        containerName,
        `Restart Docker Container (${targetNodeName})`,
        containerName,
        inlinePin,
        targetNodeId
      );
    }

    // 8. Blokir IP
    if (lower === '8' || lower === '!8') {
      return await this.reply(
        senderJid,
        `🧱 *BLOKIR IP DI FIREWALL (${targetNodeName})*\nSilakan ketik nomor 8 diikuti alamat IP yang ingin diblokir.\n*Contoh:* \`8 192.168.1.100\` atau \`!block 192.168.1.100\``
      );
    }
    if (lower.startsWith('8 ') || lower.startsWith('!8 ') || lower.startsWith('!block ')) {
      const parts = raw.replace(/^(!block|!8|8)\s+/i, '').trim().split(/\s+/);
      const ip = parts[0];
      const inlinePin = parts[1] || null;
      return await this.requestPinOrExecute(
        senderJid,
        cleanSender,
        'block_ip',
        ip,
        `Blokir IP di Firewall (${targetNodeName})`,
        ip,
        inlinePin,
        targetNodeId
      );
    }

    // 9. Emergency Lockdown
    if (
      lower === '9' ||
      lower === '!9' ||
      lower === '!lockdown' ||
      lower === 'lockdown' ||
      lower.startsWith('9 ') ||
      lower.startsWith('!9 ') ||
      lower.startsWith('!lockdown ')
    ) {
      const parts = raw.split(/\s+/);
      const inlinePin = parts.length > 1 ? parts[1] : null;
      return await this.requestPinOrExecute(
        senderJid,
        cleanSender,
        'lockdown',
        null,
        `Emergency Lockdown (${targetNodeName})`,
        'Cloudflare Tunnel',
        inlinePin,
        targetNodeId
      );
    }

    // 10. Restore Tunnel
    if (lower === '10' || lower === '!10' || lower === '!restore' || lower === 'restore') {
      await this.reply(senderJid, `⏳ Mengaktifkan kembali Cloudflare Tunnel pada *${targetNodeName}*...`);
      const isLocal = !targetNodeId || targetNodeId === config.nodeId;
      let result;
      if (isLocal) {
        result = await security.restoreCloudflare();
      } else {
        const res = await cluster.dispatchCommand(targetNodeId, 'restore');
        result = typeof res === 'string' ? res : (res?.error ? `❌ Gagal: ${res.error}` : JSON.stringify(res));
      }
      return await this.reply(senderJid, `✅ ${result}\n\n💡 Ketik *0* untuk ganti server.`);
    }

    // 11. Inventori & Laporan Layanan / Aplikasi (Auto-Discovery)
    if (lower === '11' || lower === '!11' || lower === 'services' || lower === '!services' || lower === 'apps' || lower === '!apps' || lower === 'report' || lower === 'layanan' || lower === 'aplikasi') {
      return await this.showServerServicesMenu(senderJid, cleanSender, targetNodeId, targetNodeName);
    }

    // Restart Layanan Tertentu
    if (lower.startsWith('restart service ') || (lower.startsWith('restart ') && !lower.startsWith('restart docker '))) {
      const svcName = raw.replace(/^restart\s+(service\s+)?/i, '').trim().split(/\s+/)[0];
      if (svcName) {
        return await this.requestPinOrExecute(
          senderJid,
          cleanSender,
          'restart_service',
          svcName,
          `Restart Layanan (${targetNodeName})`,
          svcName,
          null,
          targetNodeId
        );
      }
    }

    // 16. Fallback AI Response via Ollama
    await this.replyWithAI(senderJid, text);
  }

  async requestPinOrExecute(senderJid, cleanSender, action, target, title, desc, inlinePin, targetNodeId = null) {
    if (!config.requirePin) {
      return await this.executeAction(senderJid, action, target, targetNodeId);
    }

    // Jika admin menyertakan PIN langsung (inline)
    if (inlinePin) {
      if (inlinePin === config.securityPin) {
        await this.reply(senderJid, '🔑 PIN terverifikasi. Mengeksekusi...');
        return await this.executeAction(senderJid, action, target, targetNodeId);
      } else {
        return await this.reply(senderJid, '❌ PIN keamanan salah! Tindakan dibatalkan.');
      }
    }

    // Minta konfirmasi PIN secara interaktif
    this.pendingActions.set(cleanSender, {
      action,
      target,
      targetNodeId,
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

  async executeAction(senderJid, action, target, targetNodeId = null) {
    const isLocal = !targetNodeId || targetNodeId === config.nodeId;

    if (action === 'restart_docker') {
      await this.reply(senderJid, `⏳ Merestart container *${target}*...`);
      let result;
      if (isLocal) {
        result = await security.restartDockerContainer(target);
      } else {
        const res = await cluster.dispatchCommand(targetNodeId, 'docker-restart', { container: target });
        result = res?.error ? `❌ Gagal: ${res.error}` : (typeof res === 'string' ? res : JSON.stringify(res));
      }
      return await this.reply(senderJid, result);
    }
    if (action === 'block_ip') {
      await this.reply(senderJid, `🧱 Menerapkan aturan blokir untuk IP *${target}* di Firewall...`);
      let result;
      if (isLocal) {
        result = await security.blockIp(target);
      } else {
        const res = await cluster.dispatchCommand(targetNodeId, 'block-ip', { ip: target });
        result = res?.error ? `❌ Gagal: ${res.error}` : (typeof res === 'string' ? res : JSON.stringify(res));
      }
      return await this.reply(senderJid, `🛡️ ${result}`);
    }
    if (action === 'lockdown') {
      await this.reply(senderJid, '🚨 Menjalankan protokol EMERGENSI: Memutus Cloudflare Tunnel...');
      let result;
      if (isLocal) {
        result = await security.emergencyLockdown();
      } else {
        const res = await cluster.dispatchCommand(targetNodeId, 'lockdown');
        result = res?.error ? `❌ Gagal: ${res.error}` : (typeof res === 'string' ? res : JSON.stringify(res));
      }
      return await this.reply(senderJid, `${result}\nUntuk mengaktifkan kembali, ketik *10* atau *!restore*.`);
    }
    if (action === 'restart_service') {
      await this.reply(senderJid, `⏳ Merestart layanan *${target}* pada server *${targetNodeId || config.nodeId}*...`);
      let result;
      if (isLocal) {
        result = await security.restartService(target);
      } else {
        const res = await cluster.dispatchCommand(targetNodeId, 'service-restart', { name: target });
        result = res?.error ? `❌ Gagal: ${res.error}` : (res?.message || JSON.stringify(res));
      }
      return await this.reply(senderJid, `🔄 ${result.message || result}`);
    }
  }

  async replyWithAI(senderJid, userQuestion) {
    try {
      const health = await security.getSystemHealth();
      const prompt = `Anda adalah SysAdmin & Security Guard Agent cerdas untuk server ini.
Kondisi server saat ini:
- CPU: ${health.CPU}%
- RAM: ${health.UsedRamGB}GB / ${health.TotalRamGB}GB
- Uptime: ${health.Uptime}

Pertanyaan Admin: "${userQuestion}"

Jawablah dengan ringkas, ramah, dan profesional dalam Bahasa Indonesia. Jika memerlukan tindakan sistem, sarankan perintah yang sesuai (seperti monitor, 1 untuk status, 2 untuk threats, dll).`;

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
      `🤖 Perintah tidak dikenali. Ketik *monitor* untuk memilih server dan melihat daftar kendali, atau ketik *0* untuk ganti server.`
    );
  }

  async reply(jid, text) {
    if (!this.sock) return;
    try {
      if (typeof text !== 'string') {
        text = text ? String(text) : '';
      }
      if (!text || text.trim() === '') {
        console.warn(`[WA] Mencoba membalas ke ${jid} dengan pesan kosong, dibatalkan.`);
        return;
      }
      await this.sock.sendMessage(jid, { text: text.trim() });
    } catch (err) {
      console.error(`[WA] Gagal membalas ke ${jid}:`, err.message);
    }
  }

  async broadcastToAdmins(message, category = null) {
    if (!this.sock || !this.isConnected || !this.sock.user) {
      console.warn('[WA Broadcast] Tidak dapat mengirim pesan: WhatsApp sock belum terhubung.');
      return;
    }
    if (typeof message !== 'string') {
      message = message ? String(message) : '';
    }
    if (!message || message.trim() === '') {
      console.warn('[WA Broadcast] Pesan broadcast kosong, dibatalkan.');
      return;
    }
    const recipients = contactsManager.getActiveNumbers(category);
    for (const number of recipients) {
      try {
        const jid = `${number}@s.whatsapp.net`;
        await this.sock.sendMessage(jid, { text: message.trim() });
        contactsManager.updateLastAlert(number);
      } catch (err) {
        console.error(`[WA Broadcast] Gagal kirim notif ke ${number}:`, err.message);
      }
    }
  }
}

module.exports = WhatsAppClient;
