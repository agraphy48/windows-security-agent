const { spawn } = require('child_process');
const fs = require('fs');

function execOnHyperV(cmdString) {
  return new Promise((resolve, reject) => {
    const cleanCmd = cmdString.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const p = spawn('plink', ['-batch', '-pw', '11011995Di@n', 'root@192.168.18.81', 'bash -s'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    p.stdin.write(cleanCmd + '\n');
    p.stdin.end();
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => resolve({ code, stdout: out, stderr: err }));
    p.on('error', reject);
  });
}

if (require.main === module) {
  let cmd = process.argv.slice(2).join(' ');
  if (!cmd) cmd = 'hostname';
  if (fs.existsSync(cmd)) {
    cmd = fs.readFileSync(cmd, 'utf8');
  }
  execOnHyperV(cmd).then(res => {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    process.exit(res.code);
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { execOnHyperV };
