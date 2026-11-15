// -*- coding: utf-8 -*-
/**
 * Antigravity Command Bridge
 * Connects WhatsApp commands to Antigravity Task Queue on Windows Server
 * Directory: D:\AI-Server\antigravity-tasks
 */

const fs = require('fs');
const path = require('path');

const TASKS_DIR = path.resolve('D:\\AI-Server\\antigravity-tasks');
const INBOX_FILE = path.join(TASKS_DIR, 'inbox.json');
const HISTORY_FILE = path.join(TASKS_DIR, 'history.json');

class AntigravityBridge {
  constructor() {
    this.ensureDirs();
  }

  ensureDirs() {
    try {
      if (!fs.existsSync(TASKS_DIR)) {
        fs.mkdirSync(TASKS_DIR, { recursive: true });
      }
      if (!fs.existsSync(INBOX_FILE)) {
        fs.writeFileSync(INBOX_FILE, JSON.stringify([], null, 2), 'utf8');
      }
      if (!fs.existsSync(HISTORY_FILE)) {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2), 'utf8');
      }
    } catch (e) {
      console.error('[AntigravityBridge] Gagal inisialisasi direktori tugas:', e.message);
    }
  }

  getTasks() {
    this.ensureDirs();
    try {
      if (fs.existsSync(INBOX_FILE)) {
        const raw = fs.readFileSync(INBOX_FILE, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error('[AntigravityBridge] Gagal membaca inbox.json:', e.message);
    }
    return [];
  }

  saveTasks(tasks) {
    this.ensureDirs();
    try {
      fs.writeFileSync(INBOX_FILE, JSON.stringify(tasks, null, 2), 'utf8');
    } catch (e) {
      console.error('[AntigravityBridge] Gagal menyimpan inbox.json:', e.message);
    }
  }

  getHistory() {
    this.ensureDirs();
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {}
    return [];
  }

  saveHistory(history) {
    this.ensureDirs();
    try {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {}
  }

  enqueueTask(sender, prompt, channel = 'WhatsApp') {
    this.ensureDirs();
    const id = `AGY-${Date.now()}`;
    const now = new Date();
    const timestampStr = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';

    const task = {
      id,
      sender: String(sender || 'Admin'),
      channel,
      prompt: String(prompt || '').trim(),
      status: 'PENDING',
      createdAt: now.toISOString(),
      timestampStr,
      response: null,
      completedAt: null
    };

    const tasks = this.getTasks();
    tasks.unshift(task); // Masukkan di urutan teratas
    this.saveTasks(tasks);

    // Buat juga file instruksi Markdown mandiri agar mudah dibaca oleh developer / Antigravity IDE
    try {
      const taskMdFile = path.join(TASKS_DIR, `${id}.md`);
      const mdContent = `# Tugas Antigravity [${id}]
- **Pengirim:** ${task.sender} (${channel})
- **Waktu Masuk:** ${timestampStr}
- **Status:** PENDING

## Perintah / Prompt:
> ${task.prompt}

---
*Tugas ini siap dikerjakan oleh Antigravity Agent pada lingkungan Server Windows.*
`;
      fs.writeFileSync(taskMdFile, mdContent, 'utf8');
    } catch (e) {
      console.error('[AntigravityBridge] Gagal menulis task md:', e.message);
    }

    console.log(`[🚀 Antigravity Bridge] Tugas Baru Diterima dari ${sender}: "${prompt}" (ID: ${id})`);
    return {
      success: true,
      task
    };
  }

  getPendingTasks() {
    const tasks = this.getTasks();
    return tasks.filter(t => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
  }

  completeTask(id, responseText) {
    const tasks = this.getTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) {
      return { success: false, error: 'Task ID tidak ditemukan di inbox' };
    }

    const task = tasks[idx];
    task.status = 'COMPLETED';
    task.response = responseText;
    task.completedAt = new Date().toISOString();

    // Hapus dari inbox, masukkan ke history
    tasks.splice(idx, 1);
    this.saveTasks(tasks);

    const history = this.getHistory();
    history.unshift(task);
    this.saveHistory(history.slice(0, 100)); // Simpan 100 riwayat terakhir

    return { success: true, task };
  }

  getRecentTasks(limit = 10) {
    const inbox = this.getTasks();
    const history = this.getHistory();
    return [...inbox, ...history].slice(0, limit);
  }
}

module.exports = new AntigravityBridge();
