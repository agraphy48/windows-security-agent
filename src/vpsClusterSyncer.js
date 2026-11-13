const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APPS_FILE = path.join(__dirname, '..', 'data', 'portal-apps.json');
const STATE_FILE = path.join(__dirname, '..', 'data', 'vps-sync-state.json');
const LAST_SYNC_FILE = path.join(__dirname, '..', 'data', 'last-vps-sync.json');
const CLOUDFLARE_CONFIG = path.join(process.env.USERPROFILE || 'C:\\Users\\agrap', '.cloudflared', 'config.yml');

class VpsClusterSyncer {
  constructor(options = {}) {
    this.intervalMinutes = options.intervalMinutes || 5;
    this.timer = null;
    this.isSyncing = false;
    this.onNewAppDiscovered = options.onNewAppDiscovered || null;
  }

  /**
   * Eksekusi perintah di Hyper-V VM (node-local) via Plink
   */
  execOnHyperV(cmdString) {
    return new Promise((resolve, reject) => {
      const cleanCmd = cmdString.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const p = spawn('plink', ['-batch', '-pw', '11011995Di@n', 'root@192.168.18.81', 'bash -s'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      p.stdin.write(cleanCmd + '\n');
      p.stdin.end();
      let out = '', err = '';
      p.stdout.on('data', d => out += d);
      p.stderr.on('data', d => err += d);
      p.on('close', code => resolve({ code, stdout: out, stderr: err }));
      p.on('error', reject);
    });
  }

  /**
   * Eksekusi perintah di VPS Utama (node-vps) via Hyper-V Tailscale SSH
   */
  execOnVps(commandString) {
    return new Promise((resolve, reject) => {
      const cleanCmd = commandString.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const p = spawn('plink', ['-batch', '-pw', '11011995Di@n', 'root@192.168.18.81', 'ssh -o BatchMode=yes node-vps bash -s'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      p.stdin.write(cleanCmd + '\n');
      p.stdin.end();
      let out = '', err = '';
      p.stdout.on('data', d => out += d);
      p.stderr.on('data', d => err += d);
      p.on('close', code => resolve({ code, stdout: out, stderr: err }));
      p.on('error', reject);
    });
  }

  /**
   * Membaca file portal-apps.json
   */
  getPortalApps() {
    try {
      if (fs.existsSync(APPS_FILE)) {
        const raw = fs.readFileSync(APPS_FILE, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error('[VpsClusterSyncer] Gagal membaca portal-apps.json:', e.message);
    }
    return [];
  }

  /**
   * Menyimpan daftar portal-apps.json
   */
  savePortalApps(apps) {
    try {
      const dir = path.dirname(APPS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(APPS_FILE, JSON.stringify(apps, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[VpsClusterSyncer] Gagal menyimpan portal-apps.json:', e.message);
      return false;
    }
  }

  /**
   * Membaca status sinkronisasi sebelumnya
   */
  getSyncState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      }
    } catch {
      // ignore
    }
    return { knownVhosts: [], knownDatabases: [], lastSyncTime: null };
  }

  /**
   * Menyimpan status sinkronisasi
   */
  saveSyncState(state) {
    try {
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
      console.error('[VpsClusterSyncer] Gagal menyimpan sync state:', e.message);
    }
  }

  /**
   * Kategorisasi cerdas berdasarkan nama domain
   */
  categorizeDomain(domain) {
    const d = domain.toLowerCase();
    let title = domain;
    let category = 'Aplikasi Web';
    let icon = '🌐';
    let iconColor = '#38bdf8';
    let iconBg = 'rgba(56, 189, 248, 0.15)';
    let description = `Aplikasi dan layanan web produksi ${domain} yang disinkronkan secara otomatis dari Cloud VPS AlmaLinux.`;

    if (d.includes('pos.') || d.includes('kasir')) {
      title = 'Aplikasi POS Multi-Cabang';
      category = 'Kasir & Retail SaaS';
      icon = '🛒';
      iconColor = '#f87171';
      iconBg = 'rgba(239, 68, 68, 0.15)';
      description = 'Sistem Kasir Digital KasirDigital/POS SaaS, transaksi penjualan online/offline, kontrol inventori barang & pembukuan.';
    } else if (d.includes('agus.')) {
      title = 'Aplikasi CV Agus Setiawan';
      category = 'Sistem Administrasi';
      icon = '🏢';
      iconColor = '#60a5fa';
      iconBg = 'rgba(59, 130, 246, 0.15)';
      description = 'Platform administrasi operasional, manajemen proyek konstruksi/pengadaan, dan database operasional CV Agus Setiawan.';
    } else if (d.includes('cbt.') || d.includes('edukasi.') || d.includes('ujian')) {
      title = 'Ujian Online CBT / LMS';
      category = 'CBT & LMS Offline-First';
      icon = '📝';
      iconColor = '#34d399';
      iconBg = 'rgba(16, 185, 129, 0.15)';
      description = 'Sistem Computer-Based Testing (CBT) berbasis Docker di server lokal ini. Mendukung PWA ujian offline bebas kuota internet.';
    } else if (d.includes('keu.') || d.includes('kas.') || d.includes('finance')) {
      title = 'Sistem Keuangan & Finansial';
      category = 'Keuangan & Akuntansi';
      icon = '💰';
      iconColor = '#fbbf24';
      iconBg = 'rgba(245, 158, 11, 0.15)';
      description = 'Platform pembukuan akuntansi, arus kas masuk/keluar, penggajian, dan laporan finansial terpadu.';
    } else if (d.includes('toko.') || d.includes('shop') || d.includes('store')) {
      title = 'Toko E-Commerce Retail';
      category = 'E-Commerce & Belanja';
      icon = '🛍️';
      iconColor = '#ec4899';
      iconBg = 'rgba(236, 72, 153, 0.15)';
      description = 'Platform belanja toko online resmi, katalog produk digital/fisik, keranjang belanja, dan manajemen pesanan.';
    } else if (d.includes('ukp.') || d.includes('bimbel')) {
      title = 'Portal Bimbel UKP';
      category = 'Pendidikan & Bimbingan Belajar';
      icon = '🎓';
      iconColor = '#818cf8';
      iconBg = 'rgba(99, 102, 241, 0.15)';
      description = 'Sistem informasi akademik bimbingan belajar UKP, jadwal kelas, materi bimbingan belajar, dan bank soal.';
    } else if (d.includes('polres') || d.includes('polsek') || d.includes('polri')) {
      title = 'Portal Kepolisian & Layanan Publik';
      category = 'Pemerintahan & Layanan Publik';
      icon = '🚓';
      iconColor = '#3b82f6';
      iconBg = 'rgba(59, 130, 246, 0.15)';
      description = 'Sistem informasi layanan masyarakat, pengaduan publik, dan administrasi operasional kepolisian.';
    } else if (d.includes('sekolah') || d.includes('sma') || d.includes('smp') || d.includes('sd') || d.includes('sch.id')) {
      title = 'Sistem Informasi Sekolah';
      category = 'Akademik & Sekolah';
      icon = '🏫';
      iconColor = '#10b981';
      iconBg = 'rgba(16, 185, 129, 0.15)';
      description = 'Website akademik sekolah, informasi peserta didik, e-rapor, dan direktori guru serta tenaga kependidikan.';
    } else if (d.includes('berita') || d.includes('news') || d.includes('media')) {
      title = 'Portal Berita & Media';
      category = 'Media & Publikasi';
      icon = '📰';
      iconColor = '#ef4444';
      iconBg = 'rgba(239, 68, 68, 0.15)';
      description = 'Portal publikasi berita, liputan pers, artikel terkini, dan dokumentasi peristiwa aktual.';
    } else if (d.includes('penerbit') || d.includes('buku') || d.includes('press')) {
      title = 'Penerbit & Publikasi Ilmiah';
      category = 'Publikasi & Karya Ilmiah';
      icon = '📖';
      iconColor = '#8b5cf6';
      iconBg = 'rgba(139, 92, 246, 0.15)';
      description = 'Layanan penerbitan karya ilmiah, buku ber-ISBN, prosiding seminar, dan manajemen naskah publikasi.';
    } else if (d.includes('chat') || d.includes('ai.') || d.includes('rag.')) {
      title = 'AI Assistant & Chatbot Cerdas';
      category = 'AI & Otomasi Cerdas';
      icon = '🤖';
      iconColor = '#10b981';
      iconBg = 'rgba(16, 185, 129, 0.15)';
      description = 'Layanan kecerdasan buatan LLM untuk percakapan interaktif, konsultasi otomatis, dan penelusuran basis data.';
    } else if (d.includes('pajak') || d.includes('tax')) {
      title = 'Konsultasi & Layanan Pajak';
      category = 'Konsultasi & Perpajakan';
      icon = '📊';
      iconColor = '#f59e0b';
      iconBg = 'rgba(245, 158, 11, 0.15)';
      description = 'Layanan bimbingan pelaporan pajak, SPT tahunan/masa, dan tata kelola keuangan taat pajak.';
    } else if (d.includes('api.')) {
      title = 'REST API Gateway';
      category = 'Backend & Developer API';
      icon = '⚡';
      iconColor = '#eab308';
      iconBg = 'rgba(234, 179, 8, 0.15)';
      description = 'Gerbang API terpusat untuk pertukaran data antar aplikasi mobile, dashboard web, dan sistem partner.';
    } else if (d.includes('jurnal') || d.includes('jlpp')) {
      title = 'Jurnal Ilmiah Riset';
      category = 'Riset & Jurnal Ilmiah';
      icon = '🔬';
      iconColor = '#06b6d4';
      iconBg = 'rgba(6, 182, 212, 0.15)';
      description = 'Sistem publikasi jurnal ilmiah Open Journal System (OJS) untuk diseminasi hasil penelitian akademik.';
    } else {
      // Format nama yang rapi dari domain
      const parts = domain.split('.');
      const sub = parts[0];
      const capitalized = sub.charAt(0).toUpperCase() + sub.slice(1);
      title = `Layanan ${capitalized} (${domain})`;
    }

    return { title, category, icon, iconColor, iconBg, description };
  }

  /**
   * Menambahkan entri baru ke Cloudflare Tunnel config.yml jika belum ada
   */
  updateCloudflareIngress(newDomains) {
    if (!fs.existsSync(CLOUDFLARE_CONFIG)) return false;
    let changed = false;

    try {
      let content = fs.readFileSync(CLOUDFLARE_CONFIG, 'utf8');

      for (const domain of newDomains) {
        if (!content.includes(`hostname: ${domain}`)) {
          console.log(`[🌐 Cloudflare Ingress] Menambahkan failover route baru: ${domain}`);
          
          const newRule = 
`  # Auto-Synced VHost dari VPS
  - hostname: ${domain}
    service: http://192.168.18.81:80
`;
          // Sisipkan sebelum catch-all rule (- service: http_status:404)
          content = content.replace(/(\n\s*-\s*service:\s*http_status:404)/, `\n${newRule}$1`);
          changed = true;
        }
      }

      if (changed) {
        fs.writeFileSync(CLOUDFLARE_CONFIG, content, 'utf8');
        console.log('[🌐 Cloudflare Ingress] File config.yml berhasil diperbarui.');
      }
    } catch (e) {
      console.error('[🌐 Cloudflare Ingress] Gagal memperbarui config.yml:', e.message);
    }

    return changed;
  }

  /**
   * Menjalankan Pemindaian & Sinkronisasi Penuh
   */
  async runFullSync() {
    if (this.isSyncing) {
      console.log('[🔄 Auto-Sync] Proses sinkronisasi sedang berjalan. Lewati panggilan ini.');
      return { inProgress: true };
    }

    this.isSyncing = true;
    const startTime = Date.now();
    const result = {
      timestamp: new Date().toISOString(),
      discoveredVhosts: 0,
      newVhosts: [],
      newDatabases: [],
      newPortalAppsCount: 0,
      openLiteSpeedReloaded: false,
      error: null
    };

    try {
      console.log('[🔄 Auto-Sync] Memulai pemindaian otomatis penambahan di VPS AlmaLinux...');

      // 1. Dapatkan daftar VHost & Database terkini dari VPS
      const vpsScanRes = await this.execOnVps(`
        echo "=== VHOSTS_START ==="
        ls -1 /usr/local/lsws/conf/vhosts/ 2>/dev/null
        echo "=== VHOSTS_END ==="
        echo "=== DATABASES_START ==="
        mysql -e "SHOW DATABASES;" 2>/dev/null | grep -v "Database" | grep -v "information_schema" | grep -v "performance_schema" | grep -v "sys"
        echo "=== DATABASES_END ==="
      `);

      if (vpsScanRes.code !== 0) {
        throw new Error(`Gagal menghubungi VPS: ${vpsScanRes.stderr || 'Timeout / SSH Error'}`);
      }

      const vhostMatch = vpsScanRes.stdout.match(/=== VHOSTS_START ===([\s\S]*?)=== VHOSTS_END ===/);
      const dbMatch = vpsScanRes.stdout.match(/=== DATABASES_START ===([\s\S]*?)=== DATABASES_END ===/);

      const vpsVhosts = vhostMatch ? vhostMatch[1].split('\n').map(s => s.trim()).filter(Boolean) : [];
      const vpsDatabases = dbMatch ? dbMatch[1].split('\n').map(s => s.trim()).filter(Boolean) : [];

      result.discoveredVhosts = vpsVhosts.length;
      console.log(`[🔄 Auto-Sync] Ditemukan ${vpsVhosts.length} Virtual Host dan ${vpsDatabases.length} Database di VPS.`);

      // 2. Cek VHost yang sudah ada di Hyper-V
      const hyperVScanRes = await this.execOnHyperV(`
        ls -1 /usr/local/lsws/conf/vhosts/ 2>/dev/null
      `);
      const hyperVVhosts = (hyperVScanRes.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);

      // Filter VHost baru yang belum ada di Hyper-V
      const ignoredVhosts = ['Example', 'alma-cyberpanel.localhost', 'srv1069700.hstgr.cloud'];
      const missingVhosts = vpsVhosts.filter(v => !hyperVVhosts.includes(v) && !ignoredVhosts.includes(v));

      if (missingVhosts.length > 0) {
        console.log(`[🔄 Auto-Sync] Menemukan ${missingVhosts.length} VHost baru di VPS yang belum ada di Hyper-V:`, missingVhosts);
        result.newVhosts = missingVhosts;

        // Sinkronisasikan setiap VHost baru ke Hyper-V
        for (const vhost of missingVhosts) {
          console.log(`[📦 Replikasi Web] Menyinkronkan '${vhost}' ke Hyper-V...`);
          
          const syncScript = `
            # 1. Pastikan folder mirror ada dan rsync dari VPS
            mkdir -p /home/vps_mirror/${vhost}
            if ssh -o BatchMode=yes node-vps "[ -d '/home/${vhost}' ]"; then
              rsync -avz --exclude 'logs' --exclude '.git' -e 'ssh -o BatchMode=yes' node-vps:/home/${vhost}/ /home/vps_mirror/${vhost}/
            fi

            # 2. Buat symlink di /home/${vhost}
            if [ ! -e "/home/${vhost}" ]; then
              ln -s "/home/vps_mirror/${vhost}" "/home/${vhost}"
            fi

            # 3. Salin user pemilik jika ada
            VPS_USER=$(ssh -o BatchMode=yes node-vps "stat -c '%U' /home/${vhost} 2>/dev/null")
            if [ -n "$VPS_USER" ] && [ "$VPS_USER" != "UNKNOWN" ] && [ "$VPS_USER" != "root" ]; then
              if ! id "$VPS_USER" >/dev/null 2>&1; then
                USER_ENTRY=$(ssh -o BatchMode=yes node-vps "grep '^$VPS_USER:' /etc/passwd")
                GROUP_ENTRY=$(ssh -o BatchMode=yes node-vps "grep '^$VPS_USER:' /etc/group")
                [ -n "$GROUP_ENTRY" ] && echo "$GROUP_ENTRY" >> /etc/group
                [ -n "$USER_ENTRY" ] && echo "$USER_ENTRY" >> /etc/passwd
              fi
            fi

            # 4. Salin konfigurasi vhost OpenLiteSpeed dari VPS
            mkdir -p /usr/local/lsws/conf/vhosts/${vhost}
            if ssh -o BatchMode=yes node-vps "[ -f '/usr/local/lsws/conf/vhosts/${vhost}/vhost.conf' ]"; then
              rsync -avz -e 'ssh -o BatchMode=yes' node-vps:/usr/local/lsws/conf/vhosts/${vhost}/ /usr/local/lsws/conf/vhosts/${vhost}/
            fi

            # 5. Daftarkan ke httpd_config.conf Hyper-V jika belum terdaftar
            if ! grep -q "virtualhost ${vhost}" /usr/local/lsws/conf/httpd_config.conf; then
              cat << 'EOF_VHOST' >> /usr/local/lsws/conf/httpd_config.conf

virtualhost ${vhost} {
  vhRoot                  /home/${vhost}
  configFile              /usr/local/lsws/conf/vhosts/${vhost}/vhost.conf
  allowSymbolLink         1
  enableScript            1
  restrained              1
}
EOF_VHOST
            fi

            # Daftarkan map ke listener Default
            if ! grep -q "map\s*${vhost}\s*${vhost}" /usr/local/lsws/conf/httpd_config.conf; then
              sed -i "/listener Default {/,/}/ s/}/  map                     ${vhost} ${vhost}\n}/" /usr/local/lsws/conf/httpd_config.conf
            fi
          `;

          const syncRes = await this.execOnHyperV(syncScript);
          if (syncRes.code !== 0) {
            console.warn(`[⚠️ Replikasi Warning] VHost ${vhost}:`, syncRes.stderr);
          } else {
            console.log(`[✅ Replikasi Sukses] VHost ${vhost} berhasil dimirror ke Hyper-V.`);
          }
        }

        // Reload OpenLiteSpeed di Hyper-V
        const reloadRes = await this.execOnHyperV(`
          /usr/local/lsws/bin/openlitespeed -t && systemctl reload lsws
        `);
        if (reloadRes.code === 0) {
          result.openLiteSpeedReloaded = true;
          console.log('[🚀 OpenLiteSpeed] Konfigurasi di Hyper-V berhasil direload.');
        }

        // Update Cloudflare Tunnel Ingress
        this.updateCloudflareIngress(missingVhosts);
      }

      // 3. Cek Database Baru
      const hyperVDbRes = await this.execOnHyperV(`
        mariadb -e "SHOW DATABASES;" 2>/dev/null | grep -v "Database" | grep -v "information_schema" | grep -v "performance_schema" | grep -v "sys"
      `);
      const hyperVDatabases = (hyperVDbRes.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
      const missingDatabases = vpsDatabases.filter(db => !hyperVDatabases.includes(db));

      if (missingDatabases.length > 0) {
        console.log(`[🗄️ Database Replikasi] Menemukan ${missingDatabases.length} Database baru di VPS:`, missingDatabases);
        result.newDatabases = missingDatabases;

        for (const db of missingDatabases) {
          console.log(`[🗄️ Streaming DB] Mengirim database '${db}' dari VPS ke MariaDB Hyper-V...`);
          const dbSyncScript = `
            ssh -o BatchMode=yes node-vps "mariadb-dump --single-transaction --quick '${db}' 2>/dev/null" | mariadb -e "CREATE DATABASE IF NOT EXISTS \\\`${db}\\\`;" && ssh -o BatchMode=yes node-vps "mariadb-dump --single-transaction --quick '${db}' 2>/dev/null" | mariadb '${db}'
          `;
          await this.execOnHyperV(dbSyncScript);
          console.log(`[✅ Database Sukses] Database '${db}' berhasil direplikasi.`);
        }
      }

      // 4. Update Dynamic Portal Apps Catalog (portal-apps.json)
      const currentApps = this.getPortalApps();
      let appsModified = false;
      const registeredDomains = new Set(currentApps.map(a => (a.domain || '').toLowerCase()));

      // Saring vhost yang layak tampil di portal katalog
      const portalEligibleVhosts = vpsVhosts.filter(v => {
        if (ignoredVhosts.includes(v)) return false;
        if (v.startsWith('mail.')) return false;
        if (v.startsWith('api-')) return false;
        if (v.includes('localhost')) return false;
        return true;
      });

      for (const domain of portalEligibleVhosts) {
        if (!registeredDomains.has(domain.toLowerCase())) {
          const meta = this.categorizeDomain(domain);
          const slug = 'app-' + domain.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase();

          // Subdomain cermin di Cloudflare jika ada
          const parts = domain.split('.');
          const sub = parts[0];
          const mirrorUrl = `https://${sub}.kedukanaksara.com`;

          const newAppEntry = {
            id: slug,
            title: meta.title,
            domain: domain,
            category: meta.category,
            icon: meta.icon,
            iconColor: meta.iconColor,
            iconBg: meta.iconBg,
            description: meta.description,
            primaryUrl: `https://${domain}`,
            mirrorUrl: mirrorUrl,
            target: '_blank',
            pinned: false,
            autoDiscovered: true,
            discoveredAt: new Date().toISOString(),
            order: currentApps.length + 1
          };

          currentApps.push(newAppEntry);
          registeredDomains.add(domain.toLowerCase());
          appsModified = true;
          result.newPortalAppsCount++;
          console.log(`[✨ Portal Catalog] Menambahkan aplikasi baru ke portal: ${meta.title} (${domain})`);

          if (this.onNewAppDiscovered) {
            this.onNewAppDiscovered(newAppEntry);
          }
        }
      }

      if (appsModified) {
        this.savePortalApps(currentApps);
      }

      // Simpan state
      this.saveSyncState({
        knownVhosts: vpsVhosts,
        knownDatabases: vpsDatabases,
        lastSyncTime: new Date().toISOString(),
        totalAppsInPortal: currentApps.length
      });

      result.durationMs = Date.now() - startTime;
      console.log(`[🏁 Auto-Sync Selesai] Waktu proses: ${result.durationMs}ms | VHost Baru: ${result.newVhosts.length} | DB Baru: ${result.newDatabases.length} | Total Aplikasi Portal: ${currentApps.length}`);

    } catch (err) {
      result.error = err.message;
      console.error('[❌ Auto-Sync Gagal]', err.message);
    } finally {
      this.isSyncing = false;
      try {
        fs.writeFileSync(LAST_SYNC_FILE, JSON.stringify(result, null, 2), 'utf8');
      } catch {
        // ignore
      }
    }

    return result;
  }

  /**
   * Mulai background watcher otomatis berkala
   */
  startWatcher() {
    if (this.timer) return;
    const intervalMs = this.intervalMinutes * 60 * 1000;
    console.log(`[⏱️ VpsClusterSyncer] Background auto-sync aktif. Memindai setiap ${this.intervalMinutes} menit.`);

    // Jalankan satu kali segera setelah startup
    setTimeout(() => {
      this.runFullSync().catch(e => console.error('[Auto-Sync Startup Error]', e.message));
    }, 5000);

    this.timer = setInterval(() => {
      this.runFullSync().catch(e => console.error('[Auto-Sync Interval Error]', e.message));
    }, intervalMs);
  }

  stopWatcher() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// Singleton instance
const vpsClusterSyncer = new VpsClusterSyncer({ intervalMinutes: 5 });

module.exports = vpsClusterSyncer;
