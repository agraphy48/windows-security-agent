const { execOnVps } = require('./vps_exec');
const { execOnHyperV } = require('./run_on_hyperv');

async function main() {
  console.log('Backing up Hyper-V httpd_config.conf...');
  await execOnHyperV('cp /usr/local/lsws/conf/httpd_config.conf /usr/local/lsws/conf/httpd_config.conf.bak');

  console.log('Copying httpd_config.conf from VPS to Hyper-V...');
  const catRes = await execOnVps('cat /usr/local/lsws/conf/httpd_config.conf');
  const configContent = catRes.stdout;

  const base64 = Buffer.from(configContent, 'utf8').toString('base64');
  await execOnHyperV(`echo "${base64}" | base64 -d > /usr/local/lsws/conf/httpd_config.conf`);

  console.log('Testing OpenLiteSpeed configuration on Hyper-V...');
  const testRes = await execOnHyperV('/usr/local/lsws/bin/openlitespeed -t');
  console.log('Test result:', testRes.stdout, testRes.stderr);

  console.log('Restarting OpenLiteSpeed on Hyper-V...');
  const restartRes = await execOnHyperV('systemctl restart lsws && systemctl is-active lsws');
  console.log('Restart result:', restartRes.stdout || restartRes.stderr);
}

main().catch(console.error);
