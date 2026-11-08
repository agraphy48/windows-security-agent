const fs = require('fs');
const path = require('path');
const config = require('./config');

class ContactsManager {
  constructor() {
    this.inventoryDir = path.join(__dirname, '..', 'inventory');
    this.filePath = path.join(this.inventoryDir, 'emergency_contacts.json');
    this.contacts = [];
    this.init();
  }

  init() {
    if (!fs.existsSync(this.inventoryDir)) {
      try {
        fs.mkdirSync(this.inventoryDir, { recursive: true });
      } catch (err) {
        console.error('[Contacts] Gagal membuat direktori inventory:', err.message);
      }
    }

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.contacts = JSON.parse(raw);
        console.log(`[📋 Contacts] Memuat ${this.contacts.length} kontak darurat dari inventory.`);
      } catch (err) {
        console.error('[Contacts] Gagal membaca emergency_contacts.json:', err.message);
        this.contacts = [];
      }
    }

    // Pastikan nomor admin default dari .env sudah ada di kontak
    if (config.adminNumbers && config.adminNumbers.length > 0) {
      let changed = false;
      for (const num of config.adminNumbers) {
        const clean = this.formatNumber(num);
        // Jika angka berupa ID internal WhatsApp LID (>= 15 digit):
        // kaitkan sebagai alias LID ke kontak utama agar tidak membuat kontak terpisah di UI
        if (clean && clean.length >= 15 && this.contacts.length > 0) {
          const primaryAdmin = this.contacts[0];
          if (primaryAdmin) {
            if (!primaryAdmin.lids) primaryAdmin.lids = [];
            if (!primaryAdmin.lids.includes(clean)) {
              primaryAdmin.lids.push(clean);
              primaryAdmin.lid = clean;
              changed = true;
            }
          }
          continue;
        }

        if (clean && !this.contacts.some(c => c.number === clean)) {
          this.contacts.push({
            id: 'cnt-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            number: clean,
            name: 'SysAdmin Utama (Default .env)',
            role: 'Super Admin',
            alerts: ['all'],
            active: true,
            createdAt: new Date().toISOString(),
            lastAlertSent: null
          });
          changed = true;
        }
      }
      if (changed) {
        this.save();
      }
    }

    this.syncWithConfig();
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.contacts, null, 2), 'utf-8');
      this.syncWithConfig();
      return true;
    } catch (err) {
      console.error('[Contacts] Gagal menyimpan emergency_contacts.json:', err.message);
      return false;
    }
  }

  formatNumber(input) {
    if (!input) return '';
    let clean = String(input).replace(/[^0-9]/g, '');
    // Jika diawali 08, konversi otomatis ke 628
    if (clean.startsWith('08')) {
      clean = '62' + clean.slice(1);
    }
    return clean;
  }

  syncWithConfig() {
    const activeNums = this.contacts
      .filter(c => c.active !== false)
      .map(c => c.number);

    for (const num of activeNums) {
      if (!config.adminNumbers.includes(num)) {
        config.adminNumbers.push(num);
      }
    }
  }

  getAll() {
    return this.contacts;
  }

  getActiveNumbers(category = null) {
    return this.contacts
      .filter(c => {
        if (c.active === false) return false;
        if (!category || category === 'all') return true;
        if (!c.alerts || c.alerts.includes('all')) return true;
        return c.alerts.includes(category);
      })
      .map(c => c.number);
  }

  addContact({ number, name, role = 'SysAdmin', alerts = ['all'] }) {
    const clean = this.formatNumber(number);
    if (!clean || clean.length < 8 || clean.length > 20) {
      throw new Error('Nomor WhatsApp tidak valid. Masukkan nomor 8-20 digit angka (contoh: 628123456789 atau 08123456789).');
    }

    // Sanitasi input teks untuk mencegah injeksi XSS / karakter berbahaya
    const safeName = String(name || `Kontak ${clean.slice(-4)}`)
      .replace(/[<>'"&]/g, '')
      .trim()
      .substring(0, 80);

    const safeRole = String(role || 'SysAdmin')
      .replace(/[<>'"&]/g, '')
      .trim()
      .substring(0, 50);

    const allowedAlerts = ['all', 'attack', 'server_down', 'service_discovery'];
    const safeAlerts = Array.isArray(alerts) && alerts.length > 0
      ? alerts.filter(a => allowedAlerts.includes(a))
      : ['all'];
    if (safeAlerts.length === 0) safeAlerts.push('all');

    const existingIndex = this.contacts.findIndex(c => c.number === clean);
    if (existingIndex >= 0) {
      // Update kontak yang sudah ada
      this.contacts[existingIndex].name = safeName || this.contacts[existingIndex].name;
      this.contacts[existingIndex].role = safeRole || this.contacts[existingIndex].role;
      this.contacts[existingIndex].alerts = safeAlerts;
      this.contacts[existingIndex].active = true;
      this.contacts[existingIndex].updatedAt = new Date().toISOString();
      this.save();
      return { contact: this.contacts[existingIndex], updated: true };
    }

    const newContact = {
      id: 'cnt-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      number: clean,
      name: safeName,
      role: safeRole,
      alerts: safeAlerts,
      active: true,
      createdAt: new Date().toISOString(),
      lastAlertSent: null
    };

    this.contacts.push(newContact);
    this.save();
    return { contact: newContact, created: true };
  }

  removeContact(idOrNumber) {
    const idx = this.contacts.findIndex(c => c.id === idOrNumber || c.number === idOrNumber);
    if (idx < 0) return false;
    const removed = this.contacts.splice(idx, 1)[0];

    // Hapus juga dari config.adminNumbers jika terdaftar di sana
    if (config.adminNumbers && config.adminNumbers.includes(removed.number)) {
      config.adminNumbers = config.adminNumbers.filter(n => n !== removed.number);
      try {
        const envPath = path.join(__dirname, '..', '.env');
        if (fs.existsSync(envPath)) {
          let content = fs.readFileSync(envPath, 'utf8');
          content = content.replace(/ADMIN_NUMBERS=.*/g, `ADMIN_NUMBERS=${config.adminNumbers.join(',')}`);
          fs.writeFileSync(envPath, content, 'utf8');
        }
      } catch (e) {
        console.error('[Contacts] Gagal update .env saat hapus kontak:', e.message);
      }
    }

    this.save();
    return removed;
  }

  toggleContact(id) {
    const contact = this.contacts.find(c => c.id === id);
    if (!contact) return null;
    contact.active = !contact.active;
    contact.updatedAt = new Date().toISOString();
    this.save();
    return contact;
  }

  updateLastAlert(number) {
    const clean = this.formatNumber(number);
    const contact = this.contacts.find(c => c.number === clean);
    if (contact) {
      contact.lastAlertSent = new Date().toISOString();
      this.save();
    }
  }

  isEmergencyContact(senderJid) {
    if (!senderJid) return false;
    const clean = String(senderJid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    return this.contacts.some(c => 
      c.active !== false && (
        c.number === clean ||
        c.id === senderJid ||
        (c.lid && c.lid === clean) ||
        (Array.isArray(c.lids) && c.lids.includes(clean))
      )
    );
  }

  attachLidToContact(numberOrId, lid) {
    const cleanLid = String(lid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (!cleanLid || cleanLid.length < 10) return false;
    const contact = this.contacts.find(c => c.id === numberOrId || c.number === numberOrId);
    if (contact) {
      if (!contact.lids) contact.lids = [];
      if (!contact.lids.includes(cleanLid)) {
        contact.lids.push(cleanLid);
      }
      contact.lid = cleanLid;
      this.save();
      console.log(`[Contacts] Ditautkan WhatsApp LID ${cleanLid} ke kontak ${contact.name} (${contact.number})`);
      return true;
    }
    return false;
  }
}

module.exports = new ContactsManager();

