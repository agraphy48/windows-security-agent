const WhatsAppClient = require('./whatsapp');
const SecurityWatcher = require('./watcher');
const config = require('./config');

async function main() {
  console.log('================================================================');
  console.log('🛡️   WINDOWS SERVER SECURITY & HEALTH AGENT (WHATSAPP)   🛡️');
  console.log('================================================================');
  console.log(`Port QR Web       : http://localhost:${config.qrPort}`);
  console.log(`Interval Watcher  : ${config.watcherIntervalSeconds} detik`);
  console.log(`AI Engine (Ollama): ${config.ollamaUrl} (${config.ollamaModel})`);
  console.log('----------------------------------------------------------------');

  const waClient = new WhatsAppClient();
  const watcher = new SecurityWatcher(waClient);

  // Jalankan Baileys WhatsApp Gateway
  await waClient.start();

  // Jalankan Real-time Security Watcher
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

