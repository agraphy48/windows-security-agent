const { spawn } = require('child_process');

function execOnVps(commandString) {
  return new Promise((resolve, reject) => {
    const p = spawn('plink', ['-batch', '-pw', '11011995Di@n', 'root@192.168.18.81', 'ssh node-vps bash -s'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    p.stdin.write(commandString + '\n');
    p.stdin.end();
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => {
      resolve({ code, stdout: out, stderr: err });
    });
    p.on('error', reject);
  });
}

if (require.main === module) {
  const cmd = process.argv.slice(2).join(' ') || 'hostname';
  execOnVps(cmd).then(res => {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    process.exit(res.code);
  }).catch(e => {
    console.error('Execution error:', e);
    process.exit(1);
  });
}

module.exports = { execOnVps };
