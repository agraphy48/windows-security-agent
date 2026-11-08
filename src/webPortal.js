const crypto = require('crypto');
const contactsManager = require('./contacts');
const config = require('./config');
const cluster = require('./cluster');

class WebPortal {
  constructor() {
    this.sessions = new Map(); // token -> { username, expiresAt }
    this.failedLogins = new Map(); // ip -> { count, lockedUntil }
    this.sessionTimeoutMs = 24 * 60 * 60 * 1000; // 24 jam
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
    return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
      .replace(/^.*:/, '');
  }

  async readBody(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
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
    });
  }

  async handleRequest(req, res, waClient) {
    const url = req.url.split('?')[0];
    const method = req.method.toUpperCase();

    // 1. Static / Public Routes
    if (url === '/login' && method === 'GET') {
      const session = this.getSession(req);
      if (session) {
        res.writeHead(302, { Location: '/dashboard' });
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

    if (url === '/' && method === 'GET') {
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

    if (url === '/qr' && method === 'GET') {
      this.renderQrPage(res, waClient);
      return true;
    }

    // 2. Protected Routes (Harus Login)
    if (url === '/dashboard' && method === 'GET') {
      const session = this.getSession(req);
      if (!session) {
        res.writeHead(302, { Location: '/login' });
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
        await this.handleApiAddContact(req, res);
        return true;
      }

      if (url.startsWith('/api/contacts/') && method === 'DELETE') {
        const id = url.replace('/api/contacts/', '');
        const removed = contactsManager.removeContact(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: !!removed, removed }));
        return true;
      }

      if (url.startsWith('/api/contacts/') && url.endsWith('/toggle') && method === 'POST') {
        const id = url.replace('/api/contacts/', '').replace('/toggle', '');
        const contact = contactsManager.toggleContact(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: !!contact, contact }));
        return true;
      }

      if (url.startsWith('/api/contacts/') && url.endsWith('/test') && method === 'POST') {
        const id = url.replace('/api/contacts/', '').replace('/test', '');
        await this.handleApiTestContact(req, res, id, waClient);
        return true;
      }
    }

    return false; // Bukan request web portal
  }

  async handleApiLogin(req, res) {
    const ip = this.getClientIp(req);
    const now = Date.now();

    // Cek proteksi brute force
    const failInfo = this.failedLogins.get(ip);
    if (failInfo && failInfo.lockedUntil > now) {
      const waitSec = Math.ceil((failInfo.lockedUntil - now) / 1000);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: `Terlalu banyak percobaan gagal. Akses dikunci sementara selama ${waitSec} detik.`
      }));
    }

    const body = await this.readBody(req);
    const username = (body.username || '').trim();
    const password = (body.password || '').trim();

    const expectedUser = config.dashboardUser || 'admin';
    const expectedPass = String(config.dashboardPass || config.securityPin || '465157');

    if (username === expectedUser && (password === expectedPass || password === String(config.securityPin))) {
      // Login sukses
      this.failedLogins.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      this.sessions.set(token, {
        username,
        createdAt: now,
        expiresAt: now + this.sessionTimeoutMs
      });

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `secops_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
      });
      return res.end(JSON.stringify({ success: true, message: 'Login berhasil!' }));
    } else {
      // Login gagal
      const currentFails = (failInfo ? failInfo.count : 0) + 1;
      let lockedUntil = 0;
      if (currentFails >= 5) {
        lockedUntil = now + (5 * 60 * 1000); // Kunci 5 menit
      }
      this.failedLogins.set(ip, { count: currentFails, lockedUntil });

      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: 'Username atau Password/PIN salah!' + (currentFails >= 5 ? ' IP Anda dikunci selama 5 menit.' : ` (${currentFails}/5 percobaan)`)
      }));
    }
  }

  handleApiLogout(req, res) {
    const cookies = this.parseCookies(req);
    if (cookies.secops_session) {
      this.sessions.delete(cookies.secops_session);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'secops_session=; Path=/; HttpOnly; Max-Age=0'
    });
    return res.end(JSON.stringify({ success: true }));
  }

  async handleApiAddContact(req, res) {
    const body = await this.readBody(req);
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

    try {
      const jid = `${contact.number}@s.whatsapp.net`;
      await waClient.sock.sendMessage(jid, { text: testMessage });
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
        <span class="user-tag">👤 Admin: <b>${session.username}</b></span>
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
                    <b>\${node.name}</b> (\${node.nodeId})<br>
                    <span style="color:#64748b;font-size:11px;">Role: \${node.role.toUpperCase()}</span>
                  </div>
                  <div class="fleet-status">
                    <span class="\${isOnline ? 'dot-online' : 'dot-offline'}"></span>
                    <span style="color:\${isOnline ? '#34d399' : '#f87171'};font-weight:600;">\${node.status.toUpperCase()}</span>
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
              return \`<span class="badge">\${a}</span>\`;
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
                <b>\${c.name}</b><br>
                <span style="color:var(--text-muted);font-size:11px;">\${c.role}</span>
              </td>
              <td>
                <a href="https://wa.me/\${c.number}" target="_blank" style="color:#60a5fa;text-decoration:none;font-weight:600;">
                  📱 +\${c.number}
                </a>
              </td>
              <td>\${alertBadges}</td>
              <td>\${statusBadge}</td>
              <td>
                <button onclick="testContact('\${c.id}')" class="btn-action btn-test" title="Kirim Pesan Uji Coba WA">🧪 Tes WA</button>
                <button onclick="toggleContact('\${c.id}')" class="btn-action btn-toggle" title="Aktifkan/Nonaktifkan">\${toggleLabel}</button>
                <button onclick="deleteContact('\${c.id}', '\${c.name}')" class="btn-action btn-delete" title="Hapus Kontak">🗑️</button>
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

    // Inisialisasi awal
    toggleAlertCheckboxes(document.getElementById('alertAll'));
    loadStatus();
    loadContacts();
  </script>
</body>
</html>`);
  }
}

module.exports = new WebPortal();
