const { execOnHyperV } = require('./run_on_hyperv');

async function main() {
  const usersRes = await execOnHyperV("mariadb -e 'SELECT User, Host, plugin FROM mysql.user;'");
  console.log('Current mysql users:', usersRes.stdout);

  // In MariaDB, DROP USER IF EXISTS then CREATE USER
  const fixSql = `
DROP USER IF EXISTS 'pos_user'@'localhost';
DROP USER IF EXISTS 'pos_user'@'127.0.0.1';
DROP USER IF EXISTS 'pos_user'@'%';
CREATE USER 'pos_user'@'localhost' IDENTIFIED BY 'PosSecure2026EgnPortal';
CREATE USER 'pos_user'@'127.0.0.1' IDENTIFIED BY 'PosSecure2026EgnPortal';
GRANT ALL PRIVILEGES ON pos_saas.* TO 'pos_user'@'localhost';
GRANT ALL PRIVILEGES ON pos_saas.* TO 'pos_user'@'127.0.0.1';
FLUSH PRIVILEGES;
`;
  const res = await execOnHyperV(`mariadb << 'EOF'\n${fixSql}\nEOF\n`);
  console.log('Fix result:', res);

  const test = await execOnHyperV("mariadb -u pos_user -pPosSecure2026EgnPortal -h 127.0.0.1 pos_saas -e 'SELECT count(*) as total_packages FROM subscription_packages;'");
  console.log('Test output (127.0.0.1):', test.stdout || test.stderr);

  const testLocal = await execOnHyperV("mariadb -u pos_user -pPosSecure2026EgnPortal pos_saas -e 'SELECT count(*) as total_packages FROM subscription_packages;'");
  console.log('Test output (localhost):', testLocal.stdout || testLocal.stderr);
}

main().catch(console.error);
