const { execOnVps } = require('./vps_exec');
const { execOnHyperV } = require('./run_on_hyperv');

async function syncUsers() {
  console.log('Extracting cyberpanel users from VPS...');
  const passwdRes = await execOnVps("grep -E ':(500[2-9]|50[1-3][0-9]):' /etc/passwd");
  const groupRes = await execOnVps("grep -E ':(500[2-9]|50[1-3][0-9]):' /etc/group");
  const shadowRes = await execOnVps("grep -E '^(srvhs|expro|sekol|almac|smane|aguse|tokoe|jlppe|jasap|porta|berit|apipo|eduka|polre|agusp|sriwi|apisr|chatp|ragpo|uport|openwa|keupo|ukppo|pente|chatb|pener|pospo)' /etc/shadow");

  const passwdLines = (passwdRes.stdout || '').trim();
  const groupLines = (groupRes.stdout || '').trim();
  const shadowLines = (shadowRes.stdout || '').trim();

  console.log(`Found ${passwdLines.split('\n').filter(Boolean).length} users to sync.`);

  // Append to Hyper-V
  const appendCmd = `
cat << 'EOF' >> /etc/passwd
${passwdLines}
EOF

cat << 'EOF' >> /etc/group
${groupLines}
EOF

cat << 'EOF' >> /etc/shadow
${shadowLines}
EOF

echo "Users and groups appended successfully to Hyper-V."
`;

  const hypervRes = await execOnHyperV(appendCmd);
  console.log('Hyper-V result:', hypervRes.stdout || hypervRes.stderr);
}

syncUsers().catch(console.error);

