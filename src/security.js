const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

function runPowerShell(script, timeoutMs = 35000) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    exec(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
      timeout: timeoutMs,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error && !stdout) {
        return reject(error);
      }
      resolve((stdout || '').trim());
    });
  });
}

function runBash(command, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, encoding: 'utf8', shell: '/bin/bash' }, (error, stdout, stderr) => {
      if (error && !stdout) {
        return reject(error);
      }
      resolve((stdout || stderr || '').trim());
    });
  });
}

function runCmd(command, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      if (error && !stdout) {
        return reject(error);
      }
      resolve((stdout || stderr || '').trim());
    });
  });
}

const securityService = {
  isWindows,
  isLinux,
  osName: isWindows ? 'Windows' : (isLinux ? 'Linux' : process.platform),

  /**
   * Health metrics: CPU, RAM, Disk, Uptime
   */
  async getSystemHealth() {
    if (isWindows) {
      const script = `
        try {
          $os = Get-CimInstance Win32_OperatingSystem
          $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
          $uptime = (Get-Date) - $os.LastBootUpTime
          $totalRamGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
          $freeRamGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
          $usedRamGB = [math]::Round($totalRamGB - $freeRamGB, 1)
          $ramPercent = [math]::Round(($usedRamGB / $totalRamGB) * 100, 1)

          $drives = @(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -ne $null } | ForEach-Object {
            [PSCustomObject]@{
              Name = $_.Name
              FreeGB = [math]::Round($_.Free / 1GB, 1)
              UsedGB = [math]::Round($_.Used / 1GB, 1)
              TotalGB = [math]::Round(($_.Free + $_.Used) / 1GB, 1)
            }
          })

          [PSCustomObject]@{
            OS = "Windows"
            CPU = [math]::Round($cpu, 1)
            TotalRamGB = $totalRamGB
            UsedRamGB = $usedRamGB
            FreeRamGB = $freeRamGB
            RamPercent = $ramPercent
            Uptime = "$($uptime.Days)h $($uptime.Hours)j $($uptime.Minutes)m"
            Drives = $drives
          } | ConvertTo-Json -Depth 3
        } catch {
          "{}"
        }
      `;
      const res = await runPowerShell(script);
      try {
        return JSON.parse(res);
      } catch {
        return { error: 'Gagal query performa Windows' };
      }
    }

    // --- LINUX (Ubuntu / Debian / CentOS) ---
    try {
      const bashCmd = `
        CPU=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{printf "%.1f", 100 - $1}')
        UPTIME=$(uptime -p 2>/dev/null || uptime | awk -F'( |,|:)+' '{print $6,"jam",$7,"menit"}')
        TOTAL_RAM=$(free -m | awk '/Mem:/ {printf "%.1f", $2/1024}')
        USED_RAM=$(free -m | awk '/Mem:/ {printf "%.1f", $3/1024}')
        FREE_RAM=$(free -m | awk '/Mem:/ {printf "%.1f", $4/1024}')
        RAM_PCT=$(free | awk '/Mem:/ {printf "%.1f", $3/$2 * 100}')
        
        DRIVES=$(df -h -x tmpfs -x devtmpfs -x squashfs 2>/dev/null | awk 'NR>1 {printf "{\\"Name\\":\\"%s\\",\\"UsedGB\\":\\"%s\\",\\"TotalGB\\":\\"%s\\",\\"FreeGB\\":\\"%s\\"},", $6, $3, $2, $4}')
        DRIVES="[\${DRIVES%,}]"
        
        cat <<EOF
{
  "OS": "Linux",
  "CPU": \${CPU:-0},
  "TotalRamGB": \${TOTAL_RAM:-0},
  "UsedRamGB": \${USED_RAM:-0},
  "FreeRamGB": \${FREE_RAM:-0},
  "RamPercent": \${RAM_PCT:-0},
  "Uptime": "\$UPTIME",
  "Drives": \$DRIVES
}
EOF
      `;
      const res = await runBash(bashCmd);
      return JSON.parse(res);
    } catch (err) {
      return { OS: 'Linux', CPU: 0, TotalRamGB: 0, UsedRamGB: 0, FreeRamGB: 0, RamPercent: 0, Uptime: 'N/A', Drives: [] };
    }
  },

  /**
   * Status Antivirus (Windows Defender atau ClamAV/Fail2ban di Linux)
   */
  async getDefenderStatus() {
    if (isWindows) {
      const script = `
        try {
          $status = Get-MpComputerStatus
          [PSCustomObject]@{
            Name = "Windows Defender"
            AntivirusEnabled = $status.AntivirusEnabled
            RealTimeProtection = $status.RealTimeProtectionEnabled
            IoavProtection = $status.IoavProtectionEnabled
            AntispywareEnabled = $status.AntispywareEnabled
            QuickScanAgeDays = if ($status.QuickScanAge -ge 0 -and $status.QuickScanAge -lt 100000) { $status.QuickScanAge } else { -1 }
            FullScanAgeDays = if ($status.FullScanAge -ge 0 -and $status.FullScanAge -lt 100000) { $status.FullScanAge } else { -1 }
            EngineVersion = $status.AMEngineVersion
          } | ConvertTo-Json
        } catch {
          "{}"
        }
      `;
      const res = await runPowerShell(script);
      try {
        return JSON.parse(res);
      } catch {
        return { error: 'Gagal query Windows Defender' };
      }
    }

    // --- LINUX (ClamAV & Fail2ban) ---
    try {
      const bashCmd = `
        CLAM_INSTALLED=$(which clamscan >/dev/null 2>&1 && echo "true" || echo "false")
        F2B_ACTIVE=$(systemctl is-active fail2ban >/dev/null 2>&1 && echo "true" || echo "false")
        UFW_ACTIVE=$(ufw status 2>/dev/null | grep -q "active" && echo "true" || echo "false")
        
        cat <<EOF
{
  "Name": "Linux Security Layer (ClamAV / Fail2ban / UFW)",
  "AntivirusEnabled": \$CLAM_INSTALLED,
  "RealTimeProtection": \$F2B_ACTIVE,
  "FirewallActive": \$UFW_ACTIVE,
  "QuickScanAgeDays": -1,
  "EngineVersion": "ClamAV/Fail2ban"
}
EOF
      `;
      const res = await runBash(bashCmd);
      return JSON.parse(res);
    } catch {
      return { Name: 'Linux Security', AntivirusEnabled: false, RealTimeProtection: false };
    }
  },

  /**
   * Ambil daftar deteksi ancaman / malware / brute force terbaru
   */
  async getRecentThreats(limit = 5) {
    if (isWindows) {
      const script = `
        try {
          $detections = @(Get-MpThreatDetection | Select-Object -First ${limit})
          $allThreats = @(Get-MpThreat)
          $list = @()
          foreach ($d in $detections) {
            $matched = $allThreats | Where-Object { $_.ThreatID -eq $d.ThreatID } | Select-Object -First 1
            $list += [PSCustomObject]@{
              DetectionID = $d.DetectionID
              ThreatName = if ($matched) { $matched.ThreatName } else { "Threat ID: $($d.ThreatID)" }
              Time = $d.InitialDetectionTime.ToString("yyyy-MM-dd HH:mm:ss")
              Resources = ($d.Resources -join " | ")
              Remediated = ($d.CurrentThreatExecutionStatusID -eq 0)
            }
          }
          $list | ConvertTo-Json -Depth 2
        } catch {
          "[]"
        }
      `;
      const res = await runPowerShell(script);
      try {
        const parsed = JSON.parse(res);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    }

    // --- LINUX (Fail2ban Bans & ClamAV Log) ---
    try {
      const bashCmd = `
        if [ -f "/var/log/fail2ban.log" ]; then
          grep "Ban " /var/log/fail2ban.log | tail -n ${limit} | awk '{print $1,$2,"| Fail2ban Ban | IP:",$NF}'
        elif which fail2ban-client >/dev/null 2>&1; then
          fail2ban-client status sshd 2>/dev/null | grep "Banned IP list" | sed 's/.*://'
        fi
      `;
      const raw = await runBash(bashCmd);
      if (!raw) return [];
      const lines = raw.split('\n').filter(Boolean);
      return lines.map((line, idx) => ({
        DetectionID: `f2b-${Date.now()}-${idx}`,
        ThreatName: 'SSH Brute-Force Attempt (Blocked)',
        Time: new Date().toISOString().replace('T', ' ').substring(0, 19),
        Resources: line.trim(),
        Remediated: true
      }));
    } catch {
      return [];
    }
  },

  /**
   * Quick Scan
   */
  async startQuickScan() {
    if (isWindows) {
      const script = `
        Start-Job -ScriptBlock { Start-MpScan -ScanType QuickScan } | Out-Null
        "Quick Scan Windows Defender berhasil dimulai di latar belakang."
      `;
      return await runPowerShell(script);
    }

    // --- LINUX ---
    const linuxScan = `
      if which clamscan >/dev/null 2>&1; then
        nohup clamscan -r -i /home /tmp /var/www > /tmp/clamscan_quick.log 2>&1 &
        echo "Quick Scan ClamAV (/home, /tmp, /var/www) berjalan di background."
      else
        echo "ClamAV belum terpasang. Jalankan: sudo apt install clamav"
      fi
    `;
    return await runBash(linuxScan);
  },

  /**
   * Full Scan
   */
  async startFullScan() {
    if (isWindows) {
      const script = `
        Start-Job -ScriptBlock { Start-MpScan -ScanType FullScan } | Out-Null
        "Full Scan menyeluruh sistem dimulai di latar belakang."
      `;
      return await runPowerShell(script);
    }

    // --- LINUX ---
    const linuxFull = `
      if which clamscan >/dev/null 2>&1; then
        nohup clamscan -r -i --exclude-dir="^/sys" --exclude-dir="^/proc" --exclude-dir="^/dev" / > /tmp/clamscan_full.log 2>&1 &
        echo "Full Scan ClamAV pada seluruh disk berjalan di background."
      else
        echo "ClamAV belum terpasang. Jalankan: sudo apt install clamav"
      fi
    `;
    return await runBash(linuxFull);
  },

  /**
   * Cek port listening
   */
  async getListeningPorts() {
    if (isWindows) {
      const script = `
        try {
          $conns = Get-NetTCPConnection -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess
          $unique = $conns | Group-Object LocalPort | ForEach-Object { $_.Group[0] }
          $out = @()
          foreach ($c in $unique) {
            $pname = (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName
            $out += [PSCustomObject]@{
              Port = $c.LocalPort
              Address = $c.LocalAddress
              PID = $c.OwningProcess
              Process = if ($pname) { $pname } else { "System" }
            }
          }
          $out | Sort-Object Port | ConvertTo-Json -Depth 2
        } catch {
          "[]"
        }
      `;
      const res = await runPowerShell(script);
      try {
        const parsed = JSON.parse(res);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    }

    // --- LINUX (ss / netstat) ---
    try {
      const bashCmd = `
        ss -tulpn 2>/dev/null | awk 'NR>1 && /LISTEN/ {
          split($5, a, ":");
          port = a[length(a)];
          split($7, p, "\\"");
          pname = (length(p) >= 2) ? p[2] : "-";
          printf "{\\"Port\\":%s,\\"Address\\":\\"%s\\",\\"Process\\":\\"%s\\",\\"PID\\":0},", port, $5, pname
        }'
      `;
      const raw = await runBash(bashCmd);
      if (!raw) return [];
      const jsonStr = `[${raw.replace(/,$/, '')}]`;
      return JSON.parse(jsonStr);
    } catch {
      return [];
    }
  },

  /**
   * Cek status container Docker (Cross-Platform)
   */
  async getDockerStatus() {
    try {
      const raw = await runCmd('docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"');
      if (!raw) return 'Tidak ada container yang sedang berjalan.';
      const lines = raw.split('\n').filter(Boolean);
      return lines.map(l => {
        const parts = l.split('\t');
        return `• *${parts[0]}*: ${parts[1] || 'Running'}`;
      }).join('\n');
    } catch (err) {
      return `Gagal membaca Docker: ${err.message}`;
    }
  },

  /**
   * Restart docker container (Cross-Platform)
   */
  async restartDockerContainer(name) {
    if (!/^[a-zA-Z0-9_\-]+$/.test(name)) {
      return 'Nama container tidak valid.';
    }
    try {
      await runCmd(`docker restart ${name}`);
      return `✅ Container *${name}* berhasil di-restart.`;
    } catch (err) {
      return `❌ Gagal restart container *${name}*: ${err.message}`;
    }
  },

  /**
   * Blokir IP di Firewall (Windows Firewall vs UFW / IPTables Linux)
   */
  async blockIp(ip) {
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
      return 'Format IP tidak valid.';
    }

    if (isWindows) {
      const ruleName = `Block-Agent-${ip}`;
      const script = `
        New-NetFirewallRule -DisplayName "${ruleName}" -Direction Inbound -Action Block -RemoteAddress "${ip}" -Description "Blocked by Security Agent via WhatsApp"
        "IP $ip berhasil diblokir di Windows Firewall."
      `;
      try {
        return await runPowerShell(script);
      } catch (err) {
        return `Gagal memblokir IP di Windows: ${err.message}`;
      }
    }

    // --- LINUX (UFW / IPTables) ---
    const linuxBlock = `
      if which ufw >/dev/null 2>&1 && ufw status | grep -q "active"; then
        sudo ufw insert 1 deny from ${ip} to any >/dev/null 2>&1
        echo "IP ${ip} berhasil diblokir di UFW Linux."
      else
        sudo iptables -I INPUT -s ${ip} -j DROP
        echo "IP ${ip} berhasil diblokir di IPTables Linux."
      fi
    `;
    try {
      return await runBash(linuxBlock);
    } catch (err) {
      return `Gagal memblokir IP di Linux: ${err.message}`;
    }
  },

  /**
   * Mode Darurat: Putus koneksi luar (Cross-Platform)
   */
  async emergencyLockdown() {
    if (isWindows) {
      const script = `
        Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
        "🔒 EMERGENSI: Cloudflare Tunnel telah dihentikan. Akses dari domain luar terputus total."
      `;
      return await runPowerShell(script);
    }

    // --- LINUX ---
    const linuxLockdown = `
      pkill -f cloudflared || systemctl stop cloudflared 2>/dev/null
      echo "🔒 EMERGENSI: Cloudflare Tunnel dihentikan. Akses domain publik terputus total."
    `;
    return await runBash(linuxLockdown);
  },

  /**
   * Pulihkan Cloudflare Tunnel (Cross-Platform)
   */
  async restoreCloudflare() {
    if (isWindows) {
      const exe = config.cloudflareExe;
      const args = config.cloudflareArgs;
      const script = `
        $proc = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
        if (-not $proc) {
          if (Test-Path "${exe}") {
            Start-Process "${exe}" -ArgumentList "${args}" -WindowStyle Hidden
            "Cloudflare Tunnel berhasil diaktifkan kembali."
          } else {
            "Executable Cloudflare (${exe}) tidak ditemukan. Pastikan sudah terpasang atau konfigurasikan di .env."
          }
        } else {
          "Cloudflare Tunnel sudah aktif."
        }
      `;
      return await runPowerShell(script);
    }

    // --- LINUX ---
    const linuxRestore = `
      if systemctl list-unit-files | grep -q "cloudflared"; then
        systemctl start cloudflared
        echo "Cloudflare Tunnel service berhasil diaktifkan kembali."
      else
        nohup cloudflared tunnel run >/dev/null 2>&1 &
        echo "Cloudflare Tunnel diluncurkan kembali."
      fi
    `;
    return await runBash(linuxRestore);
  },

  /**
   * Deteksi seluruh layanan & aplikasi aktif (Cross-Platform)
   */
  async getDiscoveredServices() {
    if (isWindows) {
      const script = `
        try {
          $conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
          $portMap = @{}
          foreach ($c in $conns) {
            $pname = (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName
            if ($pname) {
              $pname = $pname.ToLower()
              if (-not $portMap.ContainsKey($pname)) { $portMap[$pname] = @() }
              $portMap[$pname] += "tcp:$($c.LocalPort)"
            }
          }

          $running = Get-Service | Where-Object Status -eq 'Running'
          $services = @()
          foreach ($s in $running) {
            $base = $s.Name.ToLower()
            $matchedPorts = @()
            if ($portMap.ContainsKey($base)) {
              $matchedPorts = $portMap[$base] | Select-Object -Unique
            }
            $isApp = ($matchedPorts.Count -gt 0) -or ($s.Name -match "(?i)docker|node|agent|ollama|web|http|sql|db|cloudflared|nginx|apache|tailscale|wireguard|secops")
            $services += [PSCustomObject]@{
              id = $s.Name
              unit = "$($s.Name).service"
              name = $s.Name
              displayName = $s.DisplayName
              status = "active"
              ports = $matchedPorts
              category = if ($isApp) { "application" } else { "system" }
            }
          }
          $services | Sort-Object @{Expression={if ($_.category -eq "application") {0} else {1}}}, name | ConvertTo-Json -Depth 3
        } catch {
          "[]"
        }
      `;
      try {
        const res = await runPowerShell(script);
        const parsed = JSON.parse(res);
        return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      } catch (err) {
        console.error('[getDiscoveredServices Windows Error]', err.message);
        return [];
      }
    }

    // --- LINUX (systemd & ss) ---
    try {
      const rawUnits = await runBash('systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null');
      const rawPorts = await runBash('ss -tulpn 2>/dev/null');

      const portMap = {};
      const portLines = (rawPorts || '').split('\n');
      for (const line of portLines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const proto = parts[0].toLowerCase();
          const localAddr = parts[4];
          const port = localAddr.split(':').pop();
          if (port && !isNaN(port)) {
            const userMatch = line.match(/users:\(\("([^"]+)"/);
            if (userMatch) {
              const procName = userMatch[1].toLowerCase();
              if (!portMap[procName]) portMap[procName] = new Set();
              portMap[procName].add(`${proto}:${port}`);
            }
          }
        }
      }

      const services = [];
      const unitLines = (rawUnits || '').split('\n').filter(Boolean);
      for (const line of unitLines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4 && parts[0].endsWith('.service')) {
          const unit = parts[0];
          const base = unit.replace('.service', '').toLowerCase();
          const desc = parts.slice(4).join(' ') || base;
          const status = parts[3] || 'active';

          // Match listening ports
          const matchedPorts = new Set();
          for (const [proc, pset] of Object.entries(portMap)) {
            if (
              proc === base ||
              base.includes(proc) ||
              proc.includes(base) ||
              (proc === 'litespeed' && base === 'lshttpd') ||
              (proc === 'mariadbd' && base === 'mariadb') ||
              (proc === 'pdns_server' && base === 'pdns')
            ) {
              for (const p of pset) matchedPorts.add(p);
            }
          }

          const isApp =
            matchedPorts.size > 0 ||
            /cyberpanel|lscpd|lsws|lshttpd|mariadb|mysql|redis|memcached|tailscale|security-agent|postfix|dovecot|pdns|pure-ftpd|opendkim|docker|nginx|apache|wireguard|wg-quick/.test(base);

          services.push({
            id: base,
            unit,
            name: base,
            displayName: desc,
            status,
            ports: Array.from(matchedPorts),
            category: isApp ? 'application' : 'system'
          });
        }
      }

      services.sort((a, b) => {
        if (a.category !== b.category) {
          return a.category === 'application' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return services;
    } catch (err) {
      console.error('[getDiscoveredServices Linux Error]', err.message);
      return [];
    }
  },

  /**
   * Ambil detail & log laporan layanan tertentu (Cross-Platform)
   */
  async getServiceDetail(serviceName) {
    if (!serviceName || !/^[a-zA-Z0-9_\-@\.]+$/.test(serviceName)) {
      return { error: 'Nama layanan tidak valid' };
    }

    if (isWindows) {
      const script = `
        try {
          $s = Get-Service -Name "${serviceName}" -ErrorAction Stop
          [PSCustomObject]@{
            name = $s.Name
            displayName = $s.DisplayName
            status = $s.Status.ToString()
            startType = $s.StartType.ToString()
            canStop = $s.CanStop
            recentLogs = "Windows Service running normally"
          } | ConvertTo-Json
        } catch {
          [PSCustomObject]@{ error = $_.Exception.Message } | ConvertTo-Json
        }
      `;
      try {
        const raw = await runPowerShell(script);
        return JSON.parse(raw);
      } catch (err) {
        return { error: err.message };
      }
    }

    // --- LINUX ---
    try {
      const unit = serviceName.endsWith('.service') ? serviceName : `${serviceName}.service`;
      const showOut = await runBash(`systemctl show ${unit} -p Description,ActiveState,SubState,MainPID,ExecMainStartTimestamp,MemoryCurrent 2>/dev/null`);
      const logsOut = await runBash(`journalctl -u ${unit} -n 10 --no-pager 2>/dev/null`);

      const props = {};
      (showOut || '').split('\n').forEach(l => {
        const idx = l.indexOf('=');
        if (idx !== -1) {
          props[l.substring(0, idx).trim()] = l.substring(idx + 1).trim();
        }
      });

      let memMb = 'N/A';
      if (props.MemoryCurrent && !isNaN(props.MemoryCurrent)) {
        memMb = `${(parseInt(props.MemoryCurrent, 10) / 1024 / 1024).toFixed(1)} MB`;
      }

      return {
        name: unit,
        displayName: props.Description || unit,
        status: `${props.ActiveState || 'unknown'} (${props.SubState || 'unknown'})`,
        mainPid: props.MainPID || 'N/A',
        startedAt: props.ExecMainStartTimestamp || 'N/A',
        memoryUsage: memMb,
        recentLogs: logsOut || 'Tidak ada log terbaru.'
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  /**
   * Restart layanan tertentu (Cross-Platform)
   */
  async restartService(serviceName) {
    if (!serviceName || !/^[a-zA-Z0-9_\-@\.]+$/.test(serviceName)) {
      return { error: 'Nama layanan tidak valid' };
    }

    if (isWindows) {
      const script = `Restart-Service -Name "${serviceName}" -Force; "Layanan ${serviceName} berhasil di-restart."`;
      try {
        const out = await runPowerShell(script);
        return { success: true, message: out };
      } catch (err) {
        return { error: err.message };
      }
    }

    // --- LINUX ---
    try {
      const unit = serviceName.endsWith('.service') ? serviceName : `${serviceName}.service`;
      await runBash(`systemctl restart ${unit}`);
      return { success: true, message: `Layanan ${unit} berhasil di-restart.` };
    } catch (err) {
      return { error: err.message };
    }
  }
};

module.exports = securityService;
