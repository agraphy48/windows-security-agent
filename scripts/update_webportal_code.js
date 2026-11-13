const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '..', 'src', 'webPortal.js');
let content = fs.readFileSync(targetFile, 'utf8');

const newMethodCode = `  renderPortalCatalogPage(res) {
    const syncer = require('./vpsClusterSyncer');
    const apps = syncer.getPortalApps();
    const syncState = syncer.getSyncState();
    const lastSyncStr = syncState.lastSyncTime ? new Date(syncState.lastSyncTime).toLocaleString('id-ID') : 'Baru saja';

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, private'
    });

    res.end(\`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portal Aplikasi & Layanan Terpadu - Kedukan Aksara / EGN</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body {
      background: radial-gradient(circle at 50% 0%, #1e1b4b 0%, #0b0f19 65%);
      color: #f1f5f9;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .container {
      max-width: 1280px;
      margin: 0 auto;
      padding: 32px 20px 60px 20px;
      width: 100%;
      flex: 1;
    }
    header {
      text-align: center;
      margin-bottom: 26px;
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.35);
      padding: 6px 16px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      color: #a5b4fc;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #ffffff 40%, #94a3b8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 15px;
      color: #94a3b8;
      max-width: 760px;
      margin: 0 auto;
      line-height: 1.5;
    }
    .status-bar {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 12px;
      margin-top: 20px;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid #334155;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 12px;
      color: #cbd5e1;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 10px #10b981;
      display: inline-block;
    }

    /* Toolbar: Search, Filters & Sync */
    .toolbar-container {
      margin-top: 28px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 18px 24px;
      border-radius: 16px;
      backdrop-filter: blur(12px);
    }
    .toolbar-top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .search-box {
      flex: 1;
      min-width: 260px;
      position: relative;
    }
    .search-box input {
      width: 100%;
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid #334155;
      padding: 10px 16px 10px 40px;
      border-radius: 10px;
      color: #f8fafc;
      font-size: 14px;
      outline: none;
      transition: all 0.2s ease;
    }
    .search-box input:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
    }
    .search-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 15px;
      color: #94a3b8;
    }
    .btn-sync-vps {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 10px 18px;
      border-radius: 10px;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }
    .btn-sync-vps:hover:not(:disabled) {
      background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%);
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
    }
    .btn-sync-vps:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .filter-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .filter-btn {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #94a3b8;
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    .filter-btn:hover {
      background: rgba(51, 65, 85, 0.8);
      color: #ffffff;
    }
    .filter-btn.active {
      background: #4f46e5;
      color: #ffffff;
      border-color: #6366f1;
      font-weight: 600;
    }

    /* Grid & Cards */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 22px;
      margin-top: 24px;
    }
    .card {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 18px;
      padding: 22px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: all 0.25s ease;
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(12px);
    }
    .card:hover {
      transform: translateY(-4px);
      border-color: rgba(99, 102, 241, 0.4);
      box-shadow: 0 20px 30px -10px rgba(0, 0, 0, 0.5), 0 0 25px rgba(99, 102, 241, 0.15);
    }
    .card-top {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 12px;
    }
    .card-icon {
      font-size: 30px;
      width: 52px;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.1);
      flex-shrink: 0;
    }
    .card-meta {
      flex: 1;
    }
    .card-badge-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
      flex-wrap: wrap;
    }
    .card-tag {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #38bdf8;
    }
    .pill-pinned {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(245, 158, 11, 0.2);
      color: #f59e0b;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .pill-auto {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.25);
    }
    .card-title {
      font-size: 17px;
      font-weight: 700;
      color: #f8fafc;
      line-height: 1.3;
    }
    .card-domain {
      display: inline-block;
      font-size: 11.5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #64748b;
      margin-top: 3px;
    }
    .card-desc {
      font-size: 13.5px;
      color: #94a3b8;
      line-height: 1.5;
      margin-bottom: 18px;
    }
    .card-actions {
      display: flex;
      flex-direction: column;
      gap: 9px;
      margin-top: auto;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s ease;
      text-align: center;
    }
    .btn-primary {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      box-shadow: 0 6px 18px rgba(37, 99, 235, 0.4);
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: rgba(30, 41, 59, 0.8);
      color: #cbd5e1;
      border: 1px solid #334155;
    }
    .btn-secondary:hover {
      background: rgba(51, 65, 85, 0.85);
      color: #ffffff;
      border-color: #64748b;
      transform: translateY(-1px);
    }
    .empty-state {
      grid-column: 1 / -1;
      text-align: center;
      padding: 60px 20px;
      color: #94a3b8;
    }
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1e293b;
      border: 1px solid #3b82f6;
      color: #f8fafc;
      padding: 14px 20px;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      font-size: 13.5px;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 9999;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }
    footer {
      border-top: 1px solid #1e293b;
      padding: 24px 20px;
      text-align: center;
      font-size: 13px;
      color: #64748b;
      background: rgba(11, 15, 25, 0.95);
    }
    .footer-highlight {
      color: #a5b4fc;
      font-weight: 600;
    }
    @keyframes spin {
      100% { transform: rotate(360deg); }
    }
    .spinning {
      display: inline-block;
      animation: spin 1s linear infinite;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-badge">
        <span>🌐</span>
        <span>HIGH-AVAILABILITY CLUSTER & FAILOVER</span>
      </div>
      <h1>Portal Navigasi Aplikasi Terpadu</h1>
      <p class="subtitle">Akses cepat seluruh layanan produksi Cloud VPS AlmaLinux dan server cadangan lokal (Hyper-V & Windows Docker) dengan sinkronisasi otomatis dan proteksi Cloudflare.</p>
      
      <div class="status-bar">
        <div class="status-pill">
          <span class="status-dot"></span>
          <span>Master VPS: <strong>Online (Cloud)</strong></span>
        </div>
        <div class="status-pill">
          <span class="status-dot"></span>
          <span>Hyper-V Worker: <strong>Online (192.168.18.81)</strong></span>
        </div>
        <div class="status-pill">
          <span class="status-dot"></span>
          <span>Windows Standby: <strong>Online (:5005)</strong></span>
        </div>
        <div class="status-pill">
          <span>🕒 Waktu: <strong id="clock-wib">--:--:-- WIB</strong></span>
        </div>
        <div class="status-pill">
          <span>📦 Total Layanan: <strong id="total-apps-badge">\${apps.length} Aplikasi</strong></span>
        </div>
      </div>
    </header>

    <!-- Toolbar: Filter, Cari & Sinkronkan Otomatis -->
    <div class="toolbar-container">
      <div class="toolbar-top">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input type="text" id="search-input" placeholder="Cari nama aplikasi, subdomain, atau kategori layanan..." oninput="filterApps()">
        </div>
        <button id="btn-sync" class="btn-sync-vps" onclick="triggerVpsSync()">
          <span id="sync-icon">🔄</span>
          <span id="sync-text">Sinkronkan dari VPS</span>
        </button>
      </div>
      <div class="filter-tabs" id="filter-tabs">
        <button class="filter-btn active" onclick="setCategoryFilter('all', this)">Semua (<span id="count-all">\${apps.length}</span>)</button>
        <button class="filter-btn" onclick="setCategoryFilter('pinned', this)">⭐ Prioritas</button>
        <button class="filter-btn" onclick="setCategoryFilter('saas', this)">🛒 Kasir & SaaS</button>
        <button class="filter-btn" onclick="setCategoryFilter('admin', this)">🏢 Administrasi</button>
        <button class="filter-btn" onclick="setCategoryFilter('edu', this)">📝 CBT & Edukasi</button>
        <button class="filter-btn" onclick="setCategoryFilter('finance', this)">💰 Keuangan</button>
        <button class="filter-btn" onclick="setCategoryFilter('infra', this)">⚙️ Infrastruktur</button>
        <button class="filter-btn" onclick="setCategoryFilter('ai', this)">🤖 AI & Otomasi</button>
        <button class="filter-btn" onclick="setCategoryFilter('media', this)">📰 Media & Lainnya</button>
      </div>
    </div>

    <!-- Grid Kartu Aplikasi Dinamis -->
    <div class="grid" id="apps-grid">
      <!-- Di-render via JS dari data portal-apps.json -->
    </div>
  </div>

  <div id="toast" class="toast">
    <span id="toast-icon">ℹ️</span>
    <span id="toast-msg">Pesan notifikasi</span>
  </div>

  <footer>
    <p>© 2026 <span class="footer-highlight">Kedukan Aksara</span> & <span class="footer-highlight">PT Expro Gio Nusantara</span>. Autonomous Multi-Layered SecOps Cluster Architecture.</p>
  </footer>

  <script>
    let appsData = \${JSON.stringify(apps)};
    let activeCategory = 'all';

    function showToast(msg, isSuccess = true) {
      const toast = document.getElementById('toast');
      const toastMsg = document.getElementById('toast-msg');
      const toastIcon = document.getElementById('toast-icon');
      toastIcon.textContent = isSuccess ? '✅' : '⚠️';
      toastMsg.textContent = msg;
      toast.className = 'toast show';
      setTimeout(() => {
        toast.className = 'toast';
      }, 4000);
    }

    function renderCards(list) {
      const grid = document.getElementById('apps-grid');
      if (!list || list.length === 0) {
        grid.innerHTML = \\\`
          <div class="empty-state">
            <p style="font-size: 32px; margin-bottom: 12px;">🔍</p>
            <h3>Tidak ada aplikasi yang cocok</h3>
            <p style="font-size: 13px; color: #64748b; margin-top: 6px;">Coba gunakan kata kunci pencarian yang berbeda.</p>
          </div>
        \\\`;
        return;
      }

      grid.innerHTML = list.map(app => {
        const bg = app.iconBg || 'rgba(30, 41, 59, 0.8)';
        const borderColor = app.iconColor ? app.iconColor + '40' : 'rgba(255, 255, 255, 0.1)';
        const badgeHtml = app.pinned 
          ? '<span class="pill-pinned">⭐ PRIORITAS</span>' 
          : '<span class="pill-auto">⚡ AUTO-SYNC</span>';

        return \\\`
          <div class="card" data-id="\\\${app.id}">
            <div>
              <div class="card-top">
                <div class="card-icon" style="background: \\\${bg}; border-color: \\\${borderColor};">
                  \\\${app.icon || '🌐'}
                </div>
                <div class="card-meta">
                  <div class="card-badge-row">
                    <span class="card-tag">\\\${app.category || 'Aplikasi Web'}</span>
                    \\\${badgeHtml}
                  </div>
                  <div class="card-title">\\\${app.title}</div>
                  <span class="card-domain">\\\${app.domain}</span>
                </div>
              </div>
              <p class="card-desc">\\\${app.description || 'Layanan produksi tersinkronisasi.'}</p>
            </div>
            <div class="card-actions">
              <a href="\\\${app.primaryUrl}" target="_blank" rel="noopener" class="btn btn-primary">
                🚀 Buka Server Utama (VPS)
              </a>
              <a href="\\\${app.mirrorUrl || '#'}" target="_blank" rel="noopener" class="btn btn-secondary">
                ⚡ Buka Cermin Failover (Local)
              </a>
            </div>
          </div>
        \\\`;
      }).join('');
    }

    function setCategoryFilter(cat, btn) {
      activeCategory = cat;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      filterApps();
    }

    function filterApps() {
      const q = (document.getElementById('search-input').value || '').toLowerCase().trim();
      
      const filtered = appsData.filter(app => {
        if (activeCategory === 'pinned' && !app.pinned) return false;
        if (activeCategory === 'saas' && !app.category.includes('Kasir') && !app.category.includes('SaaS') && !app.category.includes('Belanja')) return false;
        if (activeCategory === 'admin' && !app.category.includes('Administrasi') && !app.category.includes('Pemerintahan')) return false;
        if (activeCategory === 'edu' && !app.category.includes('CBT') && !app.category.includes('Pendidikan') && !app.category.includes('Sekolah')) return false;
        if (activeCategory === 'finance' && !app.category.includes('Keuangan') && !app.category.includes('Pajak')) return false;
        if (activeCategory === 'infra' && !app.category.includes('Infrastruktur')) return false;
        if (activeCategory === 'ai' && !app.category.includes('AI') && !app.category.includes('API') && !app.category.includes('Developer')) return false;
        if (activeCategory === 'media' && !app.category.includes('Media') && !app.category.includes('Publikasi') && !app.category.includes('Jurnal')) return false;

        if (q) {
          const matchTitle = (app.title || '').toLowerCase().includes(q);
          const matchDomain = (app.domain || '').toLowerCase().includes(q);
          const matchDesc = (app.description || '').toLowerCase().includes(q);
          const matchCat = (app.category || '').toLowerCase().includes(q);
          return matchTitle || matchDomain || matchDesc || matchCat;
        }

        return true;
      });

      renderCards(filtered);
    }

    async function triggerVpsSync() {
      const btn = document.getElementById('btn-sync');
      const icon = document.getElementById('sync-icon');
      const text = document.getElementById('sync-text');

      btn.disabled = true;
      icon.className = 'spinning';
      text.textContent = 'Menyinkronkan...';

      try {
        const res = await fetch('/api/portal/sync-vps', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          if (data.apps) {
            appsData = data.apps;
            document.getElementById('total-apps-badge').textContent = appsData.length + ' Aplikasi';
            document.getElementById('count-all').textContent = appsData.length;
            filterApps();
          }
          const addedMsg = data.newPortalAppsCount > 0 
            ? 'Ditemukan ' + data.newPortalAppsCount + ' aplikasi baru!' 
            : 'Semua aplikasi sudah sinkron.';
          showToast('Sinkronisasi selesai! ' + addedMsg, true);
        } else {
          showToast('Gagal sinkronisasi: ' + (data.error || 'Terjadi kesalahan'), false);
        }
      } catch (err) {
        showToast('Koneksi gagal: ' + err.message, false);
      } finally {
        btn.disabled = false;
        icon.className = '';
        text.textContent = 'Sinkronkan dari VPS';
      }
    }

    function updateClock() {
      const now = new Date();
      const options = { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };
      document.getElementById('clock-wib').textContent = now.toLocaleTimeString('id-ID', options) + ' WIB';
    }
    updateClock();
    setInterval(updateClock, 1000);

    renderCards(appsData);
  </script>
</body>
</html>\`);
  }`;

// Find start of renderPortalCatalogPage and end of it
const startMarker = '  renderPortalCatalogPage(res) {';
const endMarker = '  renderLoginPage(res, req) {';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('Markers not found!');
  process.exit(1);
}

const updatedContent = content.substring(0, startIndex) + newMethodCode + '\n\n' + content.substring(endIndex);
fs.writeFileSync(targetFile, updatedContent, 'utf8');
console.log('Successfully updated renderPortalCatalogPage in webPortal.js!');

