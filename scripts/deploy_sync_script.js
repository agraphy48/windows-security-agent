const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const scriptContent = fs.readFileSync(path.join(__dirname, 'sync-databases-to-local.sh'), 'utf8');

function execOnVps(commandString, inputData = null) {
  return new Promise((resolve, reject) => {
    const p = spawn('plink', ['-batch', '-pw', '11011995Di@n', 'root@192.168.18.81', 'ssh node-vps bash -s'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    if (inputData) {
      p.stdin.write(inputData);
    } else {
      p.stdin.write(commandString + '\n');
    }
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

async function main() {
  console.log('Deploying sync-databases-to-local.sh to VPS...');
  // Write to /root/sync-databases-to-local.sh on VPS
  const base64 = Buffer.from(scriptContent, 'utf8').toString('base64');
  const writeCmd = `echo "${base64}" | base64 -d > /root/sync-databases-to-local.sh && chmod +x /root/sync-databases-to-local.sh && ls -lh /root/sync-databases-to-local.sh`;
  const res = await execOnVps(writeCmd);
  console.log('Result:', res);
}

main().catch(console.error);
