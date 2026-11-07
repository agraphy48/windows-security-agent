const { exec } = require('child_process');
const path = require('path');
const config = require('./config');

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
  /**
   * Health metrics: CPU, RAM, Disk, Uptime
   */
  async getSystemHealth() {
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
      return { error: 'Gagal mengambil data kesehatan sistem' };
    }
  },

  /**
   * Status Windows Defender
   */
  async getDefenderStatus() {
    const script = `
      try {
        $status = Get-MpComputerStatus
        [PSCustomObject]@{
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
      return { error: 'Gagal query status Windows Defender' };
    }
  },

  /**
   * Ambil daftar deteksi ancaman / malware terbaru
   */
  async getRecentThreats(limit = 5) {
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
  },

  /**
   * Jalankan Quick Scan Windows Defender
   */
  async startQuickScan() {
    const script = `
      Start-Job -ScriptBlock { Start-MpScan -ScanType QuickScan } | Out-Null
      "Quick Scan berhasil dimulai di latar belakang."
    `;
    return await runPowerShell(script);
  },

  /**
   * Jalankan Full Scan Windows Defender
   */
  async startFullScan() {
    const script = `
      Start-Job -ScriptBlock { Start-MpScan -ScanType FullScan } | Out-Null
      "Full Scan sistem dimulai di latar belakang."
    `;
    return await runPowerShell(script);
  },

  /**
   * Cek port yang terbuka dan sedang LISTENING
   */
  async getListeningPorts() {
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
  },

  /**
   * Cek status container Docker
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
   * Restart safe docker container
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
   * Blokir IP di Windows Firewall
   */
  async blockIp(ip) {
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
      return 'Format IP tidak valid.';
    }
    const ruleName = `Block-Agent-${ip}`;
    const script = `
      New-NetFirewallRule -DisplayName "${ruleName}" -Direction Inbound -Action Block -RemoteAddress "${ip}" -Description "Blocked by Security Agent via WhatsApp"
      "IP $ip berhasil diblokir di Windows Firewall."
    `;
    try {
      return await runPowerShell(script);
    } catch (err) {
      return `Gagal memblokir IP: ${err.message}`;
    }
  },

  /**
   * Mode Darurat: Putus koneksi luar dengan mematikan Cloudflare Tunnel
   */
  async emergencyLockdown() {
    const script = `
      Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
      "🔒 EMERGENSI: Cloudflare Tunnel telah dihentikan. Akses dari domain luar terputus total."
    `;
    return await runPowerShell(script);
  },

  /**
   * Pulihkan Cloudflare Tunnel
   */
  async restoreCloudflare() {
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
};

module.exports = securityService;

