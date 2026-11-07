const WhatsAppClient = require('./whatsapp');
const SecurityWatcher = require('./watcher');
const config = require('./config');
const cluster = require('./cluster');

async function main() {
  console.log('================================================================');
  console.log('🛡️   DISTRIBUTED SECOPS & HEALTH AGENT (WHATSAPP CLUSTER)   🛡️');
  console.log('================================================================');
  console.log(`Node ID           : ${config.nodeId} (${config.nodeName})`);
  console.log(`Cluster Role      : ${config.clusterRole.toUpperCase()}`);
  console.log(`Port Cluster & QR : http://localhost:${config.clusterPort}`);
  console.log(`Interval Watcher  : ${config.watcherIntervalSeconds} detik`);
  console.log(`AI Engine (Ollama): ${config.ollamaUrl} (${config.ollamaModel})`);
  console.log('----------------------------------------------------------------');

  const waClient = new WhatsAppClient();
  const watcher = new SecurityWatcher(waClient);

  // Hook otomatis untuk meneruskan event cluster ke WhatsApp Admin
  cluster.onClusterAlert = async (alertData) => {
    const fullMsg = 
`🚨 *PERINGATAN ANCAMAN DARI WORKER NODE!* 🚨
-----------------------------------------
• *Node:* ${alertData.nodeName || alertData.nodeId} (${alertData.nodeId})
• *Waktu Deteksi:* ${new Date().toLocaleString('id-ID')}
-----------------------------------------
${alertData.message}`;
    await waClient.broadcastToAdmins(fullMsg);
  };

  cluster.onNodeStatusChange = async (event) => {
    if (event.status === 'offline') {
      const offlineMsg = 
`⚠️ *PERINGATAN KRITIKAL: NODE SERVER DOWN!* ⚠️
-----------------------------------------
• *Node:* ${event.name} (${event.nodeId})
• *Role:* ${event.role.toUpperCase()}
• *Alamat / URL:* ${event.url}
• *Status:* ❌ OFFLINE (Tidak Merespons)
• *Waktu Terdeteksi:* ${new Date().toLocaleString('id-ID')}
• *Penyebab:* Detak jantung (heartbeat) terputus >35 detik. Kemungkinan server mati mendadak, OS crash, atau jaringan terputus.
-----------------------------------------
Ketik *nodes* atau *all status* untuk cek status armada server.`;
      await waClient.broadcastToAdmins(offlineMsg);
    } else if (event.status === 'online') {
      const onlineMsg = 
`✅ *PEMULIHAN: NODE SERVER KEMBALI ONLINE* ✅
-----------------------------------------
• *Node:* ${event.name} (${event.nodeId})
• *Role:* ${event.role.toUpperCase()}
• *Status:* 🟢 ONLINE & SIAP OPERASIONAL
• *Waktu Pulih:* ${new Date().toLocaleString('id-ID')}
-----------------------------------------
Koneksi detak jantung dengan Master Koordinator telah kembali normal.`;
      await waClient.broadcastToAdmins(onlineMsg);
    }
  };

  // 1. Jika node adalah WORKER murni:
  if (config.clusterRole === 'worker') {
    waClient.startQrWebServer(); // Membuka HTTP Server untuk cluster endpoint
    await cluster.start();
    watcher.start();
    console.log('[Worker Mode] Node beroperasi sebagai worker. Siap menerima tugas dari Master.');
    return;
  }

  // 2. Jika node adalah STANDBY (Backup Master dengan Failover Otomatis):
  if (config.clusterRole === 'standby') {
    waClient.startQrWebServer();
    cluster.onPromoteToMaster = async () => {
      console.log('[Failover Promotion] Mengaktifkan WhatsApp Gateway di node ini...');
      await waClient.initBaileys();
    };
    cluster.onFailoverAlert = async (alertMsg) => {
      setTimeout(async () => {
        await waClient.broadcastToAdmins(alertMsg);
      }, 5000);
    };
    await cluster.start();
    watcher.start();
    console.log('[Standby Mode] Node standby aktif memantau kesehatan Master Utama.');
    return;
  }

  // 3. Jika node adalah MASTER KOORDINATOR AKTIF (Default):
  await waClient.start();
  await cluster.start();
  watcher.start();

  // Tangani graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Shutting down] Mematikan Security Agent...');
    watcher.stop();
    if (waClient.httpServer) waClient.httpServer.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});
