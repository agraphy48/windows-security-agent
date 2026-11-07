const http = require('http');
const https = require('https');
const security = require('./security');
const config = require('./config');

class ClusterManager {
  constructor() {
    this.role = config.clusterRole; // 'master' | 'standby' | 'worker'
    this.nodes = new Map(); // nodeId -> { nodeId, name, role, url, status, lastSeen }
    this.heartbeatInterval = null;
    this.failoverInterval = null;
    this.consecutiveFailures = 0;
    this.onPromoteToMaster = null;
    this.onFailoverAlert = null;
    this.onClusterAlert = null;
    this.onNodeStatusChange = null;
  }

  init(httpServer) {
    if (!httpServer) return;

    // Tambahkan cluster endpoint handler ke httpServer
    const existingListeners = httpServer.listeners('request').slice();
    httpServer.removeAllListeners('request');

    httpServer.on('request', async (req, res) => {
      const url = req.url.split('?')[0];

      // Routing endpoint cluster
      if (url.startsWith('/api/cluster/')) {
        return await this.handleClusterApi(req, res);
      }

      // Fallback ke listener sebelumnya (misal portal QR Web)
      for (const listener of existingListeners) {
        listener(req, res);
      }
    });
  }

  async start() {
    console.log(`[🌐 Cluster] Mode: ${this.role.toUpperCase()} | Node ID: ${config.nodeId} (${config.nodeName})`);

    // Daftarkan diri sendiri
    this.nodes.set(config.nodeId, {
      nodeId: config.nodeId,
      name: config.nodeName,
      role: this.role,
      url: `http://localhost:${config.clusterPort}`,
      status: 'online',
      lastSeen: Date.now()
    });

    if (this.role === 'master') {
      this.startMasterWatcher();
    } else if (this.role === 'standby') {
      await this.registerWithMaster();
      this.startStandbyFailoverWatcher();
    } else if (this.role === 'worker') {
      await this.registerWithMaster();
      this.startWorkerHeartbeat();
    }
  }

  /**
   * Router untuk REST API Cluster internal
   */
  async handleClusterApi(req, res) {
    const url = req.url.split('?')[0];
    const clientIp = req.socket.remoteAddress ? req.socket.remoteAddress.replace(/^.*:/, '') : 'unknown';
    const authHeader = req.headers['x-cluster-secret'];

    console.log(`[🌐 Cluster API] ${req.method} ${url} dari IP: ${clientIp}`);

    // Verifikasi Token Rahasia Cluster
    if (authHeader !== config.clusterSecret) {
      console.warn(`[⚠️ Cluster Auth Ditolak] Token salah dari IP ${clientIp}. Header: "${authHeader}" (Dibutuhkan: "${config.clusterSecret}")`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Akses cluster ditolak: Token tidak valid' }));
    }

    if (req.method === 'GET' && url === '/api/cluster/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'ok',
        nodeId: config.nodeId,
        role: this.role,
        name: config.nodeName,
        timestamp: Date.now()
      }));
    }

    if (req.method === 'GET' && url === '/api/cluster/nodes') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        master: config.nodeId,
        total: this.nodes.size,
        nodes: Array.from(this.nodes.values())
      }));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        let data = {};
        try { data = JSON.parse(body); } catch {}

        // 1. Worker/Standby mendaftar ke Master
        if (url === '/api/cluster/register') {
          if (this.role !== 'master') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Hanya node Master yang menerima registrasi' }));
          }

          let finalNodeId = data.nodeId || 'node-02';
          let finalName = data.name || data.nodeId || 'Server Worker';

          // Auto-resolve IP Worker jika dikirim sebagai localhost / 127.0.0.1
          let workerUrl = data.url;
          if (!workerUrl || workerUrl.includes('localhost') || workerUrl.includes('127.0.0.1')) {
            workerUrl = `http://${clientIp}:${config.clusterPort}`;
          }

          // Jika node yang mendaftar memiliki ID yang SAMA dengan Master atau sudah dipakai node lain yang beda URL:
          const isSameAsMaster = finalNodeId === config.nodeId;
          const isConflictWithExisting = this.nodes.has(finalNodeId) && this.nodes.get(finalNodeId).url !== workerUrl;

          if (isSameAsMaster || isConflictWithExisting) {
            let nextIndex = 2;
            while (this.nodes.has(`node-0${nextIndex}`) || this.nodes.has(`node-${nextIndex}`)) {
              nextIndex++;
            }
            finalNodeId = `node-0${nextIndex}`;
            if (!data.name || data.name === config.nodeName || data.name === 'Server Utama' || data.name === 'Server VPS (AlmaLinux)') {
              finalName = `Server Node ${nextIndex}`;
            }
            console.warn(`[⚠️ Cluster ID Duplikat] Node dari ${clientIp} menggunakan ID yang sama ('${data.nodeId}'). Dialokasikan otomatis menjadi ID unik: '${finalNodeId}', Nama: '${finalName}'`);
          }

          this.nodes.set(finalNodeId, {
            nodeId: finalNodeId,
            name: finalName,
            role: data.role || 'worker',
            url: workerUrl,
            status: 'online',
            lastSeen: Date.now()
          });

          console.log(`[🌐 Cluster] Node terdaftar: ${finalName} (${finalNodeId}) sebagai ${data.role || 'worker'} (URL: ${workerUrl})`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            message: 'Node berhasil terdaftar di cluster',
            nodeId: finalNodeId,
            name: finalName
          }));
        }

        // 2. Heartbeat dari node
        if (url === '/api/cluster/heartbeat') {
          if (this.nodes.has(data.nodeId)) {
            const node = this.nodes.get(data.nodeId);
            const wasOffline = node.status === 'offline';
            node.status = 'online';
            node.lastSeen = Date.now();

            if (wasOffline && typeof this.onNodeStatusChange === 'function') {
              try {
                await this.onNodeStatusChange({
                  nodeId: data.nodeId,
                  name: node.name,
                  role: node.role,
                  url: node.url,
                  status: 'online',
                  lastSeen: node.lastSeen
                });
              } catch (err) {
                console.error('[Cluster] Gagal callback onNodeStatusChange online:', err.message);
              }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
          } else {
            // Beri sinyal ke worker untuk registrasi ulang
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'not_registered', message: 'Silakan registrasi ulang ke Master' }));
          }
        }

        // 3. Eksekusi perintah remote dari Master ke Worker
        if (url === '/api/cluster/execute') {
          const { command, params } = data;
          console.log(`[🛠️ Remote Command Exec] Perintah: ${command} (${JSON.stringify(params || {})})`);
          const result = await this.executeLocalSecurityCommand(command, params);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, result }));
        }

        // 4. Menerima Laporan Serangan / Alert Keamanan dari Worker ke Master
        if (url === '/api/cluster/alert') {
          const { nodeId, nodeName, alertType, message } = data;
          console.log(`[🚨 Cluster Alert Received] Node: ${nodeName || nodeId} (${nodeId}) | Tipe: ${alertType || 'ALERT'}`);
          if (typeof this.onClusterAlert === 'function') {
            try {
              await this.onClusterAlert({ nodeId, nodeName, alertType, message });
            } catch (err) {
              console.error('[Cluster] Gagal callback onClusterAlert:', err.message);
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, message: 'Alert diterima Master dan diteruskan ke WhatsApp' }));
        }

        res.writeHead(404);
        res.end();
      });
      return;
    }

    res.writeHead(404);
    res.end();
  }

  /**
   * Eksekusi perintah lokal atas permintaan Master
   */
  async executeLocalSecurityCommand(command, params = {}) {
    try {
      if (command === 'status') return await security.getSystemHealth();
      if (command === 'defender') return await security.getDefenderStatus();
      if (command === 'threats') return await security.getRecentThreats(5);
      if (command === 'scan') return await security.startQuickScan();
      if (command === 'scan-full') return await security.startFullScan();
      if (command === 'ports') return await security.getListeningPorts();
      if (command === 'docker') return await security.getDockerStatus();
      if (command === 'docker-restart') return await security.restartDockerContainer(params.container);
      if (command === 'block-ip') return await security.blockIp(params.ip);
      if (command === 'lockdown') return await security.emergencyLockdown();
      if (command === 'restore') return await security.restoreCloudflare();
      return { error: `Perintah tidak dikenal: ${command}` };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Pengawasan Master terhadap node worker (cek timeout)
   */
  startMasterWatcher() {
    setInterval(async () => {
      const now = Date.now();
      for (const [id, node] of this.nodes.entries()) {
        if (id === config.nodeId) continue;
        // Jika tidak ada detak jantung selama 35 detik, tandai OFFLINE
        if (now - node.lastSeen > 35000 && node.status === 'online') {
          node.status = 'offline';
          console.log(`[⚠️ Cluster Warning] Node ${node.name} (${id}) tidak merespons. Status: OFFLINE.`);
          if (typeof this.onNodeStatusChange === 'function') {
            try {
              await this.onNodeStatusChange({
                nodeId: id,
                name: node.name,
                role: node.role,
                url: node.url,
                status: 'offline',
                lastSeen: node.lastSeen
              });
            } catch (err) {
              console.error('[Cluster] Gagal callback onNodeStatusChange offline:', err.message);
            }
          }
        }
      }
    }, 10000);
  }

  /**
   * Mengirimkan notifikasi insiden serangan / overload dari Worker ke Master Koordinator
   */
  async sendAlertToMaster(message, alertType = 'SECURITY_ALERT') {
    if (this.role === 'master') return;
    try {
      await this.postJson(`${config.masterUrl}/api/cluster/alert`, {
        nodeId: config.nodeId,
        nodeName: config.nodeName,
        alertType,
        message,
        timestamp: Date.now()
      });
      console.log(`[🌐 Cluster] Alert berhasil diteruskan ke Master (${config.masterUrl})`);
    } catch (err) {
      console.error(`[🌐 Cluster] Gagal meneruskan alert ke Master: ${err.message}`);
    }
  }

  /**
   * Worker mengirim detak jantung berkala ke Master
   */
  startWorkerHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      try {
        const res = await this.postJson(`${config.masterUrl}/api/cluster/heartbeat`, {
          nodeId: config.nodeId
        });
        if (res && res.status === 'not_registered') {
          console.log('[Worker Heartbeat] Master baru saja restart atau belum mendata node ini. Mendaftarkan ulang...');
          await this.registerWithMaster();
        }
      } catch (err) {
        console.error(`[Worker Heartbeat Failed] Tidak dapat menghubungi Master: ${err.message}`);
      }
    }, 10000);
  }

  /**
   * Standby Master memantau Master Utama. Jika Master mati -> PROMOSI DIRI!
   */
  startStandbyFailoverWatcher() {
    const checkIntervalSeconds = 5;
    const maxFailures = Math.max(3, Math.floor(config.failoverTimeoutSeconds / checkIntervalSeconds));

    console.log(`[🛡️ Failover Watcher] Memantau Master Utama di ${config.masterUrl} (Timeout: ${config.failoverTimeoutSeconds}s)...`);

    this.failoverInterval = setInterval(async () => {
      try {
        const res = await this.getJson(`${config.masterUrl}/api/cluster/ping`, 4000);
        if (res && res.status === 'ok') {
          this.consecutiveFailures = 0; // Master sehat
        } else {
          this.consecutiveFailures++;
        }
      } catch {
        this.consecutiveFailures++;
        console.log(`[⚠️ Failover Warning] Master tidak merespons (${this.consecutiveFailures}/${maxFailures})`);
      }

      // Deteksi kegagalan Master -> EKSEKUSI FAILOVER!
      if (this.consecutiveFailures >= maxFailures) {
        clearInterval(this.failoverInterval);
        await this.promoteToActiveMaster();
      }
    }, checkIntervalSeconds * 1000);
  }

  /**
   * Promosi otonom dari Standby menjadi Master Aktif
   */
  async promoteToActiveMaster() {
    console.log('\n================================================================');
    console.log('🚨 FAILOVER TERPICU: MASTER UTAMA MATI! PROMOSI DIRI MENJADI MASTER!');
    console.log('================================================================\n');

    this.role = 'master';
    const myNode = this.nodes.get(config.nodeId);
    if (myNode) myNode.role = 'master';

    // Nyalakan Master Watcher
    this.startMasterWatcher();

    // Trigger callback ke index.js untuk menyalakan WhatsApp Gateway jika belum aktif
    if (typeof this.onPromoteToMaster === 'function') {
      await this.onPromoteToMaster();
    }

    // Beritahukan ke admin via WhatsApp
    if (typeof this.onFailoverAlert === 'function') {
      const alertMsg = 
`🚨 *PERINGATAN FAILOVER CLUSTER OTOMATIS* 🚨
-----------------------------------------
• *Peristiwa:* Master Koordinator Utama Offline / Tidak Merespons.
• *Tindakan Otonom:* Node Standby (*${config.nodeName}*) telah mengambil alih peran sebagai *MASTER KOORDINATOR AKTIF*.
• *Waktu:* ${new Date().toLocaleString('id-ID')}
• *Status Sistem:* Seluruh kendali WhatsApp dialihkan ke server ini secara normal.
-----------------------------------------`;
      await this.onFailoverAlert(alertMsg);
    }
  }

  async registerWithMaster() {
    try {
      const response = await this.postJson(`${config.masterUrl}/api/cluster/register`, {
        nodeId: config.nodeId,
        name: config.nodeName,
        role: this.role,
        url: `http://localhost:${config.clusterPort}`
      });
      if (response && response.nodeId && response.nodeId !== config.nodeId) {
        console.log(`[🌐 Cluster] Master mengalokasikan Node ID baru: ${response.nodeId} (sebelumnya: ${config.nodeId})`);
        config.nodeId = response.nodeId;
        if (response.name) config.nodeName = response.name;
      }
      console.log(`[🌐 Cluster] Berhasil terhubung dan terdaftar di Master (${config.masterUrl}) sebagai ${config.nodeId}`);
    } catch (err) {
      console.error(`[🌐 Cluster] Gagal mendaftar ke Master: ${err.message}. Akan mencoba lagi secara berkala.`);
    }
  }

  /**
   * Kirim perintah ke node tertentu (Local atau Remote)
   */
  async dispatchCommand(targetNodeId, command, params = {}) {
    // Jika target adalah server lokal ini
    if (targetNodeId === config.nodeId || targetNodeId === 'local' || !targetNodeId) {
      return await this.executeLocalSecurityCommand(command, params);
    }

    const node = this.nodes.get(targetNodeId);
    if (!node) {
      return { error: `Node ID "${targetNodeId}" tidak ditemukan dalam cluster.` };
    }

    if (node.status === 'offline') {
      return { error: `Node "${node.name}" sedang OFFLINE / tidak dapat dihubungi.` };
    }

    try {
      const response = await this.postJson(`${node.url}/api/cluster/execute`, {
        command,
        params
      });
      return response.result;
    } catch (err) {
      return { error: `Gagal mengirim perintah ke ${node.name}: ${err.message}` };
    }
  }

  /**
   * Kueri kesehatan seluruh node secara bersamaan (Aggregated Health)
   */
  async aggregateStatus() {
    const reports = [];

    for (const [id, node] of this.nodes.entries()) {
      if (node.status === 'offline') {
        reports.push({
          name: node.name,
          id,
          role: node.role,
          status: '❌ OFFLINE',
          health: null
        });
        continue;
      }

      try {
        const health = await this.dispatchCommand(id, 'status');
        reports.push({
          name: node.name,
          id,
          role: node.role,
          status: '✅ ONLINE',
          health
        });
      } catch {
        reports.push({
          name: node.name,
          id,
          role: node.role,
          status: '⚠️ ERROR',
          health: null
        });
      }
    }

    return reports;
  }

  /**
   * Helper HTTP/HTTPS POST JSON
   */
  postJson(urlStr, data, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const postData = JSON.stringify(data);
      const client = url.protocol === 'https:' ? https : http;
      const defaultPort = url.protocol === 'https:' ? 443 : 80;

      const req = client.request({
        hostname: url.hostname,
        port: url.port || defaultPort,
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SecurityAgent/1.0',
          'x-cluster-secret': config.clusterSecret
        },
        timeout: timeoutMs
      }, res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(postData);
      req.end();
    });
  }

  /**
   * Helper HTTP/HTTPS GET JSON
   */
  getJson(urlStr, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const client = url.protocol === 'https:' ? https : http;
      const defaultPort = url.protocol === 'https:' ? 443 : 80;

      const req = client.request({
        hostname: url.hostname,
        port: url.port || defaultPort,
        path: url.pathname + (url.search || ''),
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SecurityAgent/1.0',
          'x-cluster-secret': config.clusterSecret
        },
        timeout: timeoutMs
      }, res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }
}

const clusterService = new ClusterManager();
module.exports = clusterService;

