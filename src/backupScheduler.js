// -*- coding: utf-8 -*-
/**
 * SecOps Backup Scheduler
 * Manages periodic server disaster recovery backups at 00:00 (Midnight) and 12:00 (Noon) WIB
 * Integrates with Windows Task Scheduler and provides in-process scheduling & web API
 */

const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const STATUS_FILE = path.join(DATA_DIR, 'backup-status.json');
const LOCK_FILE = path.join(DATA_DIR, 'backup.lock');
const PYTHON_SCRIPT = path.join(SCRIPTS_DIR, 'run_scheduled_backup.py');

class BackupScheduler {
  constructor() {
    this.timer = null;
    this.isRunning = false;
  }

  getStatus() {
    try {
      if (fs.existsSync(STATUS_FILE)) {
        const raw = fs.readFileSync(STATUS_FILE, 'utf8');
        const data = JSON.parse(raw);
        data.isCurrentlyRunning = this.isBackupRunning();
        return data;
      }
    } catch (e) {
      console.error('[BackupScheduler] Error reading status:', e.message);
    }

    return {
      lastBackupTime: null,
      status: 'INITIALIZING',
      schedule: ['00:00', '12:00'],
      scheduleDescription: 'Setiap hari pukul 00:00 WIB (Tengah Malam) & 12:00 WIB (Siang)',
      isCurrentlyRunning: this.isBackupRunning(),
      nextScheduledRun: this.calculateNextRunTime().toISOString()
    };
  }

  isBackupRunning() {
    if (!fs.existsSync(LOCK_FILE)) return false;
    try {
      const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      const ageSec = (Date.now() - (lock.time * 1000)) / 1000;
      return ageSec < 1800; // running if lock is less than 30 mins old
    } catch {
      return false;
    }
  }

  calculateNextRunTime() {
    const now = new Date();
    const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
    const tomorrowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

    if (now < todayNoon) {
      return todayNoon;
    } else {
      return tomorrowMidnight;
    }
  }

  startScheduler() {
    this.scheduleNext();
    this.ensureWindowsTaskSchedulerTasks();
    console.log('[🛡️ Backup Scheduler] Aktif: Jadwal backup otomatis pukul 00:00 & 12:00 WIB');
  }

  scheduleNext() {
    if (this.timer) clearTimeout(this.timer);

    const nextRun = this.calculateNextRunTime();
    const delayMs = nextRun.getTime() - Date.now();

    console.log(`[🛡️ Backup Scheduler] Jadwal berikutnya pada ${nextRun.toLocaleString('id-ID')} (${Math.round(delayMs / 60000)} menit lagi)`);

    this.timer = setTimeout(() => {
      this.triggerBackup('SCHEDULED_TIMER');
      // Re-schedule for next interval
      setTimeout(() => this.scheduleNext(), 5000);
    }, delayMs);
  }

  triggerBackup(triggerSource = 'MANUAL') {
    if (this.isBackupRunning()) {
      return { success: false, message: 'Backup saat ini sedang berjalan di latar belakang.' };
    }

    console.log(`[🛡️ Backup Scheduler] Menjalankan backup otomatis (Sumber: ${triggerSource})...`);

    const pythonExe = fs.existsSync('C:\\Users\\agrap\\AppData\\Roaming\\uv\\python\\cpython-3.12-windows-x86_64-none\\python.exe')
      ? 'C:\\Users\\agrap\\AppData\\Roaming\\uv\\python\\cpython-3.12-windows-x86_64-none\\python.exe'
      : 'python';

    const child = spawn(pythonExe, [PYTHON_SCRIPT], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });

    child.unref();

    return {
      success: true,
      message: 'Proses pencadangan server berhasil diluncurkan di latar belakang.',
      pid: child.pid,
      startTime: new Date().toISOString()
    };
  }

  ensureWindowsTaskSchedulerTasks() {
    const taskNameMidnight = 'SecOps-Server-AutoBackup-Midnight';
    const taskNameNoon = 'SecOps-Server-AutoBackup-Noon';
    const runnerBat = path.join(SCRIPTS_DIR, 'run_backup.bat');

    // Register 00:00 task
    exec(`schtasks /query /TN "${taskNameMidnight}"`, (err) => {
      if (err) {
        const cmd = `schtasks /create /TN "${taskNameMidnight}" /TR "\\"${runnerBat}\\"" /SC DAILY /ST 00:00 /F`;
        exec(cmd, (cErr, cOut) => {
          if (!cErr) console.log(`[🛡️ Windows Task Scheduler] Berhasil mendaftarkan task: ${taskNameMidnight}`);
        });
      }
    });

    // Register 12:00 task
    exec(`schtasks /query /TN "${taskNameNoon}"`, (err) => {
      if (err) {
        const cmd = `schtasks /create /TN "${taskNameNoon}" /TR "\\"${runnerBat}\\"" /SC DAILY /ST 12:00 /F`;
        exec(cmd, (cErr, cOut) => {
          if (!cErr) console.log(`[🛡️ Windows Task Scheduler] Berhasil mendaftarkan task: ${taskNameNoon}`);
        });
      }
    });
  }
}

module.exports = new BackupScheduler();

