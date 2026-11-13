const { execOnHyperV } = require('./run_on_hyperv');

async function inspectRemaining() {
  const sites = [
    'pos.portal-egn.com',
    'portal-egn.com',
    'berita.portal-egn.com',
    'sekolah.exprogionusantara.cloud',
    'sekolah.exprogionusantara.my.id',
    'jasapajakpolsri.com',
    'chatbot.portal-egn.com',
    'chat.portal-egn.com',
    'rag.portal-egn.com',
    'api.portal-egn.com',
    'uportal.portal-egn.com',
    'edukasi.portal-egn.com',
    'exprogionusantara.cloud'
  ];

  const script = sites.map(s => `
    echo "=== ${s} ==="
    p="/home/vps_mirror/${s}/public_html"
    if [ -f "\$p/index.html" ]; then
      grep -i -E '<title|<meta name="description"|<h1' "\$p/index.html" | head -n 4
      head -n 35 "\$p/index.html" | grep -v '^\\s*$' | head -n 12
    elif [ -f "\$p/index.php" ]; then
      head -n 25 "\$p/index.php" | head -n 10
    fi
  `).join('\n');

  const res = await execOnHyperV(script);
  console.log(res.stdout);
}

inspectRemaining().catch(console.error);
