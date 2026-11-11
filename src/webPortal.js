const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const contactsManager = require('./contacts');
const config = require('./config');
const cluster = require('./cluster');
const mailer = require('./mailer');

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

function logAuthEvent(type, ip, user, reason) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `${timestamp} [${type}] IP: ${ip} User: ${user || 'unknown'} Reason: ${reason}\n`;
  
  const targets = [];
  if (process.platform === 'linux') {
    targets.push('/var/log/secops-portal-auth.log');
  }
  const localLogDir = path.join(__dirname, '..', 'logs');
  targets.push(path.join(localLogDir, 'secops-portal-auth.log'));

  for (const logPath of targets) {
    try {
      const dir = path.dirname(logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(logPath, line, 'utf8');
      break;
    } catch {
      // Continue to next fallback target
    }
  }
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
    this.sessions = new Map(); // token -> { username, fingerprint, createdAt, lastActive, expiresAt }
    this.failedLogins = new Map(); // ip -> { count, lockedUntil, lastFail }
    this.userFailures = new Map(); // username -> { count, lockedUntil, lastFail }
    this.bannedIps = new Map(); // ip -> bannedUntil (24 jam)
    this.usedNonces = new Set(); // set of used nonces
    this.pending2Fa = new Map(); // twoFaToken -> { username, otp, expiresAt, attempts, ip, userAgent }
    this.lastOtpResend = new Map(); // ip -> timestamp

    this.tokenSecret = crypto.randomBytes(32).toString('hex'); // Ephemeral secret per runtime
    this.sessionTimeoutMs = 2 * 60 * 60 * 1000; // 2 jam inactivity timeout
    
    this.globalLimiter = new RateLimiter(60 * 1000, 120); // Max 120 req/menit per IP
    this.loginLimiter = new RateLimiter(3 * 60 * 1000, 6); // Max 6 percobaan login per 3 menit
    this.verify2FaLimiter = new RateLimiter(3 * 60 * 1000, 8); // Max 8 verifikasi OTP per 3 menit
    this.testWaLimiter = new RateLimiter(60 * 1000, 5); // Max 5 tes WA/menit
    this.botPairLimiter = new RateLimiter(5 * 60 * 1000, 5); // Max 5 pairing req/5 menit
    this.contactsWriteLimiter = new RateLimiter(60 * 1000, 30); // Max 30 modifikasi kontak/menit
    this.pinChangeLimiter = new RateLimiter(10 * 60 * 1000, 5); // Max 5 ganti PIN per 10 menit

    setInterval(() => this.periodicCleanup(), 5 * 60 * 1000).unref();
  }

  periodicCleanup() {
    const now = Date.now();
    for (const [token, sess] of this.sessions.entries()) {
      if (now > sess.expiresAt) this.sessions.delete(token);
    }
    for (const [twoFaId, item] of this.pending2Fa.entries()) {
      if (now > item.expiresAt) this.pending2Fa.delete(twoFaId);
    }
    for (const [ip, until] of this.bannedIps.entries()) {
      if (now > until) this.bannedIps.delete(ip);
    }
    for (const [ip, info] of this.failedLogins.entries()) {
      if (now - (info.lastFail || 0) > 30 * 60 * 1000 && (!info.lockedUntil || now > info.lockedUntil)) {
        this.failedLogins.delete(ip);
      }
    }
    for (const [user, info] of this.userFailures.entries()) {
      if (now - (info.lastFail || 0) > 30 * 60 * 1000 && (!info.lockedUntil || now > info.lockedUntil)) {
        this.userFailures.delete(user);
      }
    }
    if (this.usedNonces.size > 20000) {
      this.usedNonces.clear();
    }
  }

  setSecurityHeaders(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self';");

    const proto = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : '');
    if (proto === 'https' || req.headers['cf-visitor']?.includes('https')) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
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

  getClientIp(req) {
    const rawRemote = req.socket?.remoteAddress || '';
    const socketRemote = String(rawRemote).replace(/^.*:/, '').trim();
    const isLoopback = socketRemote === '127.0.0.1' || socketRemote === '::1' || socketRemote === 'localhost' || socketRemote === '';

    // Hanya percaya header proxy jika koneksi fisik TCP benar-benar berasal dari localhost loopback (OpenLiteSpeed / Nginx)
    if (isLoopback) {
      // 1. Cloudflare Connecting IP
      const cfIp = req.headers['cf-connecting-ip'];
      if (cfIp && typeof cfIp === 'string' && cfIp.trim()) {
        return cfIp.trim().replace(/^.*:/, '');
      }
      // 2. Standard Reverse Proxy X-Real-IP
      const realIp = req.headers['x-real-ip'];
      if (realIp && typeof realIp === 'string' && realIp.trim()) {
        return realIp.trim().replace(/^.*:/, '');
      }
      // 3. X-Forwarded-For
      const xff = req.headers['x-forwarded-for'];
      if (xff && typeof xff === 'string' && xff.trim()) {
        const parts = xff.split(',');
        if (parts.length > 0) return parts[0].trim().replace(/^.*:/, '');
      }
    }

    // Jika koneksi langsung dari internet ke port 5005 tanpa melalui proxy lokal, pakai socket IP langsung (tidak bisa dipalsukan)
    return socketRemote || 'unknown';
  }

  generateLoginCsrf(ip) {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(12).toString('hex');
    const hmac = crypto.createHmac('sha256', this.tokenSecret).update(`${timestamp}:${nonce}:${ip}`).digest('hex');
    return Buffer.from(`${timestamp}:${nonce}:${hmac}`).toString('base64');
  }

  verifyLoginCsrf(token, ip) {
    if (!token || typeof token !== 'string') return { valid: false, reason: 'Token keamanan kosong atau tidak ada' };
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const [tsStr, nonce, sig] = decoded.split(':');
      if (!tsStr || !nonce || !sig) return { valid: false, reason: 'Format token keamanan rusak' };

      const timestamp = parseInt(tsStr, 10);
      if (isNaN(timestamp)) return { valid: false, reason: 'Timestamp token tidak valid' };

      const expectedHmac = crypto.createHmac('sha256', this.tokenSecret).update(`${timestamp}:${nonce}:${ip}`).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
        return { valid: false, reason: 'Tanda tangan kriptografi token tidak cocok' };
      }

      const now = Date.now();
      const elapsed = now - timestamp;
      // Bot detection: Kecepatan pengisian di bawah 700ms (tidak wajar untuk interaksi manusia)
      if (elapsed < 700) {
        return { valid: false, isBotSpeed: true, elapsed, reason: `Pengiriman terlalu cepat (${elapsed}ms). Script otomatis/bot terdeteksi.` };
      }

      // Token kedaluwarsa setelah 15 menit
      if (elapsed > 15 * 60 * 1000) {
        return { valid: false, isExpired: true, reason: 'Halaman login telah kedaluwarsa (lebih dari 15 menit). Silakan refresh.' };
      }

      // Replay attack prevention: Nonce hanya boleh digunakan 1 kali
      if (this.usedNonces.has(nonce)) {
        return { valid: false, reason: 'Percobaan pengulangan token (Replay attack dicegah).' };
      }
      this.usedNonces.add(nonce);

      return { valid: true };
    } catch (err) {
      return { valid: false, reason: 'Gagal memverifikasi token: ' + err.message };
    }
  }

  createSession(username, req, res) {
    const ip = this.getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    const fingerprint = crypto.createHash('sha256').update(`${ip}:${userAgent}`).digest('hex');
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    this.sessions.set(token, {
      username,
      fingerprint,
      createdAt: now,
      lastActive: now,
      expiresAt: now + this.sessionTimeoutMs
    });

    const isHttps = (req.headers['x-forwarded-proto'] === 'https') || (req.headers['cf-visitor']?.includes('https')) || !!req.socket?.encrypted;
    const cookieFlags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${isHttps ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', `secops_session=${token}; ${cookieFlags}`);
    return token;
  }

  getSession(req) {
    const cookies = this.parseCookies(req);
    const token = cookies.secops_session;
    if (!token) return null;

    const session = this.sessions.get(token);
    if (!session) return null;

    const now = Date.now();
    if (now > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }

    // Session Fingerprint Anti-Hijacking Check
    const ip = this.getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    const currentFingerprint = crypto.createHash('sha256').update(`${ip}:${userAgent}`).digest('hex');

    if (session.fingerprint && session.fingerprint !== currentFingerprint) {
      this.sessions.delete(token);
      logAuthEvent('SESSION_HIJACK', ip, session.username, 'Session IP/User-Agent fingerprint mismatch');
      console.warn(`[🚨 SESSION HIJACKING BLOCKED] Token ${token.substring(0,8)}... dicoba dipakai dari IP ${ip} yang tidak cocok dengan sesi asli!`);
      return null;
    }

    session.lastActive = now;
    session.expiresAt = now + this.sessionTimeoutMs;
    return session;
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
          const err = new Error('Payload melebihi batas ukuran maksimal.');
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

    // 0.1 Proteksi Akses Langsung IP & Enforce Domain HTTPS
    const host = (req.headers.host || '').toLowerCase();
    const isLoopback = host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]');
    const isDirectIpAccess = !isLoopback && /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(host);
    if (isDirectIpAccess && (url === '/' || url === '/login' || url === '/dashboard' || url === '/qr')) {
      res.writeHead(301, { Location: `https://pentest.portal-egn.com${url}` });
      res.end();
      return true;
    }

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
      this.renderLoginPage(res, req);
      return true;
    }

    if (url === '/api/login' && method === 'POST') {
      await this.handleApiLogin(req, res, waClient);
      return true;
    }

    if (url === '/api/login/verify-2fa' && method === 'POST') {
      await this.handleApiVerify2Fa(req, res, waClient);
      return true;
    }

    if (url === '/api/login/resend-2fa' && method === 'POST') {
      await this.handleApiResend2Fa(req, res, waClient);
      return true;
    }

    if (url === '/api/logout') {
      this.handleApiLogout(req, res);
      return true;
    }

    if (url === '/' && (method === 'GET' || method === 'HEAD')) {
      if (!waClient.isConnected && waClient.currentQrDataUrl) {
        this.renderQrPage(res, waClient);
        return true;
      }
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

      // 3.1 API Modul Manajemen Security PIN
      if (url === '/api/security/pin' && method === 'POST') {
        const rateKey = session?.username || clientIp;
        if (this.pinChangeLimiter.isLimited(rateKey)) {
          const waitSec = this.pinChangeLimiter.getResetTime(rateKey);
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `Terlalu banyak permintaan perubahan PIN. Coba lagi dalam ${waitSec || 60} detik.` }));
          return true;
        }
        await this.handleApiChangePin(req, res, session, clientIp, waClient);
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

    return false;
  }

  async handleApiLogin(req, res, waClient) {
    const ip = this.getClientIp(req);
    const now = Date.now();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    // 1. Cek apakah IP dibanned permanen/24 jam
    const bannedUntil = this.bannedIps.get(ip);
    if (bannedUntil && bannedUntil > now) {
      const waitHours = Math.ceil((bannedUntil - now) / (60 * 60 * 1000));
      logAuthEvent('BLOCKED_BANNED_IP', ip, 'unknown', 'Access attempted from banned IP');
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: `Alamat IP Anda (${ip}) telah DIBLOKIR selama ${waitHours} jam karena terdeteksi aktivitas mencurigakan/bot.`
      }));
    }

    // 2. Cek apakah IP dalam masa penguncian brute force
    const failInfo = this.failedLogins.get(ip);
    if (failInfo && failInfo.lockedUntil > now) {
      const waitSec = Math.ceil((failInfo.lockedUntil - now) / 1000);
      logAuthEvent('BLOCKED_LOCKED_IP', ip, 'unknown', `IP locked for ${waitSec}s`);
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(waitSec) });
      return res.end(JSON.stringify({
        success: false,
        error: `Terlalu banyak percobaan login gagal. Akses IP Anda dikunci sementara selama ${waitSec} detik.`
      }));
    }

    // 3. Cek Rate Limiting Percobaan Login (Max 6 req/3 menit)
    if (this.loginLimiter.isLimited(ip)) {
      const waitSec = this.loginLimiter.getResetTime(ip);
      logAuthEvent('RATE_LIMITED', ip, 'unknown', `Login rate limit exceeded (${waitSec}s)`);
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(waitSec || 60) });
      return res.end(JSON.stringify({
        success: false,
        error: `Terlalu banyak request login. Silakan tunggu ${waitSec || 60} detik sebelum mencoba kembali.`
      }));
    }

    // 4. Baca Body dengan batasan payload ketat (Max 64KB)
    let body = {};
    try {
      body = await this.readBody(req, 65536);
    } catch {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Ukuran payload melebihi batas aman.' }));
    }

    const username = String(body.username || '').trim();
    const password = String(body.password || '').trim();
    const secToken = String(body._sec_token || '').trim();
    const hpWebsite = String(body._hp_website || '').trim();
    const hpSecCode = String(body._hp_sec_code || '').trim();

    // 5. HONEYPOT BOT DETECTION (Jika bot otomatis mengisi input tersembunyi)
    if (hpWebsite !== '' || hpSecCode !== '') {
      this.bannedIps.set(ip, now + (24 * 60 * 60 * 1000)); // Ban 24 jam langsung
      logAuthEvent('BOT_HONEYPOT', ip, username, 'Honeypot field triggered by automated bot/crawler');
      console.warn(`[🚨 BOT TRAP TRIGGERED] IP ${ip} mengisi field jebakan (honeypot). IP diblokir 24 jam.`);
      
      if (waClient && waClient.isConnected) {
        waClient.broadcastToAdmins(
`🚨 *PERINGATAN ANCAMAN: BOT OTOMATIS DITANGKAP!* 🚨
-----------------------------------------
• *Tipe Serangan:* Automated Bot / Login Crawler
• *IP Penyerang:* \`${ip}\`
• *Target Akun:* ${username || 'none'}
• *Tindakan Sistem:* IP DIBLOKIR 24 JAM & Dimasukkan ke Log Firewall Fail2ban.
-----------------------------------------
Waktu Deteksi: ${new Date().toLocaleString('id-ID')}`
        );
      }

      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: 'Akses ditolak: Aktivitas bot / otomatisasi terdeteksi.'
      }));
    }

    // 6. CRYPTOGRAPHIC CSRF & TIMING ANTI-BOT VERIFICATION
    const tokenCheck = this.verifyLoginCsrf(secToken, ip);
    if (!tokenCheck.valid) {
      logAuthEvent('BOT_TOKEN_INVALID', ip, username, tokenCheck.reason);
      if (tokenCheck.isBotSpeed) {
        await new Promise(r => setTimeout(r, 2000));
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: 'Aktivitas pengisian form tidak wajar (terlalu cepat). Mohon tunggu sebentar lalu coba lagi.'
        }));
      }
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: tokenCheck.reason || 'Token keamanan form tidak valid. Silakan muat ulang halaman.'
      }));
    }

    // 7. Cek Proteksi Brute-Force Berdasarkan Akun (Distributed Brute Force Prevention)
    const userFailInfo = this.userFailures.get(username);
    if (userFailInfo && userFailInfo.lockedUntil > now) {
      const waitSec = Math.ceil((userFailInfo.lockedUntil - now) / 1000);
      logAuthEvent('BLOCKED_ACCOUNT_LOCKED', ip, username, 'Account locked due to distributed attacks');
      res.writeHead(423, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: `Akun "${username}" sedang dikunci sementara (${waitSec} detik) demi keamanan karena terdeteksi upaya peretasan berulang dari berbagai IP.`
      }));
    }

    // 8. Verifikasi Kredensial (Timing-Safe Comparison)
    const expectedUser = String(config.dashboardUser || 'admin');
    const expectedPass = String(config.dashboardPass || config.securityPin || '465157');
    const expectedPin = String(config.securityPin || '465157');

    const userValid = safeCompare(username, expectedUser);
    const passValid = safeCompare(password, expectedPass) || safeCompare(password, expectedPin);

    if (userValid && passValid) {
      this.failedLogins.delete(ip);
      this.userFailures.delete(username);

      const is2FaRequired = (config.dashboard2Fa !== false);

      if (is2FaRequired) {
        const otp = String(crypto.randomInt(100000, 999999));
        const twoFaToken = crypto.randomBytes(32).toString('hex');
        const cleanUa = (req.headers['user-agent'] || 'Browser Web').substring(0, 60);

        const otpMessage = 
`🔐 *KODE VERIFIKASI 2FA - SECOPS PORTAL* 🔐
-----------------------------------------
Kode OTP Rahasia: *${otp}*

• *Tujuan:* Login ke Dashboard Urgensi
• *Pengguna:* *${username}*
• *IP Pengakses:* \`${ip}\`
• *Perangkat:* ${cleanUa}
• *Masa Berlaku:* 3 Menit
-----------------------------------------
⚠️ *JANGAN PERNAH MEMBERIKAN KODE INI KEPADA SIAPA PUN!*
Jika Anda tidak merasa melakukan login, kemungkinan password Anda bocor dan penyerang sedang tertahan di gerbang 2FA ini.`;

        const requestedChannel = String(body.channel || body.otpChannel || 'wa').trim().toLowerCase();
        const targetChannel = (requestedChannel === 'email' || requestedChannel === 'wa') ? requestedChannel : 'wa';

        if (targetChannel === 'email') {
          let emailSent = false;
          let mailError = null;
          try {
            await mailer.send2FaOtpEmail({
              to: config.adminEmail || 'agraphylearn@gmail.com',
              otp,
              username,
              ip,
              userAgent: req.headers['user-agent']
            });
            emailSent = true;
            logAuthEvent('2FA_SENT_EMAIL', ip, username, `Email 2FA OTP dispatched to ${config.adminEmail || 'agraphylearn@gmail.com'}`);
          } catch (err) {
            mailError = err.message;
            logAuthEvent('2FA_EMAIL_FAILED', ip, username, `Failed to send email OTP: ${err.message}`);
          }

          if (emailSent) {
            this.pending2Fa.set(twoFaToken, {
              username,
              otp,
              channel: 'email',
              expiresAt: now + (3 * 60 * 1000),
              attempts: 0,
              ip,
              userAgent: req.headers['user-agent'] || 'unknown'
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              success: true,
              require2FA: true,
              twoFaToken,
              channel: 'email',
              targetInfo: config.adminEmail || 'agraphylearn@gmail.com',
              message: `Kredensial valid. Kode OTP 6-digit telah dikirimkan ke Email: ${config.adminEmail || 'agraphylearn@gmail.com'}`
            }));
          }

          // Fallback to WhatsApp if available
          if (waClient && waClient.isConnected) {
            await waClient.broadcastToAdmins(otpMessage);
            this.pending2Fa.set(twoFaToken, {
              username,
              otp,
              channel: 'wa',
              expiresAt: now + (3 * 60 * 1000),
              attempts: 0,
              ip,
              userAgent: req.headers['user-agent'] || 'unknown'
            });
            logAuthEvent('2FA_SENT_FALLBACK_WA', ip, username, 'Email failed, fell back to WhatsApp');

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              success: true,
              require2FA: true,
              twoFaToken,
              channel: 'wa',
              targetInfo: 'WhatsApp Administrator',
              message: `Pengiriman email terkendala (${mailError}). Kode OTP otomatis dialihkan ke WhatsApp resmi Admin.`
            }));
          }

          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            error: `Gagal mengirimkan kode OTP ke Email: ${mailError}. Pastikan konfigurasi SMTP di file .env sudah diisi atau pilih WhatsApp.`
          }));
        }

        // Default Channel: WhatsApp
        if (waClient && waClient.isConnected) {
          await waClient.broadcastToAdmins(otpMessage);
          this.pending2Fa.set(twoFaToken, {
            username,
            otp,
            channel: 'wa',
            expiresAt: now + (3 * 60 * 1000),
            attempts: 0,
            ip,
            userAgent: req.headers['user-agent'] || 'unknown'
          });
          logAuthEvent('2FA_SENT_WA', ip, username, 'WhatsApp 2FA OTP dispatched to admins');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            require2FA: true,
            twoFaToken,
            channel: 'wa',
            targetInfo: 'WhatsApp Administrator',
            message: 'Kredensial valid. Kode OTP 6-digit telah dikirimkan ke WhatsApp resmi Administrator.'
          }));
        }

        // WhatsApp Offline -> Fallback to Email
        try {
          await mailer.send2FaOtpEmail({
            to: config.adminEmail || 'agraphylearn@gmail.com',
            otp,
            username,
            ip,
            userAgent: req.headers['user-agent']
          });
          this.pending2Fa.set(twoFaToken, {
            username,
            otp,
            channel: 'email',
            expiresAt: now + (3 * 60 * 1000),
            attempts: 0,
            ip,
            userAgent: req.headers['user-agent'] || 'unknown'
          });
          logAuthEvent('2FA_SENT_FALLBACK_EMAIL', ip, username, 'WhatsApp offline, fell back to Email');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            require2FA: true,
            twoFaToken,
            channel: 'email',
            targetInfo: config.adminEmail || 'agraphylearn@gmail.com',
            message: `Gateway WhatsApp sedang offline. Kode OTP otomatis dikirimkan ke Email: ${config.adminEmail || 'agraphylearn@gmail.com'}`
          }));
        } catch (mailErr) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            error: `Gateway WhatsApp sedang offline dan pengiriman email gagal (${mailErr.message}).`
          }));
        }
      }

      this.createSession(username, req, res);
      logAuthEvent('LOGIN_SUCCESS', ip, username, 'Direct login authenticated (2FA disabled)');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, require2FA: false, message: 'Login berhasil!' }));

    } else {
      const currentFails = (failInfo ? failInfo.count : 0) + 1;
      let lockedUntil = 0;
      let isSevere = false;

      if (currentFails >= 5) {
        lockedUntil = now + (24 * 60 * 60 * 1000);
        isSevere = true;
      } else if (currentFails >= 3) {
        lockedUntil = now + (15 * 60 * 1000);
      }

      this.failedLogins.set(ip, { count: currentFails, lockedUntil, lastFail: now });

      const uFails = (userFailInfo ? userFailInfo.count : 0) + 1;
      let uLockedUntil = 0;
      if (uFails >= 8) {
        uLockedUntil = now + (15 * 60 * 1000);
        console.warn(`[🚨 DISTRIBUTED BRUTE FORCE] Akun "${username}" diserang 8x. Mengunci akun 15 menit.`);
        if (waClient && waClient.isConnected) {
          waClient.broadcastToAdmins(
`🚨 *ALERT: INDIKASI SERANGAN BRUTE-FORCE TERDISTRIBUSI!* 🚨
-----------------------------------------
Terdeteksi 8x percobaan login salah berturut-turut pada akun *${username}* dari satu atau beberapa IP.
Demi keamanan, login untuk akun ini dikunci selama 15 menit.`
          );
        }
      }
      this.userFailures.set(username, { count: uFails, lockedUntil: uLockedUntil, lastFail: now });

      logAuthEvent('AUTH_FAIL', ip, username, `Invalid credentials attempt ${currentFails}/5`);

      if (currentFails >= 3 && waClient && waClient.isConnected) {
        waClient.broadcastToAdmins(
`⚠️ *PERINGATAN KEAMANAN: PERCOBAAN LOGIN GAGAL BERULANG* ⚠️
-----------------------------------------
• *IP Sumber:* \`${ip}\`
• *Target Akun:* *${username || 'admin'}*
• *Jumlah Percobaan:* ${currentFails} kali gagal
• *Status IP:* ${lockedUntil > 0 ? (isSevere ? '🚫 DIKUNCI 24 JAM' : '⏳ DIKUNCI 15 MENIT') : 'Memasuki batas kritis'}
-----------------------------------------
Sistem mencatat percobaan ini untuk blokir firewall Fail2ban.`
        );
      }

      const delayMs = Math.min(1000 * Math.pow(1.5, Math.max(0, currentFails - 1)), 4500);
      await new Promise(r => setTimeout(r, delayMs));

      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: 'Username atau Password/PIN salah!' + 
          (isSevere ? ' IP Anda telah DIBLOKIR 24 jam.' : (lockedUntil > 0 ? ' IP Anda dikunci selama 15 menit.' : ` (${currentFails}/5 percobaan)`))
      }));
    }
  }

  async handleApiVerify2Fa(req, res, waClient) {
    const ip = this.getClientIp(req);
    const now = Date.now();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    if (this.verify2FaLimiter.isLimited(ip)) {
      const waitSec = this.verify2FaLimiter.getResetTime(ip);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: `Terlalu banyak percobaan verifikasi OTP. Tunggu ${waitSec || 30} detik.` }));
    }

    let body = {};
    try {
      body = await this.readBody(req, 16384);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Payload tidak valid.' }));
    }

    const twoFaToken = String(body.twoFaToken || '').trim();
    const otp = String(body.otp || '').trim().replace(/[^0-9]/g, '');

    const pending = this.pending2Fa.get(twoFaToken);
    if (!pending) {
      logAuthEvent('2FA_INVALID_TOKEN', ip, 'unknown', 'Token 2FA tidak ditemukan atau telah kedaluwarsa');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Sesi verifikasi OTP tidak ditemukan atau telah kedaluwarsa. Silakan login kembali.' }));
    }

    if (now > pending.expiresAt) {
      this.pending2Fa.delete(twoFaToken);
      logAuthEvent('2FA_EXPIRED', ip, pending.username, 'Kode OTP kedaluwarsa');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Kode OTP telah kedaluwarsa (lebih dari 3 menit). Silakan klik Kirim Ulang OTP.' }));
    }

    pending.attempts = (pending.attempts || 0) + 1;
    if (pending.attempts > 3) {
      this.pending2Fa.delete(twoFaToken);
      logAuthEvent('2FA_MAX_ATTEMPTS', ip, pending.username, 'Batas percobaan tebak OTP terlampaui');
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Batas percobaan OTP terlampaui (maks 3x). Silakan ulangi proses login dari awal.' }));
    }

    const isOtpValid = safeCompare(otp, pending.otp);

    if (isOtpValid) {
      this.pending2Fa.delete(twoFaToken);
      this.createSession(pending.username, req, res);
      logAuthEvent('2FA_SUCCESS', ip, pending.username, '2FA OTP verified successfully');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Verifikasi 2FA berhasil! Mengalihkan ke Dashboard...' }));
    } else {
      logAuthEvent('2FA_FAIL', ip, pending.username, `Salah memasukkan kode OTP (percobaan ${pending.attempts}/3)`);
      await new Promise(r => setTimeout(r, 1200));
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: `Kode OTP yang Anda masukkan salah! (${pending.attempts}/3 percobaan)`
      }));
    }
  }

  async handleApiResend2Fa(req, res, waClient) {
    const ip = this.getClientIp(req);
    const now = Date.now();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const lastResend = this.lastOtpResend.get(ip) || 0;
    if (now - lastResend < 15 * 1000) {
      const waitSec = Math.ceil((15 * 1000 - (now - lastResend)) / 1000);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: `Mohon tunggu ${waitSec} detik sebelum meminta kode OTP baru.` }));
    }

    let body = {};
    try {
      body = await this.readBody(req, 16384);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Payload tidak valid.' }));
    }

    const twoFaToken = String(body.twoFaToken || '').trim();
    const pending = this.pending2Fa.get(twoFaToken);
    if (!pending) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Sesi OTP tidak valid. Silakan login kembali.' }));
    }

    const reqChannel = String(body.channel || '').trim().toLowerCase();
    const channel = (reqChannel === 'email' || reqChannel === 'wa') ? reqChannel : (pending.channel || 'wa');

    const newOtp = String(crypto.randomInt(100000, 999999));
    const cleanUa = (req.headers['user-agent'] || 'Browser Web').substring(0, 60);

    if (channel === 'email') {
      try {
        await mailer.send2FaOtpEmail({
          to: config.adminEmail || 'agraphylearn@gmail.com',
          otp: newOtp,
          username: pending.username,
          ip,
          userAgent: req.headers['user-agent']
        });

        pending.otp = newOtp;
        pending.channel = 'email';
        pending.expiresAt = now + (3 * 60 * 1000);
        pending.attempts = 0;
        this.lastOtpResend.set(ip, now);

        logAuthEvent('2FA_RESENT_EMAIL', ip, pending.username, `New Email 2FA OTP re-dispatched to ${config.adminEmail || 'agraphylearn@gmail.com'}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          channel: 'email',
          targetInfo: config.adminEmail || 'agraphylearn@gmail.com',
          message: `Kode OTP baru telah dikirimkan ke Email: ${config.adminEmail || 'agraphylearn@gmail.com'}`
        }));
      } catch (err) {
        logAuthEvent('2FA_RESENT_EMAIL_ERROR', ip, pending.username, `Failed to resend email: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: `Gagal mengirim email: ${err.message}. Silakan gunakan opsi WhatsApp.`
        }));
      }
    } else {
      // WhatsApp
      if (!waClient || !waClient.isConnected) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: 'Gateway WhatsApp sedang tidak terhubung. Silakan klik "Kirim via Email".'
        }));
      }

      const otpMessage = 
`🔐 *KODE VERIFIKASI 2FA BARU - SECOPS PORTAL* 🔐
-----------------------------------------
Kode OTP Baru: *${newOtp}*

• *Pengguna:* *${pending.username}*
• *IP Pengakses:* \`${ip}\`
• *Perangkat:* ${cleanUa}
• *Masa Berlaku:* 3 Menit
-----------------------------------------
⚠️ *JANGAN PERNAH MEMBERIKAN KODE INI KEPADA SIAPA PUN!*`;

      await waClient.broadcastToAdmins(otpMessage);

      pending.otp = newOtp;
      pending.channel = 'wa';
      pending.expiresAt = now + (3 * 60 * 1000);
      pending.attempts = 0;
      this.lastOtpResend.set(ip, now);

      logAuthEvent('2FA_RESENT_WA', ip, pending.username, 'New WhatsApp 2FA OTP re-dispatched');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        channel: 'wa',
        targetInfo: 'WhatsApp Administrator',
        message: 'Kode OTP baru telah dikirimkan ke WhatsApp resmi Administrator.'
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

• *Server Koordinator:* ${config.nodeName} (${config.nodeId})
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
      const jid = waClient.normalizeJid ? waClient.normalizeJid(contact.number) : `${contact.number}@s.whatsapp.net`;
      const sent = await waClient.sock.sendMessage(jid, { text: cleanMessage });
      if (waClient.storeMessage && sent?.key?.id && sent?.message) {
        waClient.storeMessage(sent.key.id, sent.message);
      }
      contactsManager.updateLastAlert(contact.number);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: `Pesan uji coba berhasil dikirim ke ${contact.name} (${contact.number})!` }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: `Gagal mengirim pesan WhatsApp: ${err.message}` }));
    }
  }

  async handleApiChangePin(req, res, session, clientIp, waClient) {
    if (!session || !session.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Akses tidak sah. Silakan login kembali.' }));
    }

    let body = {};
    try {
      body = await this.readBody(req);
    } catch (err) {
      if (err.statusCode === 413) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Ukuran payload melebihi batas (1MB).' }));
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Format JSON payload tidak valid.' }));
    }

    const currentPin = String(body.currentPin || '').trim();
    const newPin = String(body.newPin || '').trim();
    const confirmPin = String(body.confirmPin || '').trim();

    // 1. Verifikasi PIN lama menggunakan timing-safe comparison
    if (!safeCompare(currentPin, String(config.securityPin || ''))) {
      logAuthEvent('PIN_CHANGE_FAILED', clientIp, session.username, 'Current PIN mismatch');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'PIN keamanan saat ini salah.' }));
    }

    // 2. Validasi format PIN baru (4-8 digit numerik)
    if (!/^[0-9]{4,8}$/.test(newPin)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'PIN baru harus terdiri dari 4 hingga 8 digit angka numerik.' }));
    }

    // 3. Validasi konfirmasi PIN
    if (newPin !== confirmPin) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Konfirmasi PIN baru tidak sesuai.' }));
    }

    // 4. Pastikan PIN baru berbeda dari PIN saat ini
    if (safeCompare(newPin, String(config.securityPin || ''))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'PIN baru tidak boleh sama dengan PIN keamanan saat ini.' }));
    }

    // 5. Update konfigurasi in-memory & environment variables
    config.securityPin = newPin;
    config.dashboardPass = newPin;
    process.env.SECURITY_PIN = newPin;
    process.env.DASHBOARD_PASS = newPin;

    // 6. Update file .env secara persisten di disk
    this.updateEnvPin(newPin);

    // 7. Reset sesi aktif WhatsApp bot (force re-authorization)
    if (waClient) {
      if (waClient.adminSessions && typeof waClient.adminSessions.clear === 'function') {
        waClient.adminSessions.clear();
      }
      if (waClient.pendingActions && typeof waClient.pendingActions.clear === 'function') {
        waClient.pendingActions.clear();
      }
      if (waClient.pendingCommands && typeof waClient.pendingCommands.clear === 'function') {
        waClient.pendingCommands.clear();
      }
    }

    // 8. Sinkronisasi perubahan PIN ke seluruh cluster nodes
    let clusterSync = [];
    if (cluster && typeof cluster.broadcastPinUpdate === 'function') {
      try {
        clusterSync = await cluster.broadcastPinUpdate(newPin);
      } catch (err) {
        console.error('[WebPortal] Gagal broadcast sinkronisasi PIN ke cluster:', err.message);
      }
    }

    // 9. Kirim broadcast alert darurat via WhatsApp ke admin
    if (waClient && waClient.sock && waClient.isConnected) {
      const alertMsg = 
`🔐 *PERINGATAN KEAMANAN: PIN SISTEM TELAH DIUBAH* 🔐
-----------------------------------------
• *Waktu:* ${new Date().toLocaleString('id-ID')}
• *Diubah oleh:* Admin Web Portal (${session.username})
• *IP Pelaku:* ${clientIp}
• *Sesi Bot:* Seluruh sesi bot aktif telah direset demi keamanan.
• *Cluster:* ${clusterSync.length > 0 ? 'Tersinkronisasi ke armada node' : 'Node lokal'}
-----------------------------------------
_Jika bukan Anda yang melakukan ini, segera amankan server Anda!_`;

      const sentAdmins = new Set();
      for (const adminNum of config.adminNumbers) {
        const clean = adminNum.replace(/[^0-9]/g, '');
        if (clean && !sentAdmins.has(clean)) {
          sentAdmins.add(clean);
          try {
            const jid = waClient.normalizeJid ? waClient.normalizeJid(clean) : `${clean}@s.whatsapp.net`;
            const sent = await waClient.sock.sendMessage(jid, { text: alertMsg });
            if (waClient.storeMessage && sent?.key?.id && sent?.message) {
              waClient.storeMessage(sent.key.id, sent.message);
            }
          } catch (e) {}
        }
      }
    }

    // 10. Audit log
    logAuthEvent('PIN_CHANGED', clientIp, session.username, 'Security PIN updated and synced to cluster');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ 
      success: true, 
      message: 'PIN Keamanan berhasil diubah dan disinkronkan ke seluruh sistem!',
      clusterSync
    }));
  }

  updateEnvPin(newPin) {
    try {
      const envPath = path.join(__dirname, '..', '.env');
      if (!fs.existsSync(envPath)) {
        fs.writeFileSync(envPath, `SECURITY_PIN=${newPin}\nDASHBOARD_PASS=${newPin}\n`, 'utf8');
        return;
      }
      let content = fs.readFileSync(envPath, 'utf8');
      if (/^SECURITY_PIN=/m.test(content)) {
        content = content.replace(/^SECURITY_PIN=.*/m, `SECURITY_PIN=${newPin}`);
      } else {
        content += `\nSECURITY_PIN=${newPin}`;
      }
      if (/^DASHBOARD_PASS=/m.test(content)) {
        content = content.replace(/^DASHBOARD_PASS=.*/m, `DASHBOARD_PASS=${newPin}`);
      } else {
        content += `\nDASHBOARD_PASS=${newPin}`;
      }
      fs.writeFileSync(envPath, content, 'utf8');
      console.log(`[🔐 WebPortal] File .env berhasil diperbarui dengan PIN baru.`);
    } catch (err) {
      console.error('[WebPortal] Gagal menulis update PIN ke .env:', err.message);
    }
  }

  renderLoginPage(res, req) {
    const clientIp = this.getClientIp(req);
    const csrfToken = this.generateLoginCsrf(clientIp);

    res.writeHead(200, { 
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private'
    });
    res.end(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login SecOps Emergency Portal - Zero Trust Shield</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { 
      background: radial-gradient(circle at 50% 20%, #1e1b4b 0%, #0b0f19 75%);
      color: #f1f5f9; 
      min-height: 100vh; 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      padding: 20px; 
    }
    .card { 
      background: rgba(30, 41, 59, 0.75); 
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.1); 
      border-radius: 20px; 
      padding: 40px; 
      width: 100%; 
      max-width: 440px; 
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(16, 185, 129, 0.15); 
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 3px;
      background: linear-gradient(90deg, #10b981, #3b82f6, #8b5cf6, #10b981);
      background-size: 300% 100%;
      animation: gradientBorder 4s linear infinite;
    }
    @keyframes gradientBorder {
      0% { background-position: 0% 0%; }
      100% { background-position: 300% 0%; }
    }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo-icon { 
      font-size: 52px; 
      filter: drop-shadow(0 0 20px rgba(16, 185, 129, 0.5)); 
      display: inline-block; 
      margin-bottom: 8px; 
    }
    .title { font-size: 22px; font-weight: 800; color: #f8fafc; letter-spacing: -0.5px; }
    .subtitle { font-size: 13px; color: #94a3b8; margin-top: 4px; }
    .badge-sec {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      color: #34d399;
      margin-top: 10px;
    }
    .form-group { margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
    input[type="text"], input[type="password"] { 
      width: 100%; 
      padding: 13px 15px; 
      background: #0f172a; 
      border: 1px solid #334155; 
      border-radius: 10px; 
      color: #fff; 
      font-size: 14px; 
      transition: all 0.2s; 
    }
    input:focus { 
      outline: none; 
      border-color: #10b981; 
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25); 
      background: #0b1329;
    }
    .btn { 
      width: 100%; 
      padding: 13px; 
      background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
      color: #fff; 
      border: none; 
      border-radius: 10px; 
      font-size: 15px; 
      font-weight: 700; 
      cursor: pointer; 
      transition: all 0.2s; 
      margin-top: 8px; 
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    }
    .btn:hover { opacity: 0.95; transform: translateY(-1px); box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4); }
    .btn:active { transform: translateY(1px); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
    .btn-secondary {
      background: transparent;
      border: 1px solid #475569;
      color: #cbd5e1;
      box-shadow: none;
      margin-top: 8px;
    }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.05); color: #fff; box-shadow: none; }
    .alert { padding: 13px; border-radius: 10px; font-size: 13px; margin-bottom: 18px; display: none; line-height: 1.4; }
    .alert-error { background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5; }
    .alert-info { background: rgba(59, 130, 246, 0.15); border: 1px solid #3b82f6; color: #93c5fd; }
    .otp-input {
      letter-spacing: 12px;
      font-size: 26px !important;
      text-align: center;
      font-weight: 800;
      font-family: monospace;
      color: #34d399 !important;
    }
    .timer-box {
      text-align: center;
      font-size: 12px;
      color: #94a3b8;
      margin: 12px 0 6px 0;
    }
    .timer-countdown { font-weight: 700; color: #fbbf24; }
    .step-box { display: none; }
    .step-active { display: block; }
    .hint { text-align: center; font-size: 11px; color: #64748b; margin-top: 24px; line-height: 1.5; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">🛡️</div>
      <h1 class="title">SecOps Emergency Portal</h1>
      <p class="subtitle">Gerbang Manajemen Notifikasi Urgensi Multi-Server</p>
      <div class="badge-sec">🔒 ZERO-TRUST MILITARY DEFENSE</div>
    </div>

    <div id="alertBox" class="alert"></div>

    <!-- STEP 1: KREDENSIAL UTAMA -->
    <div id="step1" class="step-box step-active">
      <form id="loginForm">
        <!-- Anti-Bot Honeypot Traps (Invisible to humans, filled by bots) -->
        <input type="text" name="_hp_website" id="hpWebsite" tabindex="-1" autocomplete="off" aria-hidden="true" style="opacity:0;position:absolute;top:0;left:0;height:0;width:0;z-index:-1;pointer-events:none;">
        <input type="text" name="_hp_sec_code" id="hpSecCode" tabindex="-1" autocomplete="off" aria-hidden="true" style="opacity:0;position:absolute;top:0;left:0;height:0;width:0;z-index:-1;pointer-events:none;">
        
        <!-- Cryptographic Anti-Replay & Timing CSRF Token -->
        <input type="hidden" name="_sec_token" id="secToken" value="${csrfToken}">

        <div class="form-group">
          <label for="username">Username Admin</label>
          <input type="text" id="username" name="username" placeholder="admin" required autofocus autocomplete="username">
        </div>
        <div class="form-group">
          <label for="password">Password / Security PIN</label>
          <input type="password" id="password" name="password" placeholder="Masukkan PIN / Password" required autocomplete="current-password">
        </div>

        <!-- PILIHAN KANAL VERIFIKASI 2FA OTP -->
        <div class="form-group" style="margin-top: 14px;">
          <label style="font-size: 13px; font-weight: 600; color: #94a3b8; margin-bottom: 8px; display: block;">Metode Pengiriman OTP 2FA:</label>
          <div style="display: flex; gap: 10px;">
            <label style="flex: 1; display: flex; align-items: center; gap: 8px; background: rgba(30, 41, 59, 0.7); border: 1px solid #334155; border-radius: 8px; padding: 10px; cursor: pointer; font-size: 13px; color: #f8fafc;">
              <input type="radio" name="otpChannel" value="wa" checked style="accent-color: #22c55e;">
              <span>📱 No. WhatsApp</span>
            </label>
            <label style="flex: 1; display: flex; align-items: center; gap: 8px; background: rgba(30, 41, 59, 0.7); border: 1px solid #334155; border-radius: 8px; padding: 10px; cursor: pointer; font-size: 13px; color: #f8fafc;">
              <input type="radio" name="otpChannel" value="email" style="accent-color: #38bdf8;">
              <span>📧 Email Admin</span>
            </label>
          </div>
          <small style="font-size: 11px; color: #64748b; margin-top: 6px; display: block;">Email tujuan: <code style="color: #38bdf8;">${escapeHtml(config.adminEmail || 'agraphylearn@gmail.com')}</code></small>
        </div>

        <button type="submit" id="submitBtn1" class="btn">Lanjutkan Verifikasi ➜</button>
      </form>
    </div>

    <!-- STEP 2: OTENTIKASI 2FA OTP -->
    <div id="step2" class="step-box">
      <form id="otpForm">
        <div style="text-align: center; margin-bottom: 16px;">
          <div id="step2Icon" style="font-size: 32px; margin-bottom: 6px;">🔐</div>
          <h3 id="step2Title" style="font-size: 16px; font-weight: 700; color: #f8fafc;">Verifikasi Otentikasi 2FA</h3>
          <p id="step2Desc" style="font-size: 12px; color: #94a3b8; margin-top: 4px;">
            Kode OTP 6-digit rahasia telah dikirimkan ke tujuan otentikasi Anda.
          </p>
          <div id="otpDestinationBadge" style="display: inline-block; margin-top: 8px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px; padding: 6px 12px; font-size: 12px; color: #38bdf8; font-weight: 600;">
            Kanal: Memuat...
          </div>
        </div>

        <div class="form-group">
          <label for="otpCode" style="text-align:center;">Masukkan 6 Digit Kode OTP</label>
          <input type="text" id="otpCode" class="otp-input" maxlength="6" inputmode="numeric" pattern="[0-9]*" placeholder="••••••" autocomplete="one-time-code" required>
        </div>

        <div class="timer-box">
          ⏳ Masa aktif kode: <span id="timerCountdown" class="timer-countdown">03:00</span>
        </div>

        <button type="submit" id="submitBtn2" class="btn">Verifikasi & Buka Dashboard 🛡️</button>

        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button type="button" id="resendWaBtn" class="btn btn-secondary" style="flex: 1; font-size: 12px; padding: 10px 4px;">📱 Kirim via WA</button>
          <button type="button" id="resendEmailBtn" class="btn btn-secondary" style="flex: 1; font-size: 12px; padding: 10px 4px;">📧 Kirim via Email</button>
        </div>

        <button type="button" id="backToStep1Btn" class="btn btn-secondary" style="font-size: 12px; padding: 8px; margin-top: 8px;">← Kembali ke Kredensial</button>
      </form>
    </div>

    <p class="hint">
      🛡️ Dilindungi oleh Cloudflare, Fail2ban Firewalld, Rate Limiter, Anti-Bot Honeypot, dan Enkripsi Zero-Trust 2FA. Seluruh percobaan ilegal dicatat dan diblokir secara permanen.
    </p>
  </div>

  <script>
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    const alertBox = document.getElementById('alertBox');
    const loginForm = document.getElementById('loginForm');
    const otpForm = document.getElementById('otpForm');
    const submitBtn1 = document.getElementById('submitBtn1');
    const submitBtn2 = document.getElementById('submitBtn2');
    const resendWaBtn = document.getElementById('resendWaBtn');
    const resendEmailBtn = document.getElementById('resendEmailBtn');
    const step2Icon = document.getElementById('step2Icon');
    const step2Title = document.getElementById('step2Title');
    const step2Desc = document.getElementById('step2Desc');
    const otpDestinationBadge = document.getElementById('otpDestinationBadge');
    const backToStep1Btn = document.getElementById('backToStep1Btn');
    const timerCountdown = document.getElementById('timerCountdown');

    let currentTwoFaToken = '';
    let currentChannel = 'wa';
    let otpExpiresAt = 0;
    let timerInterval = null;

    function showAlert(msg, isError = true) {
      alertBox.className = 'alert ' + (isError ? 'alert-error' : 'alert-info');
      alertBox.innerText = msg;
      alertBox.style.display = 'block';
    }

    function hideAlert() {
      alertBox.style.display = 'none';
    }

    function setChannelUI(channel, targetInfo) {
      currentChannel = channel;
      if (channel === 'email') {
        step2Icon.innerText = '📧';
        step2Title.innerText = 'Verifikasi 2FA Email';
        step2Desc.innerText = 'Kode OTP 6-digit telah dikirimkan ke Email Administrator.';
        otpDestinationBadge.innerText = '📧 Kanal: Email (' + (targetInfo || 'agraphylearn@gmail.com') + ')';
        otpDestinationBadge.style.color = '#38bdf8';
        otpDestinationBadge.style.borderColor = 'rgba(56, 189, 248, 0.4)';
        otpDestinationBadge.style.background = 'rgba(56, 189, 248, 0.1)';
      } else {
        step2Icon.innerText = '📲';
        step2Title.innerText = 'Verifikasi 2FA WhatsApp';
        step2Desc.innerText = 'Kode OTP 6-digit telah dikirimkan ke WhatsApp resmi Administrator.';
        otpDestinationBadge.innerText = '📱 Kanal: WhatsApp Administrator';
        otpDestinationBadge.style.color = '#22c55e';
        otpDestinationBadge.style.borderColor = 'rgba(34, 197, 94, 0.4)';
        otpDestinationBadge.style.background = 'rgba(34, 197, 94, 0.1)';
      }
    }

    function startOtpTimer(durationSeconds) {
      if (timerInterval) clearInterval(timerInterval);
      otpExpiresAt = Date.now() + (durationSeconds * 1000);
      updateTimerDisplay();

      timerInterval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000));
        updateTimerDisplay();
        if (remaining <= 0) {
          clearInterval(timerInterval);
          showAlert('Kode OTP telah kedaluwarsa. Silakan klik tombol kirim ulang OTP pilihan Anda.', true);
        }
      }, 1000);
    }

    function updateTimerDisplay() {
      const remaining = Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000));
      const min = Math.floor(remaining / 60);
      const sec = remaining % 60;
      timerCountdown.innerText = String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }

    // Step 1: Submit Username & Password
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();
      submitBtn1.disabled = true;
      submitBtn1.innerText = 'Memverifikasi Kredensial...';

      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value.trim();
      const _sec_token = document.getElementById('secToken').value;
      const _hp_website = document.getElementById('hpWebsite').value;
      const _hp_sec_code = document.getElementById('hpSecCode').value;
      const channelRadio = document.querySelector('input[name="otpChannel"]:checked');
      const channel = channelRadio ? channelRadio.value : 'wa';

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, channel, _sec_token, _hp_website, _hp_sec_code })
        });
        const data = await res.json();

        if (data.success) {
          if (data.require2FA) {
            // Berhasil step 1 -> Pindah ke Step 2 (2FA OTP)
            currentTwoFaToken = data.twoFaToken;
            setChannelUI(data.channel || channel, data.targetInfo);
            step1.classList.remove('step-active');
            step2.classList.add('step-active');
            showAlert(data.message || 'Kode OTP 6-digit telah dikirimkan.', false);
            startOtpTimer(180); // 3 menit
            document.getElementById('otpCode').value = '';
            document.getElementById('otpCode').focus();
          } else {
            // 2FA tidak aktif -> langsung masuk dashboard
            window.location.href = '/dashboard';
          }
        } else {
          showAlert(data.error || 'Login gagal!');
          submitBtn1.disabled = false;
          submitBtn1.innerText = 'Lanjutkan Verifikasi ➜';
        }
      } catch (err) {
        showAlert('Gagal terhubung ke server: ' + err.message);
        submitBtn1.disabled = false;
        submitBtn1.innerText = 'Lanjutkan Verifikasi ➜';
      }
    });

    // Step 2: Submit 2FA OTP
    otpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();
      const otp = document.getElementById('otpCode').value.replace(/[^0-9]/g, '');
      if (otp.length !== 6) {
        showAlert('Mohon masukkan 6 digit angka kode OTP yang valid.');
        return;
      }

      submitBtn2.disabled = true;
      submitBtn2.innerText = 'Memvalidasi OTP...';

      try {
        const res = await fetch('/api/login/verify-2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ twoFaToken: currentTwoFaToken, otp })
        });
        const data = await res.json();

        if (data.success) {
          if (timerInterval) clearInterval(timerInterval);
          showAlert(data.message || 'Verifikasi 2FA sukses! Mengalihkan...', false);
          setTimeout(() => {
            window.location.href = '/dashboard';
          }, 800);
        } else {
          showAlert(data.error || 'Kode OTP tidak cocok.');
          submitBtn2.disabled = false;
          submitBtn2.innerText = 'Verifikasi & Buka Dashboard 🛡️';
        }
      } catch (err) {
        showAlert('Gagal verifikasi OTP: ' + err.message);
        submitBtn2.disabled = false;
        submitBtn2.innerText = 'Verifikasi & Buka Dashboard 🛡️';
      }
    });

    // Kirim Ulang OTP Multi-Channel (WhatsApp / Email)
    async function resendOtp(channel) {
      hideAlert();
      const activeBtn = (channel === 'email') ? resendEmailBtn : resendWaBtn;
      const originalText = activeBtn.innerText;
      activeBtn.disabled = true;
      activeBtn.innerText = 'Mengirim...';

      try {
        const res = await fetch('/api/login/resend-2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ twoFaToken: currentTwoFaToken, channel })
        });
        const data = await res.json();

        if (data.success) {
          setChannelUI(data.channel || channel, data.targetInfo);
          showAlert(data.message || 'Kode OTP baru telah dikirimkan.', false);
          startOtpTimer(180);
        } else {
          showAlert(data.error || 'Gagal mengirim ulang OTP.');
        }
      } catch (err) {
        showAlert('Error: ' + err.message);
      } finally {
        setTimeout(() => {
          activeBtn.disabled = false;
          activeBtn.innerText = originalText;
        }, 12000);
      }
    }

    resendWaBtn.addEventListener('click', () => resendOtp('wa'));
    resendEmailBtn.addEventListener('click', () => resendOtp('email'));

    // Kembali ke Step 1
    backToStep1Btn.addEventListener('click', () => {
      if (timerInterval) clearInterval(timerInterval);
      hideAlert();
      step2.classList.remove('step-active');
      step1.classList.add('step-active');
      submitBtn1.disabled = false;
      submitBtn1.innerText = 'Lanjutkan Verifikasi ➜';
      document.getElementById('password').value = '';
      document.getElementById('password').focus();
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

        <!-- Kartu Manajemen Security PIN -->
        <div class="card" style="margin-bottom: 24px; border-left: 4px solid #f59e0b;">
          <h2 class="card-title">🔐 Manajemen Security PIN</h2>
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px;line-height:1.5;">
            PIN ini mengontrol otorisasi perintah keamanan di bot WhatsApp dan password akun login admin Web Portal.
          </p>
          <form id="changePinForm">
            <div class="form-group">
              <label for="currentPin">PIN Keamanan Saat Ini</label>
              <input type="password" id="currentPin" placeholder="Masukkan PIN lama" maxlength="8" required style="letter-spacing:3px;">
            </div>
            <div class="form-group">
              <label for="newPin">PIN Keamanan Baru (4-8 Digit Angka)</label>
              <input type="password" id="newPin" placeholder="Contoh: 849201" pattern="[0-9]{4,8}" maxlength="8" required style="letter-spacing:3px;">
              <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block;">Wajib 4 hingga 8 digit angka numerik (0-9).</span>
            </div>
            <div class="form-group">
              <label for="confirmPin">Konfirmasi PIN Baru</label>
              <input type="password" id="confirmPin" placeholder="Ulangi PIN baru" pattern="[0-9]{4,8}" maxlength="8" required style="letter-spacing:3px;">
            </div>
            <div style="margin-bottom:14px;display:flex;align-items:center;gap:8px;">
              <input type="checkbox" id="showPinToggle" onchange="toggleShowPins(this.checked)" style="cursor:pointer;">
              <label for="showPinToggle" style="font-size:12px;color:#94a3b8;cursor:pointer;margin-bottom:0;">Tampilkan Angka PIN</label>
            </div>
            <button type="submit" id="btnChangePin" class="btn-primary" style="background:linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
              🔒 Perbarui PIN &amp; Sinkronkan Cluster
            </button>
          </form>
          <div id="pinChangeNotice" style="display:none;margin-top:14px;padding:12px;border-radius:8px;font-size:12px;line-height:1.5;background:#064e3b;color:#a7f3d0;border:1px solid #059669;"></div>
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

    function toggleShowPins(show) {
      const type = show ? 'text' : 'password';
      document.getElementById('currentPin').type = type;
      document.getElementById('newPin').type = type;
      document.getElementById('confirmPin').type = type;
    }

    document.getElementById('changePinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPin = document.getElementById('currentPin').value.trim();
      const newPin = document.getElementById('newPin').value.trim();
      const confirmPin = document.getElementById('confirmPin').value.trim();
      const notice = document.getElementById('pinChangeNotice');
      const btn = document.getElementById('btnChangePin');

      if (!/^[0-9]{4,8}$/.test(newPin)) {
        showToast('❌ PIN baru harus terdiri dari 4-8 digit angka numerik!', true);
        return;
      }
      if (newPin !== confirmPin) {
        showToast('❌ Konfirmasi PIN baru tidak cocok!', true);
        return;
      }
      if (currentPin === newPin) {
        showToast('❌ PIN baru tidak boleh sama dengan PIN saat ini!', true);
        return;
      }

      btn.disabled = true;
      btn.innerText = '⏳ Menyimpan & Menyinkronkan Cluster...';
      notice.style.display = 'none';

      try {
        const res = await fetch('/api/security/pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPin, newPin, confirmPin })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✅ ' + data.message);
          document.getElementById('changePinForm').reset();
          notice.style.display = 'block';
          notice.innerHTML = '<b>🎉 PIN Keamanan Berhasil Diperbarui!</b><br>' +
            '• PIN baru telah aktif untuk Bot WhatsApp &amp; Login Dashboard.<br>' +
            '• Seluruh sesi bot aktif telah direset demi keamanan.<br>' +
            '• Sinkronisasi cluster node selesai.';
        } else {
          showToast('❌ Gagal: ' + (data.error || 'Terjadi kesalahan'), true);
        }
      } catch (err) {
        showToast('❌ Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerText = '🔒 Perbarui PIN & Sinkronkan Cluster';
      }
    });

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
