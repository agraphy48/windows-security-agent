const { execOnHyperV } = require('./run_on_hyperv');

const users = [
  { db: 'agus_cv', user: 'agus_cv', pass: 'Qwerty!@#123' },
  { db: 'keu_egn', user: 'keu_egn', pass: 'cXt!V*HqPpmCw77I' },
  { db: 'kedu_aksara', user: 'kedu_aksara', pass: 'WC1RLlrh9uECze2p' },
  { db: 'polr_restapalembang', user: 'polr_restapalembang', pass: 'G2WR1HkyGNF3zPgI' },
  { db: 'polr_palembang', user: 'polr_palembang', pass: '2k6e4oRppjlKvTKT' },
  { db: 'pos_saas', user: 'pos_user', pass: 'PosSecure2026EgnPortal' },
  { db: 'toko_egn', user: 'agraphy', pass: 'Qwerty!@#' },
  { db: 'ukp_bimbel', user: 'ukp_bimbel', pass: 'Mc4s4KluzNlauTez' }
];

let sql = '';
for (const u of users) {
  sql += `
DROP USER IF EXISTS '${u.user}'@'localhost';
DROP USER IF EXISTS '${u.user}'@'127.0.0.1';
CREATE USER '${u.user}'@'localhost' IDENTIFIED BY '${u.pass}';
CREATE USER '${u.user}'@'127.0.0.1' IDENTIFIED BY '${u.pass}';
GRANT ALL PRIVILEGES ON \`${u.db}\`.* TO '${u.user}'@'localhost';
GRANT ALL PRIVILEGES ON \`${u.db}\`.* TO '${u.user}'@'127.0.0.1';
`;
}
sql += 'FLUSH PRIVILEGES;\n';

async function main() {
  console.log('Granting permissions for all mirror DB users on Hyper-V...');
  const res = await execOnHyperV(`mariadb << 'EOF'\n${sql}\nEOF\n`);
  console.log('SQL Result:', res);

  console.log('Testing each database connection...');
  for (const u of users) {
    const test = await execOnHyperV(`mariadb -u "${u.user}" -p"${u.pass}" -h 127.0.0.1 "${u.db}" -e "SELECT 1 as ok;" 2>/dev/null && echo "OK: ${u.db} (${u.user})" || echo "FAIL: ${u.db}"`);
    console.log(test.stdout.trim());
  }
}

main().catch(console.error);
