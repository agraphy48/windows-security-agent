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
    if (!clean || clean.length < 8) {
      throw new Error('Nomor WhatsApp tidak valid. Masukkan nomor minimal 8-15 digit angka (contoh: 628123456789 atau 08123456789).');
    }

    const existingIndex = this.contacts.findIndex(c => c.number === clean);
    if (existingIndex >= 0) {
      // Update kontak yang sudah ada
      this.contacts[existingIndex].name = name || this.contacts[existingIndex].name;
      this.contacts[existingIndex].role = role || this.contacts[existingIndex].role;
      this.contacts[existingIndex].alerts = Array.isArray(alerts) && alerts.length > 0 ? alerts : ['all'];
      this.contacts[existingIndex].active = true;
      this.contacts[existingIndex].updatedAt = new Date().toISOString();
      this.save();
      return { contact: this.contacts[existingIndex], updated: true };
    }

    const newContact = {
      id: 'cnt-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      number: clean,
      name: name || `Kontak ${clean.slice(-4)}`,
      role: role || 'Petugas Siaga',
      alerts: Array.isArray(alerts) && alerts.length > 0 ? alerts : ['all'],
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
    const clean = this.formatNumber(senderJid);
    return this.contacts.some(c => c.active !== false && c.number === clean);
  }
}

module.exports = new ContactsManager();

