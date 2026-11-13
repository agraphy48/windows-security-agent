const { execOnVps } = require('./vps_exec');

async function syncMysqlUsers() {
  console.log('Dumping mysql.user, mysql.db, mysql.tables_priv from VPS to node-local...');
  const cmd = `mysqldump --replace --no-create-info mysql db user tables_priv | gzip -c | ssh node-local "gunzip -c | mariadb mysql && mariadb -e 'FLUSH PRIVILEGES;'"`;
  const res = await execOnVps(cmd);
  console.log('Result:', res);
}

syncMysqlUsers().catch(console.error);
