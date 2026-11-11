const { execOnVps } = require('./vps_exec');

async function inspect() {
  console.log('=== 1. VHOSTS ON VPS ===');
  const vhosts = await execOnVps('ls -la /usr/local/lsws/conf/vhosts/ 2>/dev/null');
  console.log(vhosts.stdout);

  console.log('=== 2. DATABASES ON VPS ===');
  const dbs = await execOnVps("mysql -e 'SHOW DATABASES;' 2>/dev/null || mariadb -e 'SHOW DATABASES;' 2>/dev/null || echo 'Need root/auth'");
  console.log(dbs.stdout);

  console.log('=== 3. PM2 APPS DETAILS ===');
  const p0 = await execOnVps('pm2 describe 0');
  console.log('App 0:');
  console.log(p0.stdout.split('\n').filter(l => l.includes('name') || l.includes('path') || l.includes('cwd') || l.includes('script') || l.includes('status')).join('\n'));

  const p1 = await execOnVps('pm2 describe 1');
  console.log('App 1:');
  console.log(p1.stdout.split('\n').filter(l => l.includes('name') || l.includes('path') || l.includes('cwd') || l.includes('script') || l.includes('status')).join('\n'));
}

inspect().catch(console.error);
