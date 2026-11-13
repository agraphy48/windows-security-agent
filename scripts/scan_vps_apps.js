const { Client } = require('ssh2');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sshConfig = {
  host: '62.72.20.122',
  port: 22,
  username: 'root',
  privateKey: fs.readFileSync(path.join(os.homedir(), '.ssh', 'id_rsa'))
};

const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    echo "=== VHOSTS ==="
    ls -1 /usr/local/lsws/conf/vhosts/
    echo "=== HOME DIRS ==="
    ls -1 /home/
    echo "=== MARIADB DATABASES ==="
    mysql -e "SHOW DATABASES;" 2>/dev/null
  `, (err, stream) => {
    if (err) {
      console.error('Exec error:', err);
      conn.end();
      return;
    }
    let data = '';
    stream.on('data', chunk => { data += chunk; });
    stream.on('close', () => {
      console.log(data);
      conn.end();
    });
  });
}).on('error', err => {
  console.error('SSH Connection error:', err.message);
}).connect(sshConfig);

