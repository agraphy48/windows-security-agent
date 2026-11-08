const crypto = require('crypto');
const contactsManager = require('./contacts');
const config = require('./config');
const cluster = require('./cluster');

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

class RateLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  isLimited(key) {
    const now = Date.now();
    const timestamps = (this.hits.get(key) || []).filter(t => now - t < this.windowMs);
    if (timestamps.length >= this.maxRequests) {
      this.hits.set(key, timestamps);
      return true;
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return false;
  }

  getResetTime(key) {
    const now = Date.now();
    const timestamps = (this.hits.get(key) || []).filter(t => now - t < this.windowMs);
    if (timestamps.length === 0) return 0;
    return Math.ceil((timestamps[0] + this.windowMs - now) / 1000);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter(t => now - t < this.windowMs);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }
}

class WebPortal {
  constructor() {
    this.sessions = new Map(); // token -> { username, expiresAt }
    this.failedLogins = new Map(); // ip -> { count, lockedUntil }
    this.sessionTimeoutMs = 24 * 60 * 60 * 1000; // 24 jam
    this.globalLimiter = new RateLimiter(60 * 1000, 150); // Max 150 req/menit per IP
    this.testWaLimiter = new RateLimiter(60 * 1000, 5); // Max 5 tes WA/menit
    this.botPairLimiter = new RateLimiter(5 * 60 * 1000, 5); // Max 5 pairing req/5 menit
    this.contactsWriteLimiter = new RateLimiter(60 * 1000, 30); // Max 30 modifikasi kontak/menit
  }

  setSecurityHeaders(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com;");

    const proto = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : '');
    if (proto === 'https' || req.headers['cf-visitor']?.includes('https')) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  }

  parseCookies(req) {
    const list = {};
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return list;

    cookieHeader.split(';').forEach(cookie => {
      let [name, ...rest] = cookie.split('=');
      name = name.trim();
      if (!name) return;
      const value = rest.join('=').trim();
      list[name] = decodeURIComponent(value);
    });
    return list;
  }

  getSession(req) {
    const cookies = this.parseCookies(req);
    const token = cookies.secops_session;
    if (!token) return null;

    const session = this.sessions.get(token);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  getClientIp(req) {
    // 1. Cloudflare IP (jika di balik Cloudflare Proxy)
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp && typeof cfIp === 'string') return cfIp.trim();

    // 2. Standard Reverse Proxy X-Real-IP
    const realIp = req.headers['x-real-ip'];
    if (realIp && typeof realIp === 'string') return realIp.trim();

    // 3. X-Forwarded-For (ambil IP pertama klien)
    const xff = req.headers['x-forwarded-for'];
    if (xff && typeof xff === 'string') {
      const parts = xff.split(',');
      if (parts.length > 0) return parts[0].trim().replace(/^.*:/, '');
    }

    // 4. Fallback ke Socket Remote Address
    const remote = req.socket?.remoteAddress || 'unknown';
    return String(remote).replace(/^.*:/, '');
  }

  async readBody(req, maxSize = 1048576) {
    return new Promise((resolve, reject) => {
      let body = '';
      let receivedBytes = 0;
      let aborted = false;

      req.on('data', chunk => {
        if (aborted) return;
        receivedBytes += chunk.length;
        if (receivedBytes > maxSize) {
          aborted = true;
          req.destroy();
          const err = new Error('Payload melebihi batas ukuran maksimal (1MB).');
          err.statusCode = 413;
          return reject(err);
        }
        body += chunk;
      });

      req.on('end', () => {
        if (aborted) return;
        if (!body) return resolve({});
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({});
          }
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(body);
          const obj = {};
          for (const [k, v] of params.entries()) {
            obj[k] = v;
          }
          resolve(obj);
        } else {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ raw: body });
          }
        }
      });

      req.on('error', err => {
        if (!aborted) reject(err);
      });
    });
  }

  async handleRequest(req, res, waClient) {
    // 0. Terapkan HTTP Security Headers & Proteksi Global Rate Limiting
    this.setSecurityHeaders(req, res);

    const clientIp = this.getClientIp(req);
    if (this.globalLimiter.isLimited(clientIp)) {
      const waitSec = this.globalLimiter.getResetTime(clientIp);
      res.writeHead(429, { 
        'Content-Type': 'application/json',
        'Retry-After': String(waitSec || 30)
      });
      res.end(JSON.stringify({ 
        success: false, 
        error: `Terlalu banyak permintaan (Rate limit exceeded). Coba lagi dalam ${waitSec || 30} detik.` 
      }));
      return true;
    }

    const url = req.url.split('?')[0];
    const method = req.method.toUpperCase();

    // 1. Static / Public Routes
    if (url === '/login' && (method === 'GET' || method === 'HEAD')) {
      const session = this.getSession(req);
      if (session) {
        res.writeHead(302, { Location: '/dashboard' });
        res.end();
        return true;
      }
      if (method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end();
        return true;
      }
      this.renderLoginPage(res);
      return true;
    }

    if (url === '/api/login' && method === 'POST') {
      await this.handleApiLogin(req, res);
      return true;
    }

    if (url === '/api/logout') {
      this.handleApiLogout(req, res);
      return true;
    }

    if (url === '/' && (method === 'GET' || method === 'HEAD')) {
      // Jika WhatsApp belum terhubung dan ada QR code
      if (!waClient.isConnected && waClient.currentQrDataUrl) {
        this.renderQrPage(res, waClient);
        return true;
      }
      // Jika WhatsApp sudah terhubung, arahkan ke dashboard (atau login jika belum auth)
      const session = this.getSession(req);
      if (session) {
        res.writeHead(302, { Location: '/dashboard' });
      } else {
        res.writeHead(302, { Location: '/login' });
      }
      res.end();
      return true;
    }

    if (url === '/qr' && (method === 'GET' || method === 'HEAD')) {
      if (method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end();
        return true;
      }
      this.renderQrPage(res, waClient);
      return true;
    }

    // 2. Protected Routes (Harus Login)
    if (url === '/dashboard' && (method === 'GET' || method === 'HEAD')) {
      const session = this.getSession(req);
      if (!session) {
        res.writeHead(302, { Location: '/login' });
        res.end();
        return true;
      }
      if (method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end();
        return true;
      }
      this.renderDashboardPage(res, waClient, session);
      return true;
    }

    // 3. Protected API Routes
    if (url.startsWith('/api/')) {
      const session = this.getSession(req);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Sesi kedaluwarsa atau belum login. Silakan login kembali.' }));
        return true;
      }

      if (url === '/api/status' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const nodes = Array.from(cluster.nodes.values()).map(n => ({
          nodeId: n.nodeId,
          name: n.name,
          role: n.role,
          status: n.status,
          url: n.url
        }));
        res.end(JSON.stringify({
          success: true,
          nodeId: config.nodeId,
          nodeName: config.nodeName,
          clusterRole: config.clusterRole,
          waConnected: waClient.isConnected,
          totalContacts: contactsManager.getAll().length,
          activeContacts: contactsManager.getActiveNumbers().length,
          clusterNodes: nodes
        }));
        return true;
      }

      if (url === '/api/contacts' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, contacts: contactsManager.getAll() }));
        return true;
      }

      if (url === '/api/contacts' && method === 'POST') {
        const rateKey = session?.username || clientIp;
        if (this.contactsWriteLimiter.isLimited(rateKey)) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Terlalu banyak permintaan simpan kontak. Tunggu sebentar.' }));
          return true;
        }
        await this.handleApiAddContact(req, res);
        return true;
      }

      if (url.startsWith('/api/contacts/') && method === 'DELETE') {
        const rateKey = session?.username || clientIp;
        if (this.contactsWriteLimiter.isLimited(rateKey)) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Terlalu banyak permintaan hapus kontak.' }));
          return true;
        }
        const id = url.replace('/api/contacts/', '');
        const removed = contactsManager.removeContact(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: !!removed, removed }));
        return true;
      }

      if (url.startsWith('/api/contacts/') && url.endsWith('/toggle') && method === 'POST') {
        const rateKey = session?.username || clientIp;
        if (this.contactsWriteLimiter.isLimited(rateKey)) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Terlalu banyak permintaan ubah status kontak.' }));
          return true;
        }
        const id = url.replace('/api/contacts/', '').replace('/toggle', '');
        const contact = contactsManager.toggleContact(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: !!contact, contact }));
        return true;
      }

      if (url.startsWith('/api/contacts/') && url.endsWith('/test') && method === 'POST') {
        const rateKey = session?.username || clientIp;
        if (this.testWaLimiter.isLimited(rateKey)) {
          const waitSec = this.testWaLimiter.getResetTime(rateKey);
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `Batas pengiriman uji coba tercapai. Tunggu ${waitSec} detik.` }));
          return true;
        }
        const id = url.replace('/api/contacts/', '').replace('/test', '');
        await this.handleApiTestContact(req, res, id, waClient);
        return true;
      }

      // 4. API Manajemen Gateway Bot WhatsApp Pengirim (Pairing Code & QR)
      if (url === '/api/bot/status' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...waClient.getBotStatus() }));
        return true;
      }

      if (url === '/api/bot/pair' && method === 'POST') {
        if (this.botPairLimiter.isLimited(clientIp)) {
          const waitSec = this.botPairLimiter.getResetTime(clientIp);
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `Terlalu banyak permintaan kode pairing. Tunggu ${waitSec} detik.` }));
          return true;
        }
        let body = {};
        try {
          body = await this.readBody(req);
        } catch (err) {
          if (err.statusCode === 413) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Ukuran payload melebihi batas maksimal (1MB).' }));
            return true;
          }
        }
        try {
          const result = await waClient.requestPairingCode(body.phoneNumber);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return true;
      }

      if (url === '/api/bot/logout' && method === 'POST') {
        if (this.botPairLimiter.isLimited(clientIp)) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Terlalu banyak permintaan logout bot.' }));
          return true;
        }
        try {
          const result = await waClient.logoutBot();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return true;
      }

      if (url === '/api/bot/qr' && method === 'GET') {
        const qr = await waClient.getQrDataUrl();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          isConnected: waClient.isConnected,
          qr: qr || null
        }));
        return true;
      }
    }

    return false; // Bukan request web portal
  }

  async handleApiLogin(req, res) {
    const ip = this.getClientIp(req);
    const now = Date.now();

    // Cek proteksi brute force login
    const failInfo = this.failedLogins.get(ip);
    if (failInfo && failInfo.lockedUntil > now) {
      const waitSec = Math.ceil((failInfo.lockedUntil - now) / 1000);
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(waitSec) });
      return res.end(JSON.stringify({
        success: false,
        error: `Terlalu banyak percobaan login gagal. Akses IP Anda dikunci sementara selama ${waitSec} detik.`
      }));
    }

    let body = {};
    try {
      body = await this.readBody(req);
    } catch (err) {
      if (err.statusCode === 413) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Ukuran payload login melebihi batas maksimal (1MB).' }));
      }
    }

    const username = String(body.username || '').trim();
    const password = String(body.password || '').trim();

    const expectedUser = String(config.dashboardUser || 'admin');
    const expectedPass = String(config.dashboardPass || config.securityPin || '465157');
    const expectedPin = String(config.securityPin || '465157');

    const userValid = safeCompare(username, expectedUser);
    const passValid = safeCompare(password, expectedPass) || safeCompare(password, expectedPin);

    if (userValid && passValid) {
      // Login sukses
      this.failedLogins.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      this.sessions.set(token, {
        username,
        createdAt: now,
        expiresAt: now + this.sessionTimeoutMs
      });

      const isHttps = (req.headers['x-forwarded-proto'] === 'https') || (req.headers['cf-visitor']?.includes('https')) || !!req.socket?.encrypted;
      const cookieFlags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${isHttps ? '; Secure' : ''}`;

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `secops_session=${token}; ${cookieFlags}`
      });
      return res.end(JSON.stringify({ success: true, message: 'Login berhasil!' }));
    } else {
      // Login gagal
      const currentFails = (failInfo ? failInfo.count : 0) + 1;
      let lockedUntil = 0;
      if (currentFails >= 5) {
        lockedUntil = now + (10 * 60 * 1000); // Kunci 10 menit
        console.warn(`[🚨 BRUTE-FORCE LOGIN] IP ${ip} gagal 5x login ke Web Portal. IP dikunci 10 menit.`);
      }
      this.failedLogins.set(ip, { count: currentFails, lockedUntil });

      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: 'Username atau Password/PIN salah!' + (currentFails >= 5 ? ' IP Anda dikunci selama 10 menit.' : ` (${currentFails}/5 percobaan)`)
      }));
    }
  }

  handleApiLogout(req, res) {
    const cookies = this.parseCookies(req);
    if (cookies.secops_session) {
      this.sessions.delete(cookies.secops_session);
    }
    const isHttps = (req.headers['x-forwarded-proto'] === 'https') || (req.headers['cf-visitor']?.includes('https')) || !!req.socket?.encrypted;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `secops_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps ? '; Secure' : ''}`
    });
    return res.end(JSON.stringify({ success: true }));
  }

  async handleApiAddContact(req, res) {
    let body = {};
    try {
      body = await this.readBody(req);
    } catch (err) {
      if (err.statusCode === 413) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Ukuran payload melebihi batas (1MB).' }));
      }
    }
    try {
      const result = contactsManager.addContact({
        number: body.number,
        name: body.name,
        role: body.role,
        alerts: body.alerts
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, ...result }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  async handleApiTestContact(req, res, id, waClient) {
    const contact = contactsManager.getAll().find(c => c.id === id || c.number === id);
    if (!contact) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Kontak tidak ditemukan.' }));
    }

    if (!waClient.sock || !waClient.isConnected) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Gateway WhatsApp sedang tidak terhubung. Silakan scan QR code terlebih dahulu.' }));
    }

    const testMessage = 
`🧪 *UJI COBA NOTIFIKASI DARURAT SECOPS AGENT* 🧪
-----------------------------------------
Halo *${contact.name}*,
Nomor WhatsApp Anda berhasil diverifikasi dan terdaftar sebagai *Penerima Pesan Urgensi* pada sistem keamanan server.

• *Server Koordinator:* ${config.nodeName} (\`${config.nodeId}\`)
• *Peran Petugas:* ${contact.role}
• *Kategori Peringatan:* ${contact.alerts.join(', ').toUpperCase()}
• *Status Sistem:* 🟢 SIAP & AKTIF OPERASIONAL
-----------------------------------------
_Pesan ini dikirim sebagai pengujian koneksi darurat dari Web Management Portal._
Waktu Uji: ${new Date().toLocaleString('id-ID')}`;

    let cleanMessage = String(testMessage || '').trim();
    if (!cleanMessage) {
      cleanMessage = `🧪 *UJI COBA NOTIFIKASI DARURAT SECOPS AGENT*\n\nHalo ${contact.name}, ini adalah pesan verifikasi jalur darurat server.`;
    }

    try {
      const jid = `${contact.number}@s.whatsapp.net`;
      await waClient.sock.sendMessage(jid, { text: cleanMessage });
      contactsManager.updateLastAlert(contact.number);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: `Pesan uji coba berhasil dikirim ke ${contact.name} (${contact.number})!` }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: `Gagal mengirim pesan WhatsApp: ${err.message}` }));
    }
  }

  renderLoginPage(res) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - SecOps Emergency Alerts Portal</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background: #0b0f19; color: #f1f5f9; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 40px; width: 100%; max-width: 420px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5); }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo-icon { font-size: 54px; filter: drop-shadow(0 0 16px rgba(16, 185, 129, 0.4)); display: inline-block; margin-bottom: 8px; }
    .title { font-size: 22px; font-weight: 700; color: #f8fafc; letter-spacing: -0.5px; }
    .subtitle { font-size: 13px; color: #94a3b8; margin-top: 4px; }
    .form-group { margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
    input { width: 100%; padding: 12px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 14px; transition: border-color 0.2s, box-shadow 0.2s; }
    input:focus { outline: none; border-color: #10b981; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2); }
    .btn { width: 100%; padding: 12px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: opacity 0.2s, transform 0.1s; margin-top: 8px; }
    .btn:hover { opacity: 0.95; }
    .btn:active { transform: scale(0.98); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .alert { padding: 12px; border-radius: 8px; font-size: 13px; margin-bottom: 18px; display: none; }
    .alert-error { background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5; }
    .hint { text-align: center; font-size: 12px; color: #64748b; margin-top: 20px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">🛡️</div>
      <h1 class="title">SecOps Emergency Portal</h1>
      <p class="subtitle">Manajemen Nomor WhatsApp Penerima Urgensi</p>
    </div>

    <div id="errorBox" class="alert alert-error"></div>

    <form id="loginForm">
      <div class="form-group">
        <label for="username">Username Admin</label>
        <input type="text" id="username" name="username" placeholder="admin" required autofocus autocomplete="username">
      </div>
      <div class="form-group">
        <label for="password">Password / Security PIN</label>
        <input type="password" id="password" name="password" placeholder="Masukkan PIN / Password" required autocomplete="current-password">
      </div>
      <button type="submit" id="submitBtn" class="btn">Masuk ke Dashboard</button>
    </form>

    <p class="hint">
      🔒 Dilindungi oleh sistem otentikasi sesi Zero-Trust & Rate Limiter.<br>
      Default PIN: Sesuai <code>SECURITY_PIN</code> server.
    </p>
  </div>

  <script>
    const form = document.getElementById('loginForm');
    const errorBox = document.getElementById('errorBox');
    const submitBtn = document.getElementById('submitBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.innerText = 'Memverifikasi...';

      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success) {
          window.location.href = '/dashboard';
        } else {
          errorBox.innerText = data.error || 'Login gagal!';
          errorBox.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.innerText = 'Masuk ke Dashboard';
        }
      } catch (err) {
        errorBox.innerText = 'Gagal terhubung ke server: ' + err.message;
        errorBox.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.innerText = 'Masuk ke Dashboard';
      }
    });
  </script>
</body>
</html>`);
  }

  renderQrPage(res, waClient) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (waClient.isConnected) {
      res.end(`<!DOCTYPE html>
<html>
<head><title>WhatsApp Terhubung</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:sans-serif;text-align:center;padding:50px;background:#0b0f19;color:#fff;">
  <h1 style="color:#10b981;">✅ WhatsApp Terhubung!</h1>
  <p style="margin:16px 0;color:#94a3b8;">Security Agent siap memantau server dan mengirim alert.</p>
  <a href="/dashboard" style="display:inline-block;padding:12px 24px;background:#10b981;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Buka Dashboard Kontak Darurat</a>
</body>
</html>`);
    } else if (waClient.currentQrDataUrl) {
      res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Scan WhatsApp Security Agent</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="5">
</head>
<body style="font-family:sans-serif;text-align:center;padding:30px;background:#0b0f19;color:#fff;">
  <h2 style="color:#f8fafc;margin-bottom:8px;">Scan QR Code WhatsApp Security Agent</h2>
  <p style="color:#94a3b8;">Buka WhatsApp di Ponsel &gt; Perangkat Tertaut &gt; Tautkan Perangkat</p>
  <div style="background:#fff;padding:20px;display:inline-block;border-radius:16px;margin:24px 0;box-shadow:0 10px 25px rgba(0,0,0,0.5);">
    <img src="${waClient.currentQrDataUrl}" alt="WhatsApp QR Code" style="width:280px;height:280px;" />
  </div>
  <p style="color:#64748b;font-size:13px;">Halaman memperbarui otomatis setiap 5 detik.</p>
</body>
</html>`);
    } else {
      res.end(`<!DOCTYPE html>
<html>
<head><meta http-equiv="refresh" content="2"></head>
<body style="font-family:sans-serif;text-align:center;padding:50px;background:#0b0f19;color:#fff;">
  <h3>Membuat QR Code WhatsApp...</h3>
  <p style="color:#94a3b8;">Tunggu sebentar...</p>
</body>
</html>`);
    }
  }

  renderDashboardPage(res, waClient, session) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard Kontak Urgensi - SecOps Agent</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #1e293b;
      --border: #334155;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #10b981;
      --primary-hover: #059669;
      --danger: #ef4444;
      --warning: #f59e0b;
      --info: #3b82f6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background: var(--bg); color: var(--text-main); min-height: 100vh; padding: 24px; }
    .container { max-width: 1200px; margin: 0 auto; }
    
    /* Header */
    header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; padding-bottom: 24px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-icon { font-size: 32px; filter: drop-shadow(0 0 12px rgba(16, 185, 129, 0.4)); }
    .brand-title { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    .brand-sub { font-size: 13px; color: var(--text-muted); }
    .header-actions { display: flex; align-items: center; gap: 12px; }
    .user-tag { background: #334155; padding: 6px 12px; border-radius: 8px; font-size: 13px; color: #cbd5e1; }
    .btn-logout { background: #475569; color: #fff; border: none; padding: 7px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; transition: background 0.2s; }
    .btn-logout:hover { background: var(--danger); }

    /* Stats Grid */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 18px; display: flex; align-items: center; gap: 16px; }
    .stat-icon { width: 48px; height: 48px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 24px; }
    .stat-icon.green { background: rgba(16, 185, 129, 0.15); color: var(--primary); }
    .stat-icon.blue { background: rgba(59, 130, 246, 0.15); color: var(--info); }
    .stat-icon.amber { background: rgba(245, 158, 11, 0.15); color: var(--warning); }
    .stat-value { font-size: 24px; font-weight: 700; color: #fff; }
    .stat-label { font-size: 13px; color: var(--text-muted); }

    /* Layout Main */
    .main-grid { display: grid; grid-template-columns: 360px 1fr; gap: 24px; }
    @media (max-width: 900px) { .main-grid { grid-template-columns: 1fr; } }

    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 14px; padding: 24px; }
    .card-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; color: #f1f5f9; }

    /* Form */
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
    input[type="text"], select { width: 100%; padding: 10px 12px; background: #0f172a; border: 1px solid var(--border); border-radius: 8px; color: #fff; font-size: 14px; }
    input:focus, select:focus { outline: none; border-color: var(--primary); }
    .checkbox-group { display: flex; flex-direction: column; gap: 8px; background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid var(--border); }
    .checkbox-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #cbd5e1; cursor: pointer; }
    .btn-primary { width: 100%; padding: 11px; background: var(--primary); color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .btn-primary:hover { background: var(--primary-hover); }

    /* Table */
    .table-responsive { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 12px; background: #0f172a; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--border); }
    td { padding: 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    tr:hover { background: rgba(255, 255, 255, 0.02); }

    /* Badges */
    .badge { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
    .badge-all { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .badge-attack { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .badge-down { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .badge-service { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .badge-active { background: #064e3b; color: #34d399; }
    .badge-inactive { background: #374151; color: #9ca3af; }

    /* Action Buttons */
    .btn-action { padding: 6px 10px; border-radius: 6px; border: none; font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
    .btn-test { background: #2563eb; color: #fff; margin-right: 4px; }
    .btn-test:hover { background: #1d4ed8; }
    .btn-delete { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .btn-delete:hover { background: #ef4444; color: #fff; }
    .btn-toggle { background: #334155; color: #cbd5e1; margin-right: 4px; }
    .btn-toggle:hover { background: #475569; }

    /* Toast */
    #toast { position: fixed; bottom: 24px; right: 24px; padding: 14px 20px; border-radius: 10px; font-size: 14px; font-weight: 600; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5); display: none; z-index: 9999; }
    .toast-success { background: #065f46; color: #6ee7b7; border: 1px solid #10b981; }
    .toast-error { background: #7f1d1d; color: #fca5a5; border: 1px solid #ef4444; }

    /* Cluster Fleet list */
    .fleet-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #0f172a; border-radius: 8px; margin-bottom: 8px; font-size: 12px; }
    .fleet-status { display: inline-flex; align-items: center; gap: 6px; }
    .dot-online { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); box-shadow: 0 0 8px var(--primary); }
    .dot-offline { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }

    /* Tabs & Gateway Bot */
    .tab-btn { background: transparent; color: #94a3b8; border: none; border-bottom: 2px solid transparent; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
    .tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }
    .tab-btn:hover { color: #f8fafc; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header>
      <div class="brand">
        <div class="brand-icon">🛡️</div>
        <div>
          <h1 class="brand-title">SecOps Command Center</h1>
          <p class="brand-sub">Manajemen Nomor WhatsApp Penerima Notifikasi Urgensi Multi-Server</p>
        </div>
      </div>
      <div class="header-actions">
        <span class="user-tag">👤 Admin: <b>${escapeHtml(session.username)}</b></span>
        <button onclick="handleLogout()" class="btn-logout">🚪 Keluar</button>
      </div>
    </header>

    <!-- Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon green">📱</div>
        <div>
          <div id="statTotalContacts" class="stat-value">-</div>
          <div class="stat-label">Total Nomor Darurat Terdaftar</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue">⚡</div>
        <div>
          <div id="statActiveContacts" class="stat-value">-</div>
          <div class="stat-label">Penerima Siaga Aktif</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon amber">🖥️</div>
        <div>
          <div id="statFleetCount" class="stat-value">-</div>
          <div class="stat-label">Server Terhubung di Cluster</div>
        </div>
      </div>
    </div>

    <!-- Kartu Gateway Bot WhatsApp Pengirim -->
    <div class="card" style="margin-bottom: 24px; border-left: 4px solid var(--primary);">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
        <div>
          <h2 class="card-title" style="margin-bottom:4px;">🤖 Gateway Akun WhatsApp Pengirim (Bot Sender)</h2>
          <p style="font-size:12px;color:var(--text-muted);">
            Nomor WhatsApp yang digunakan oleh sistem untuk mengirimkan peringatan darurat & interaksi chatbot ke tim SecOps.
          </p>
        </div>
        <div id="botStatusBadge">
          <span class="badge" style="background:#374151;color:#9ca3af;font-size:12px;padding:6px 12px;">⏳ Mengecek status gateway...</span>
        </div>
      </div>

      <!-- Tampilan Jika Bot SUDAH Terhubung -->
      <div id="botConnectedBox" style="display:none;background:#0f172a;border:1px solid #334155;border-radius:10px;padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;">
          <div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Nomor Bot Pengirim Aktif:</div>
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:22px;font-weight:700;color:#34d399;font-family:monospace;" id="botActiveNumber">+62xxxxxxxxxx</span>
              <span id="botActiveName" class="badge" style="background:#064e3b;color:#a7f3d0;font-size:12px;">SecOps Agent Bot</span>
            </div>
            <p style="font-size:12px;color:#64748b;margin-top:6px;">
              🛡️ Semua notifikasi insiden serangan, status server down/pulih, dan balasan chatbot dikirim melalui nomor ini.
            </p>
          </div>
          <div>
            <button onclick="handleBotLogout()" class="btn-action btn-delete" style="padding:10px 16px;font-size:13px;border-radius:8px;">
              🔄 Putuskan & Ganti Nomor Pengirim
            </button>
          </div>
        </div>
      </div>

      <!-- Tampilan Jika Bot BELUM Terhubung (Form Pairing Code & QR) -->
      <div id="botDisconnectedBox" style="display:none;">
        <div style="display:flex;gap:8px;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:10px;">
          <button id="tabBtnPairing" onclick="switchBotTab('pairing')" class="tab-btn active">⚡ Tautkan No. HP (Pairing Code - Tanpa Kamera)</button>
          <button id="tabBtnQr" onclick="switchBotTab('qr')" class="tab-btn">📷 Scan QR Code</button>
        </div>

        <!-- Tab 1: Pairing Code -->
        <div id="tabContentPairing">
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:24px;align-items:start;">
            <div>
              <form id="pairBotForm">
                <div class="form-group">
                  <label for="botPairNumber">Masukkan Nomor WhatsApp yang Ingin Dijadikan Pengirim:</label>
                  <input type="text" id="botPairNumber" placeholder="Contoh: 08123456789 atau 628123456789" required>
                  <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block;">
                    Gunakan nomor WhatsApp aktif di ponsel Anda (nomor pribadi / bot kantor).
                  </span>
                </div>
                <button type="submit" id="btnRequestPair" class="btn-primary" style="padding:12px;background:linear-gradient(135deg, #10b981 0%, #059669 100%);">
                  ⚡ Dapatkan 8-Digit Kode Pairing
                </button>
              </form>
            </div>

            <!-- Box Hasil Kode Pairing -->
            <div>
              <div id="pairingCodeBox" style="display:none;background:#090d16;border:2px dashed #10b981;border-radius:12px;padding:20px;text-align:center;">
                <div style="font-size:12px;color:#a7f3d0;margin-bottom:8px;font-weight:600;">MASUKKAN KODE INI KE WHATSAPP ANDA:</div>
                <div id="pairingCodeDisplay" style="font-size:32px;font-weight:800;letter-spacing:6px;color:#34d399;font-family:monospace;margin:10px 0;">
                  ---- ----
                </div>
                <div style="display:flex;justify-content:center;gap:10px;margin-bottom:12px;">
                  <button onclick="copyPairingCode()" class="btn-action btn-test" style="padding:6px 14px;">📋 Salin Kode</button>
                  <span id="pairingCountdown" style="font-size:12px;color:#fbbf24;display:flex;align-items:center;">⏳ Berlaku 60s</span>
                </div>
                <div style="text-align:left;background:#0f172a;padding:12px;border-radius:8px;font-size:11px;color:#94a3b8;line-height:1.6;">
                  <b>Langkah di Ponsel:</b><br>
                  1. Buka aplikasi WhatsApp &gt; Ketuk Titik Tiga / Pengaturan<br>
                  2. Pilih <b>Perangkat Tertaut</b> &gt; <b>Tautkan Perangkat</b><br>
                  3. Pilih opsi <b>"Tautkan dengan nomor telepon saja"</b> di bagian bawah<br>
                  4. Ketikkan 8 karakter kode di atas. Bot seketika online!
                </div>
              </div>

              <div id="pairingCodePlaceholder" style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:24px;text-align:center;color:#64748b;font-size:13px;">
                💡 Masukkan nomor WhatsApp di samping kiri lalu klik tombol untuk meminta kode pairing resmi dari WhatsApp server tanpa perlu mengarahkan kamera.
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 2: QR Code Scan -->
        <div id="tabContentQr" style="display:none;text-align:center;padding:20px 0;">
          <p style="color:#94a3b8;font-size:13px;margin-bottom:12px;">
            Arahkan kamera WhatsApp di ponsel ke QR Code berikut:
          </p>
          <div id="qrImageContainer" style="background:#fff;padding:16px;display:inline-block;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.5);min-width:270px;min-height:270px;">
            <div id="qrLoadingText" style="color:#0f172a;font-size:13px;padding:90px 20px;font-weight:600;">⏳ Memuat QR Code WhatsApp...</div>
            <img id="botQrImg" src="" alt="WhatsApp QR" style="display:none;width:240px;height:240px;margin:0 auto;">
          </div>
          <div style="margin-top:14px;display:flex;justify-content:center;align-items:center;gap:12px;flex-wrap:wrap;">
            <button onclick="loadBotQr(true)" class="btn-action btn-toggle" style="padding:8px 16px;">🔄 Perbarui QR</button>
            <a href="/qr" target="_blank" style="color:#60a5fa;font-size:12px;text-decoration:none;font-weight:600;padding:8px 12px;background:#0f172a;border-radius:6px;border:1px solid var(--border);">
              🔗 Buka Halaman QR Penuh (/qr)
            </a>
          </div>
          <p style="color:#64748b;font-size:11px;margin-top:8px;">
            🔄 Otomatis memperbarui QR setiap 3 detik agar selalu valid.
          </p>
        </div>
      </div>
    </div>

    <!-- Main Layout -->
    <div class="main-grid">
      <!-- Kolom Kiri: Form Tambah Kontak & Status Fleet -->
      <div>
        <div class="card" style="margin-bottom: 24px;">
          <h2 class="card-title">➕ Tambah Nomor WhatsApp Darurat</h2>
          <form id="addContactForm">
            <div class="form-group">
              <label for="contactNumber">Nomor WhatsApp</label>
              <input type="text" id="contactNumber" placeholder="Contoh: 628123456789 atau 0812..." required>
              <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block;">Format internasional atau lokal (08 otomatis dikonversi).</span>
            </div>
            <div class="form-group">
              <label for="contactName">Nama Petugas / Pemilik</label>
              <input type="text" id="contactName" placeholder="Contoh: Dian (SysAdmin Leader)" required>
            </div>
            <div class="form-group">
              <label for="contactRole">Peran / Jabatan</label>
              <select id="contactRole">
                <option value="Lead SysAdmin">Lead SysAdmin</option>
                <option value="Security Incident Responder">Security Incident Responder</option>
                <option value="DevOps / Infrastructure">DevOps / Infrastructure</option>
                <option value="Management / Stakeholder">Management / Stakeholder</option>
                <option value="On-Call Engineer">On-Call Engineer</option>
              </select>
            </div>
            <div class="form-group">
              <label>Kategori Pesan Urgensi yang Diterima:</label>
              <div class="checkbox-group">
                <label class="checkbox-item">
                  <input type="checkbox" id="alertAll" value="all" checked onchange="toggleAlertCheckboxes(this)">
                  <span><b>🌟 Semua Notifikasi Darurat</b></span>
                </label>
                <label class="checkbox-item">
                  <input type="checkbox" class="sub-alert" value="attack">
                  <span>🚨 Serangan Siber & Intruder Alert</span>
                </label>
                <label class="checkbox-item">
                  <input type="checkbox" class="sub-alert" value="server_down">
                  <span>⚠️ Server / Node Down & Pemulihan</span>
                </label>
                <label class="checkbox-item">
                  <input type="checkbox" class="sub-alert" value="service_discovery">
                  <span>📦 Deteksi Service / Aplikasi Baru</span>
                </label>
              </div>
            </div>
            <button type="submit" id="btnAddContact" class="btn-primary">➕ Simpan & Aktifkan Kontak</button>
          </form>
        </div>

        <!-- Kartu Armada Server -->
        <div class="card">
          <h2 class="card-title">🌐 Status Armada Server Cluster</h2>
          <div id="fleetList">
            <p style="color:var(--text-muted);font-size:12px;">Memuat armada...</p>
          </div>
        </div>
      </div>

      <!-- Kolom Kanan: Tabel Daftar Kontak Darurat -->
      <div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 class="card-title" style="margin-bottom:0;">📋 Daftar Nomor WhatsApp Penerima Urgensi</h2>
            <button onclick="loadContacts()" style="background:#334155;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;">🔄 Refresh</button>
          </div>

          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>No</th>
                  <th>Nama & Peran</th>
                  <th>Nomor WhatsApp</th>
                  <th>Kategori Peringatan</th>
                  <th>Status</th>
                  <th>Aksi Cepat</th>
                </tr>
              </thead>
              <tbody id="contactsTableBody">
                <tr>
                  <td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">Memuat daftar nomor darurat...</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style="margin-top:20px;padding:12px;background:#0f172a;border-radius:8px;font-size:12px;color:#94a3b8;line-height:1.5;">
            💡 <b>Uji Coba Pengiriman:</b> Klik tombol <b>🧪 Tes WA</b> untuk mengirim pesan uji coba instan ke nomor bersangkutan dan memverifikasi penerimaan sinyal bot secara langsung.
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="toast"></div>

  <script>
    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function showToast(msg, isError = false) {
      const toast = document.getElementById('toast');
      toast.innerText = msg;
      toast.className = isError ? 'toast-error' : 'toast-success';
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 4000);
    }

    function toggleAlertCheckboxes(allCheckbox) {
      const subAlerts = document.querySelectorAll('.sub-alert');
      if (allCheckbox.checked) {
        subAlerts.forEach(cb => { cb.checked = false; cb.disabled = true; });
      } else {
        subAlerts.forEach(cb => { cb.disabled = false; });
      }
    }

    async function loadStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        if (data.success) {
          document.getElementById('statTotalContacts').innerText = data.totalContacts;
          document.getElementById('statActiveContacts').innerText = data.activeContacts;
          document.getElementById('statFleetCount').innerText = data.clusterNodes ? data.clusterNodes.length : 1;

          // Render fleet list
          const fleetDiv = document.getElementById('fleetList');
          if (data.clusterNodes && data.clusterNodes.length > 0) {
            fleetDiv.innerHTML = data.clusterNodes.map(node => {
              const isOnline = node.status === 'online';
              return \`
                <div class="fleet-item">
                  <div>
                    <b>\${escapeHtml(node.name)}</b> (\${escapeHtml(node.nodeId)})<br>
                    <span style="color:#64748b;font-size:11px;">Role: \${escapeHtml(node.role).toUpperCase()}</span>
                  </div>
                  <div class="fleet-status">
                    <span class="\${isOnline ? 'dot-online' : 'dot-offline'}"></span>
                    <span style="color:\${isOnline ? '#34d399' : '#f87171'};font-weight:600;">\${isOnline ? 'ONLINE' : 'OFFLINE'}</span>
                  </div>
                </div>
              \`;
            }).join('');
          }
        }
      } catch (err) {
        console.error('Error load status:', err);
      }
    }

    async function loadContacts() {
      const tbody = document.getElementById('contactsTableBody');
      try {
        const res = await fetch('/api/contacts');
        const data = await res.json();
        if (!data.success) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ef4444;">Gagal memuat kontak.</td></tr>';
          return;
        }

        const contacts = data.contacts || [];
        if (contacts.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">Belum ada kontak darurat terdaftar. Silakan tambahkan pada formulir di sebelah kiri.</td></tr>';
          return;
        }

        tbody.innerHTML = contacts.map((c, i) => {
          let alertBadges = '';
          if (c.alerts.includes('all')) {
            alertBadges = '<span class="badge badge-all">🌟 Semua Alert</span>';
          } else {
            alertBadges = c.alerts.map(a => {
              if (a === 'attack') return '<span class="badge badge-attack">🚨 Serangan</span>';
              if (a === 'server_down') return '<span class="badge badge-down">⚠️ Node Down</span>';
              if (a === 'service_discovery') return '<span class="badge badge-service">📦 Service Baru</span>';
              return \`<span class="badge">\${escapeHtml(a)}</span>\`;
            }).join(' ');
          }

          const statusBadge = c.active !== false 
            ? '<span class="badge badge-active">🟢 Aktif</span>' 
            : '<span class="badge badge-inactive">⚪ Nonaktif</span>';

          const toggleLabel = c.active !== false ? 'Matikan' : 'Aktifkan';

          return \`
            <tr>
              <td>\${i + 1}</td>
              <td>
                <b>\${escapeHtml(c.name)}</b><br>
                <span style="color:var(--text-muted);font-size:11px;">\${escapeHtml(c.role)}</span>
              </td>
              <td>
                <a href="https://wa.me/\${encodeURIComponent(c.number)}" target="_blank" style="color:#60a5fa;text-decoration:none;font-weight:600;">
                  📱 +\${escapeHtml(c.number)}
                </a>
              </td>
              <td>\${alertBadges}</td>
              <td>\${statusBadge}</td>
              <td>
                <button onclick="testContact('\${escapeHtml(c.id)}')" class="btn-action btn-test" title="Kirim Pesan Uji Coba WA">🧪 Tes WA</button>
                <button onclick="toggleContact('\${escapeHtml(c.id)}')" class="btn-action btn-toggle" title="Aktifkan/Nonaktifkan">\${toggleLabel}</button>
                <button onclick="deleteContact('\${escapeHtml(c.id)}', '\${escapeHtml(c.name).replace(/'/g, "\\\\'")}')" class="btn-action btn-delete" title="Hapus Kontak">🗑️</button>
              </td>
            </tr>
          \`;
        }).join('');

        loadStatus();
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ef4444;">Koneksi error: ' + err.message + '</td></tr>';
      }
    }

    document.getElementById('addContactForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnAddContact');
      btn.disabled = true;
      btn.innerText = 'Menyimpan...';

      const number = document.getElementById('contactNumber').value;
      const name = document.getElementById('contactName').value;
      const role = document.getElementById('contactRole').value;

      let alerts = [];
      const alertAll = document.getElementById('alertAll');
      if (alertAll.checked) {
        alerts = ['all'];
      } else {
        document.querySelectorAll('.sub-alert:checked').forEach(cb => {
          alerts.push(cb.value);
        });
        if (alerts.length === 0) alerts = ['all'];
      }

      try {
        const res = await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number, name, role, alerts })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✅ Kontak ' + name + ' berhasil didaftarkan!');
          document.getElementById('addContactForm').reset();
          document.getElementById('alertAll').checked = true;
          toggleAlertCheckboxes(document.getElementById('alertAll'));
          loadContacts();
        } else {
          showToast('❌ Gagal: ' + data.error, true);
        }
      } catch (err) {
        showToast('❌ Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerText = '➕ Simpan & Aktifkan Kontak';
      }
    });

    async function testContact(id) {
      showToast('⏳ Mengirim pesan uji coba via WhatsApp...');
      try {
        const res = await fetch('/api/contacts/' + id + '/test', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('✅ ' + data.message);
        } else {
          showToast('❌ Gagal kirim uji coba: ' + data.error, true);
        }
      } catch (err) {
        showToast('❌ Error: ' + err.message, true);
      }
    }

    async function toggleContact(id) {
      try {
        const res = await fetch('/api/contacts/' + id + '/toggle', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('Status kontak berhasil diubah.');
          loadContacts();
        } else {
          showToast('Gagal mengubah status kontak.', true);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      }
    }

    async function deleteContact(id, name) {
      if (!confirm('Apakah Anda yakin ingin menghapus kontak darurat ' + name + '? Nomor ini tidak akan menerima pesan urgensi lagi.')) {
        return;
      }
      try {
        const res = await fetch('/api/contacts/' + id, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          showToast('Kontak ' + name + ' berhasil dihapus.');
          loadContacts();
        } else {
          showToast('Gagal menghapus kontak.', true);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      }
    }

    async function handleLogout() {
      try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
      } catch {
        window.location.href = '/login';
      }
    }

    // ==========================================
    // LOGIKA GATEWAY BOT WHATSAPP PENGIRIM
    // ==========================================
    let currentRawPairingCode = '';
    let pairingTimerInterval = null;
    let qrPollInterval = null;

    function switchBotTab(tab) {
      const tabPairing = document.getElementById('tabContentPairing');
      const tabQr = document.getElementById('tabContentQr');
      const btnPairing = document.getElementById('tabBtnPairing');
      const btnQr = document.getElementById('tabBtnQr');

      if (tab === 'pairing') {
        tabPairing.style.display = 'block';
        tabQr.style.display = 'none';
        btnPairing.classList.add('active');
        btnQr.classList.remove('active');
        if (qrPollInterval) {
          clearInterval(qrPollInterval);
          qrPollInterval = null;
        }
      } else {
        tabPairing.style.display = 'none';
        tabQr.style.display = 'block';
        btnPairing.classList.remove('active');
        btnQr.classList.add('active');
        loadBotQr(true);
        if (!qrPollInterval) {
          qrPollInterval = setInterval(loadBotQr, 2500);
        }
      }
    }

    async function loadBotStatus() {
      try {
        const res = await fetch('/api/bot/status');
        const data = await res.json();
        const badge = document.getElementById('botStatusBadge');
        const connectedBox = document.getElementById('botConnectedBox');
        const disconnectedBox = document.getElementById('botDisconnectedBox');

        if (data.isConnected) {
          if (qrPollInterval) {
            clearInterval(qrPollInterval);
            qrPollInterval = null;
          }
          badge.innerHTML = '<span class="badge badge-active" style="font-size:12px;padding:6px 12px;">🟢 ONLINE (TERHUBUNG)</span>';
          connectedBox.style.display = 'block';
          disconnectedBox.style.display = 'none';
          document.getElementById('botActiveNumber').innerText = data.botNumber ? '+' + data.botNumber : 'WhatsApp Aktif';
          document.getElementById('botActiveName').innerText = data.botName ? data.botName : 'SecOps Agent Bot';
          if (pairingTimerInterval) clearInterval(pairingTimerInterval);
        } else {
          badge.innerHTML = '<span class="badge" style="background:#7f1d1d;color:#fca5a5;font-size:12px;padding:6px 12px;">🔴 TERPUTUS / BELUM TERTAUT</span>';
          connectedBox.style.display = 'none';
          disconnectedBox.style.display = 'block';

          if (data.isPairingActive && data.lastPairingCode) {
            showPairingCodeUI(data.lastPairingCode, data.pairingExpiresIn);
          }
        }
      } catch (err) {
        console.error('Error load bot status:', err);
      }
    }

    function showPairingCodeUI(code, expiresInSec) {
      currentRawPairingCode = code.replace(/[^a-zA-Z0-9]/g, '');
      document.getElementById('pairingCodeDisplay').innerText = code;
      document.getElementById('pairingCodeBox').style.display = 'block';
      document.getElementById('pairingCodePlaceholder').style.display = 'none';

      if (pairingTimerInterval) clearInterval(pairingTimerInterval);
      let secLeft = expiresInSec || 60;
      const countdownEl = document.getElementById('pairingCountdown');
      countdownEl.innerText = '⏳ Berlaku ' + secLeft + 's';

      pairingTimerInterval = setInterval(() => {
        secLeft--;
        if (secLeft <= 0) {
          clearInterval(pairingTimerInterval);
          countdownEl.innerText = '⚠️ Kadaluarsa. Minta ulang.';
        } else {
          countdownEl.innerText = '⏳ Berlaku ' + secLeft + 's';
        }
      }, 1000);
    }

    function copyPairingCode() {
      if (!currentRawPairingCode) return;
      navigator.clipboard.writeText(currentRawPairingCode).then(() => {
        showToast('📋 Kode pairing ' + currentRawPairingCode + ' disalin!');
      }).catch(() => {
        showToast('Kode: ' + currentRawPairingCode);
      });
    }

    document.getElementById('pairBotForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnRequestPair');
      const input = document.getElementById('botPairNumber');
      const phoneNumber = input.value.trim();
      if (!phoneNumber) return;

      btn.disabled = true;
      btn.innerText = '⚡ Menghubungkan ke WhatsApp Server...';

      try {
        const res = await fetch('/api/bot/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✅ Kode pairing berhasil dibuat!');
          showPairingCodeUI(data.pairingCode, data.expiresInSeconds);
          // Polling status koneksi otomatis
          const pollInterval = setInterval(async () => {
            const checkRes = await fetch('/api/bot/status');
            const checkData = await checkRes.json();
            if (checkData.isConnected) {
              clearInterval(pollInterval);
              showToast('🎉 WhatsApp Bot Pengirim Berhasil Terhubung!');
              loadBotStatus();
            }
          }, 3000);
          setTimeout(() => clearInterval(pollInterval), 90000);
        } else {
          showToast('❌ Gagal: ' + (data.error || 'Terjadi kesalahan'), true);
        }
      } catch (err) {
        showToast('❌ Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerText = '⚡ Dapatkan 8-Digit Kode Pairing';
      }
    });

    async function handleBotLogout() {
      if (!confirm('Apakah Anda yakin ingin memutuskan sesi WhatsApp Bot Pengirim? Bot tidak akan dapat mengirim pesan notifikasi darurat sampai nomor baru ditautkan.')) {
        return;
      }
      showToast('⏳ Memutuskan sesi WhatsApp Bot...');
      try {
        const res = await fetch('/api/bot/logout', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('✅ Sesi bot berhasil diputuskan. Silakan masukkan nomor baru.');
          setTimeout(loadBotStatus, 1500);
        } else {
          showToast('❌ Gagal: ' + data.error, true);
        }
      } catch (err) {
        showToast('❌ Error: ' + err.message, true);
      }
    }

    async function loadBotQr(isManual = false) {
      const qrImg = document.getElementById('botQrImg');
      const loading = document.getElementById('qrLoadingText');
      if (isManual) {
        loading.innerText = 'Memperbarui QR Code...';
        loading.style.display = 'block';
        qrImg.style.display = 'none';
      }
      try {
        const res = await fetch('/api/bot/qr');
        const data = await res.json();
        if (data.isConnected) {
          if (qrPollInterval) {
            clearInterval(qrPollInterval);
            qrPollInterval = null;
          }
          loadBotStatus();
        } else if (data.qr) {
          if (qrImg.src !== data.qr) {
            qrImg.src = data.qr;
          }
          qrImg.style.display = 'block';
          loading.style.display = 'none';
        } else {
          loading.innerText = 'Menunggu QR Code dari WhatsApp...';
          qrImg.style.display = 'none';
          loading.style.display = 'block';
        }
      } catch (err) {
        loading.innerText = 'Gagal memuat QR: ' + err.message;
      }
    }

    // Inisialisasi awal
    toggleAlertCheckboxes(document.getElementById('alertAll'));
    loadStatus();
    loadContacts();
    loadBotStatus();
    setInterval(loadBotStatus, 10000);
  </script>
</body>
</html>`);
  }
}

module.exports = new WebPortal();
