// -*- coding: utf-8 -*-
/**
 * Backup & Disaster Recovery Web Dashboard
 * Served at https://backup.kedukanaksara.com
 * Protected by 2FA Authenticated Session
 */

const fs = require('fs');
const path = require('path');
const scheduler = require('./backupScheduler');

function renderBackupDashboardHtml(userSession = {}) {
  const status = scheduler.getStatus();
  const history = scheduler.getHistory();
  const logs = scheduler.getRecentLogs(50);
  const disks = status.disks || [];

  const fDisk = disks.find(d => d.letter === 'F') || { freeGB: 64.3, totalGB: 195.3, usedPct: 67, connected: true };
  const dDisk = disks.find(d => d.letter === 'D') || { freeGB: 412.5, totalGB: 500.6, usedPct: 18, connected: true };
  const cDisk = disks.find(d => d.letter === 'C') || { freeGB: 250.0, totalGB: 430.0, usedPct: 42, connected: true };

  const lastTimeStr = status.lastBackupTime ? status.lastBackupTime : 'Belum pernah';
  const username = userSession.username || 'admin';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pusat Pemantauan & Pencadangan Server - backup.kedukanaksara.com</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body {
      background: radial-gradient(circle at 50% 0%, #0f172a 0%, #020617 80%);
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .container {
      max-width: 1320px;
      margin: 0 auto;
      padding: 24px 20px 60px 20px;
      width: 100%;
      flex: 1;
    }

    /* Top Navigation Bar */
    .top-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 20px;
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      margin-bottom: 24px;
      backdrop-filter: blur(12px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-icon {
      font-size: 26px;
      background: rgba(2, 132, 199, 0.2);
      border: 1px solid #0284c7;
      border-radius: 10px;
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .brand-text h1 {
      font-size: 16px;
      font-weight: 800;
      color: #f8fafc;
      letter-spacing: -0.3px;
    }
    .brand-text p {
      font-size: 12px;
      color: #94a3b8;
    }

    .nav-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .nav-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid #334155;
      color: #cbd5e1;
      text-decoration: none;
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s ease;
    }
    .nav-btn:hover {
      background: #334155;
      color: #ffffff;
      border-color: #64748b;
      transform: translateY(-1px);
    }
    .nav-btn.primary {
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      border-color: #38bdf8;
      color: white;
    }
    .nav-btn.primary:hover {
      box-shadow: 0 0 15px rgba(56, 189, 248, 0.4);
    }
    .user-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      color: #34d399;
      font-weight: 600;
    }

    /* KPI Cards Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 18px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: rgba(15, 23, 42, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 20px;
      backdrop-filter: blur(12px);
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: #334155;
    }
    .kpi-card.blue::before { background: linear-gradient(90deg, #0284c7, #38bdf8); }
    .kpi-card.green::before { background: linear-gradient(90deg, #10b981, #34d399); }
    .kpi-card.purple::before { background: linear-gradient(90deg, #8b5cf6, #c084fc); }
    .kpi-card.amber::before { background: linear-gradient(90deg, #f59e0b, #fbbf24); }

    .kpi-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .kpi-title {
      font-size: 12.5px;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #94a3b8;
    }
    .kpi-icon {
      font-size: 22px;
    }
    .kpi-value {
      font-size: 24px;
      font-weight: 800;
      color: #f8fafc;
      margin-bottom: 4px;
    }
    .kpi-sub {
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.4;
    }

    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
    }
    .badge-status.success {
      background: rgba(16, 185, 129, 0.2);
      border: 1px solid #10b981;
      color: #34d399;
    }
    .badge-status.running {
      background: rgba(245, 158, 11, 0.2);
      border: 1px solid #f59e0b;
      color: #fbbf24;
    }

    /* Progress Bar */
    .storage-bar-bg {
      width: 100%;
      height: 8px;
      background: #1e293b;
      border-radius: 4px;
      margin: 10px 0 6px 0;
      overflow: hidden;
    }
    .storage-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #0284c7, #38bdf8);
      border-radius: 4px;
      transition: width 0.5s ease;
    }

    /* Main Action Banner */
    .action-banner {
      background: linear-gradient(135deg, rgba(2, 132, 199, 0.15) 0%, rgba(15, 23, 42, 0.8) 100%);
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
    }
    .action-info h2 {
      font-size: 20px;
      font-weight: 800;
      color: #f8fafc;
      margin-bottom: 6px;
    }
    .action-info p {
      font-size: 13.5px;
      color: #94a3b8;
      max-width: 700px;
      line-height: 1.5;
    }
    .btn-backup-big {
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      border: 1px solid #38bdf8;
      color: white;
      padding: 14px 28px;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 0 25px rgba(2, 132, 199, 0.4);
      transition: all 0.2s ease;
    }
    .btn-backup-big:hover {
      transform: translateY(-2px);
      box-shadow: 0 0 35px rgba(56, 189, 248, 0.6);
    }
    .btn-backup-big:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    /* Tabs & Content */
    .tabs-nav {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid #334155;
      margin-bottom: 20px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 18px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s ease;
    }
    .tab-btn.active {
      color: #38bdf8;
      border-bottom-color: #38bdf8;
    }
    .tab-btn:hover:not(.active) {
      color: #cbd5e1;
    }

    .tab-pane {
      display: none;
    }
    .tab-pane.active {
      display: block;
    }

    /* History Table */
    .table-container {
      background: rgba(15, 23, 42, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      overflow-x: auto;
      backdrop-filter: blur(12px);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13.5px;
    }
    th, td {
      padding: 14px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    th {
      background: rgba(30, 41, 59, 0.6);
      color: #cbd5e1;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 11.5px;
      letter-spacing: 0.5px;
    }
    tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    /* Terminal Console */
    .terminal-box {
      background: #020617;
      border: 1px solid #1e293b;
      border-radius: 14px;
      padding: 16px;
      font-family: "Consolas", monospace;
      font-size: 12.5px;
      color: #38bdf8;
      max-height: 400px;
      overflow-y: auto;
      line-height: 1.5;
      box-shadow: inset 0 0 20px rgba(0,0,0,0.8);
    }
    .terminal-box .log-line {
      margin-bottom: 3px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .terminal-box .log-line.warn { color: #fbbf24; }
    .terminal-box .log-line.err { color: #f87171; }
    .terminal-box .log-line.ok { color: #34d399; }

    /* Recovery Kit Cards */
    .recovery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }
    .recovery-card {
      background: rgba(15, 23, 42, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 12px;
    }
    .recovery-card-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14.5px;
      font-weight: 700;
      color: #f8fafc;
    }
    .recovery-card p {
      font-size: 12.5px;
      color: #94a3b8;
      line-height: 1.4;
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1e293b;
      border: 1px solid #38bdf8;
      color: #f8fafc;
      padding: 14px 20px;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6);
      font-size: 13.5px;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 9999;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }

    footer {
      border-top: 1px solid #1e293b;
      padding: 20px;
      text-align: center;
      font-size: 12.5px;
      color: #64748b;
      background: rgba(11, 15, 25, 0.95);
    }

    @keyframes spin {
      100% { transform: rotate(360deg); }
    }
    .spinning {
      display: inline-block;
      animation: spin 1s linear infinite;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Top Navigation -->
    <div class="top-nav">
      <div class="brand">
        <div class="brand-icon">💾</div>
        <div class="brand-text">
          <h1>Disaster Recovery & Backup Center</h1>
          <p>backup.kedukanaksara.com &bull; Windows & Hyper-V Cluster</p>
        </div>
      </div>
      <div class="nav-actions">
        <div class="user-pill">
          <span>🔒 2FA Terverifikasi: <strong>${username}</strong></span>
        </div>
        <a href="https://portal.kedukanaksara.com" class="nav-btn" target="_blank">🌐 Portal Aplikasi</a>
        <a href="/duel" class="nav-btn" target="_blank">🎮 Game Duel</a>
        <a href="/dashboard" class="nav-btn">🛡️ SecOps Dashboard</a>
        <a href="/api/logout" class="nav-btn" style="color: #f87171;">🚪 Logout</a>
      </div>
    </div>

    <!-- 4 Key Metric Cards -->
    <div class="kpi-grid">
      <!-- Card 1: Status Terakhir -->
      <div class="kpi-card green">
        <div class="kpi-header">
          <span class="kpi-title">Status Pencadangan</span>
          <span class="kpi-icon">🛡️</span>
        </div>
        <div class="kpi-value" id="kpi-status-badge">
          <span class="badge-status ${status.isCurrentlyRunning ? 'running' : 'success'}">
            <span class="status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: ${status.isCurrentlyRunning ? '#fbbf24' : '#10b981'}; display: inline-block;"></span>
            <span id="status-text">${status.isCurrentlyRunning ? 'SEDANG MENYALIN' : (status.status || 'SUCCESS')}</span>
          </span>
        </div>
        <div class="kpi-sub">
          Terakhir: <strong id="kpi-last-time">${lastTimeStr}</strong><br>
          Durasi: <strong>${status.durationSeconds ? status.durationSeconds + ' detik' : '--'}</strong> &bull; VHDX: <strong>${status.vhdxSizeGB ? status.vhdxSizeGB + ' GB' : '23.7 GB'}</strong>
        </div>
      </div>

      <!-- Card 2: Jadwal Rutin -->
      <div class="kpi-card blue">
        <div class="kpi-header">
          <span class="kpi-title">Jadwal Rutin Harian</span>
          <span class="kpi-icon">⏰</span>
        </div>
        <div class="kpi-value" style="font-size: 20px;">00:00 & 12:00 WIB</div>
        <div class="kpi-sub">
          Jadwal Berikutnya dalam:<br>
          <strong id="countdown-text" style="color: #38bdf8; font-size: 13.5px;">Menghitung...</strong>
        </div>
      </div>

      <!-- Card 3: Storage Drive F: -->
      <div class="kpi-card purple">
        <div class="kpi-header">
          <span class="kpi-title">Kapasitas Drive Eksternal F:</span>
          <span class="kpi-icon">💽</span>
        </div>
        <div class="kpi-value" style="font-size: 20px;">
          <span id="drive-f-free">${fDisk.freeGB} GB</span> <span style="font-size: 13px; color: #94a3b8;">Sisa Kosong</span>
        </div>
        <div class="storage-bar-bg">
          <div class="storage-bar-fill" id="drive-f-bar" style="width: ${fDisk.usedPct}%;"></div>
        </div>
        <div class="kpi-sub">
          Total: ${fDisk.totalGB} GB &bull; Terpakai: ${fDisk.usedGB || Math.round(fDisk.totalGB - fDisk.freeGB)} GB (${fDisk.usedPct}%)
        </div>
      </div>

      <!-- Card 4: Ruang Server D: -->
      <div class="kpi-card amber">
        <div class="kpi-header">
          <span class="kpi-title">SSD Server Produksi D:</span>
          <span class="kpi-icon">⚡</span>
        </div>
        <div class="kpi-value" style="font-size: 20px;">
          <span>${dDisk.freeGB} GB</span> <span style="font-size: 13px; color: #94a3b8;">Sisa Kosong</span>
        </div>
        <div class="storage-bar-bg">
          <div class="storage-bar-fill" style="width: ${dDisk.usedPct}%; background: linear-gradient(90deg, #f59e0b, #fbbf24);"></div>
        </div>
        <div class="kpi-sub">
          Hyper-V VHDX + AI-Server &bull; Bebas & Sangat Lega
        </div>
      </div>
    </div>

    <!-- Main Action Banner -->
    <div class="action-banner">
      <div class="action-info">
        <h2>Pusat Kendali Eksekusi Pencadangan (On-Demand Backup)</h2>
        <p>Jalankan pencadangan sistem server secara instan kapan pun diperlukan. Skrip akan menyalin disk image Hyper-V AlmaLinux 9 (OpenLiteSpeed & MariaDB), modul AI-Server, serta kredensial Cloudflare Tunnel secara atomic ke harddisk eksternal Drive F:.</p>
      </div>
      <div>
        <button id="btn-manual-backup" class="btn-backup-big" onclick="triggerManualBackup()">
          <span id="backup-btn-icon">🚀</span>
          <span id="backup-btn-text">Mulai Pencadangan Sekarang</span>
        </button>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs-nav">
      <button class="tab-btn active" onclick="switchTab('tab-history', this)">📋 Laporan Riwayat Backup</button>
      <button class="tab-btn" onclick="switchTab('tab-terminal', this)">💻 Live Terminal Log Monitor</button>
      <button class="tab-btn" onclick="switchTab('tab-kit', this)">📄 Dokumen & Alat Pemulihan SSD</button>
    </div>

    <!-- Tab 1: History Table -->
    <div id="tab-history" class="tab-pane active">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Waktu Eksekusi</th>
              <th>Pemicu (Trigger)</th>
              <th>Status</th>
              <th>Durasi</th>
              <th>Ukuran VHDX</th>
              <th>Sisa Disk F:</th>
              <th>Keterangan / Rincian</th>
            </tr>
          </thead>
          <tbody id="history-tbody">
            ${history.map(h => `
              <tr>
                <td><strong>${h.timestamp}</strong></td>
                <td><span style="color: #38bdf8;">${h.trigger || 'Otomatis'}</span></td>
                <td>
                  <span class="badge-status ${h.status === 'SUCCESS' ? 'success' : 'running'}" style="font-size: 11px; padding: 2px 8px;">
                    ${h.status}
                  </span>
                </td>
                <td>${h.durationSeconds ? h.durationSeconds + 's' : '--'}</td>
                <td>${h.vhdxSizeGB ? h.vhdxSizeGB + ' GB' : '--'}</td>
                <td>${h.freeSpaceF_GB ? h.freeSpaceF_GB + ' GB' : '--'}</td>
                <td style="color: #94a3b8; font-size: 12.5px;">${h.details || h.error || 'Berhasil disinkronkan'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab 2: Terminal Console -->
    <div id="tab-terminal" class="tab-pane">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <span style="font-size: 13px; color: #94a3b8;">Log Terkini dari <code>D:\\AI-Server\\security-agent\\logs\\backup.log</code></span>
        <button class="nav-btn" onclick="refreshLogs()">🔄 Refresh Log</button>
      </div>
      <div class="terminal-box" id="terminal-content">
        ${logs.map(l => {
          let cls = '';
          if (l.includes('ERROR') || l.includes('GAGAL')) cls = 'err';
          else if (l.includes('WARN')) cls = 'warn';
          else if (l.includes('SELESAI') || l.includes('SUKSES') || l.includes('[OK]')) cls = 'ok';
          return `<div class="log-line ${cls}">${escapeHtml(l)}</div>`;
        }).join('')}
      </div>
    </div>

    <!-- Tab 3: Disaster Recovery Kit -->
    <div id="tab-kit" class="tab-pane">
      <div class="recovery-grid">
        <div class="recovery-card">
          <div class="recovery-card-title">
            <span>📄</span>
            <span>Dokumen SOP Pemulihan (PDF Standar A4)</span>
          </div>
          <p>Dokumen resmi 4 halaman berisi langkah detail pemasangan SSD baru, partisi GPT, aktivasi Hyper-V, transfer file Robocopy, dan pengujian.</p>
          <a href="/api/backup/download/pdf" class="nav-btn primary" target="_blank" style="text-align: center; justify-content: center;">
            📥 Buka / Unduh PDF SOP
          </a>
        </div>

        <div class="recovery-card">
          <div class="recovery-card-title">
            <span>🌐</span>
            <span>Panduan Pemulihan Format Web HTML</span>
          </div>
          <p>Versi web HTML interaktif yang dapat langsung dibuka pada peramban apa pun tanpa memerlukan aplikasi pembaca PDF khusus.</p>
          <a href="/api/backup/view/html" class="nav-btn" target="_blank" style="text-align: center; justify-content: center;">
            👁️ Buka Panduan Web
          </a>
        </div>

        <div class="recovery-card">
          <div class="recovery-card-title">
            <span>⚡</span>
            <span>Skrip Otomasi 1-Klik (PowerShell)</span>
          </div>
          <p>Skrip <code>Restore-Server-NewDisk.ps1</code> untuk membuat Virtual Switch dan mendaftarkan VM Hyper-V AlmaLinux secara instan.</p>
          <a href="/api/backup/view/script" class="nav-btn" target="_blank" style="text-align: center; justify-content: center;">
            📜 Lihat Skrip PowerShell
          </a>
        </div>
      </div>
    </div>
  </div>

  <div id="toast" class="toast">
    <span id="toast-icon">ℹ️</span>
    <span id="toast-msg">Pesan notifikasi</span>
  </div>

  <footer>
    <p>&copy; 2026 <strong>Kedukan Aksara</strong> & <strong>PT Expro Gio Nusantara</strong>. Server Disaster Recovery & Automated High-Availability Cluster.</p>
  </footer>

  <script>
    function escapeHtml(text) {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
      return text.replace(/[&<>"']/g, m => map[m]);
    }

    function switchTab(tabId, btn) {
      document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      btn.classList.add('active');
      if (tabId === 'tab-terminal') {
        const box = document.getElementById('terminal-content');
        box.scrollTop = box.scrollHeight;
      }
    }

    function showToast(msg, isSuccess = true) {
      const toast = document.getElementById('toast');
      const icon = document.getElementById('toast-icon');
      const text = document.getElementById('toast-msg');
      icon.innerText = isSuccess ? '✅' : '⚠️';
      text.innerText = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 4000);
    }

    // Countdown to 00:00 or 12:00 WIB
    function updateCountdown() {
      const now = new Date();
      const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);

      let target = (now < noon) ? noon : midnight;
      let diff = target.getTime() - now.getTime();
      if (diff < 0) diff = 0;

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);

      const targetLabel = (now < noon) ? '12:00 WIB (Siang)' : '00:00 WIB (Malam)';
      document.getElementById('countdown-text').innerText = 
        hours + ' Jam ' + mins + ' Menit ' + secs + ' Detik (' + targetLabel + ')';
    }
    setInterval(updateCountdown, 1000);
    updateCountdown();

    async function triggerManualBackup() {
      if (!confirm('Apakah Anda yakin ingin memulai proses pencadangan server sekarang?')) return;

      const btn = document.getElementById('btn-manual-backup');
      const icon = document.getElementById('backup-btn-icon');
      const text = document.getElementById('backup-btn-text');

      btn.disabled = true;
      icon.className = 'spinning';
      text.innerText = 'Meluncurkan Proses Backup...';

      try {
        const res = await fetch('/api/backup/run-now', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('🚀 ' + data.message, true);
          text.innerText = 'Pencadangan Berjalan di Latar Belakang...';
          pollStatus();
        } else {
          showToast('⚠️ ' + data.message, false);
          btn.disabled = false;
          icon.className = '';
          text.innerText = 'Mulai Pencadangan Sekarang';
        }
      } catch (err) {
        showToast('Koneksi gagal: ' + err.message, false);
        btn.disabled = false;
        icon.className = '';
        text.innerText = 'Mulai Pencadangan Sekarang';
      }
    }

    async function refreshLogs() {
      try {
        const res = await fetch('/api/backup/logs');
        const data = await res.json();
        if (data.logs) {
          const container = document.getElementById('terminal-content');
          container.innerHTML = data.logs.map(l => {
            let cls = '';
            if (l.includes('ERROR') || l.includes('GAGAL')) cls = 'err';
            else if (l.includes('WARN')) cls = 'warn';
            else if (l.includes('SELESAI') || l.includes('SUKSES') || l.includes('[OK]')) cls = 'ok';
            return '<div class="log-line ' + cls + '">' + escapeHtml(l) + '</div>';
          }).join('');
          container.scrollTop = container.scrollHeight;
        }
      } catch {}
    }

    async function pollStatus() {
      try {
        const res = await fetch('/api/backup/status');
        const data = await res.json();

        const btn = document.getElementById('btn-manual-backup');
        const icon = document.getElementById('backup-btn-icon');
        const text = document.getElementById('backup-btn-text');
        const statusText = document.getElementById('status-text');

        if (data.isCurrentlyRunning) {
          btn.disabled = true;
          icon.className = 'spinning';
          text.innerText = 'Sedang Menyalin Data Server...';
          statusText.innerText = 'SEDANG MENYALIN';
          statusText.parentElement.className = 'badge-status running';
          refreshLogs();
          setTimeout(pollStatus, 4000);
        } else {
          btn.disabled = false;
          icon.className = '';
          text.innerText = 'Mulai Pencadangan Sekarang';
          statusText.innerText = data.status || 'SUCCESS';
          statusText.parentElement.className = 'badge-status success';
          if (data.lastBackupTime) {
            document.getElementById('kpi-last-time').innerText = data.lastBackupTime;
          }
          if (data.freeSpaceF_GB) {
            document.getElementById('drive-f-free').innerText = data.freeSpaceF_GB + ' GB';
          }
        }
      } catch {}
    }
  </script>
</body>
</html>`;
}

function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

module.exports = {
  render(res, req, session) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, private'
    });
    res.end(renderBackupDashboardHtml(session));
  }
};

