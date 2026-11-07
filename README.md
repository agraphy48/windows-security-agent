# 🛡️ Server Security Guard Agent (WhatsApp Bot) - Cross Platform

Agen pemantau keamanan dan kesehatan server cerdas yang mendukung **Windows** dan **Linux (Ubuntu/Debian/CentOS)**, dapat dikendalikan secara interaktif langsung melalui **WhatsApp** menggunakan **Scan QR Code**.

Dilengkapi dengan integrasi **Windows Defender / ClamAV**, **Firewall (Windows Firewall / UFW / IPTables)**, **Docker**, pemantauan performa real-time, dan sistem peringatan proaktif (*watcher*) otomatis jika server terserang virus atau mengalami brute-force SSH.

---

## 🚀 Fitur Utama

- 📱 **Kendali Penuh via WhatsApp:** Cukup kirim kata kunci `monitor` untuk menampilkan panel menu bernomor (1 - 11).
- 🌐 **Otomatis Deteksi OS:** Kode secara cerdas mendeteksi apakah berjalan di Windows atau Linux dan mengeksekusi modul keamanan yang sesuai.
- 🚨 **Proactive Threat Alert:**
  - **Windows:** Mendeteksi virus/malware melalui Windows Defender API secara real-time.
  - **Linux:** Mendeteksi percobaan bobol SSH (Brute-Force) melalui Fail2ban / auth.log dan melaporkan IP yang diblokir.
- ⚡ **Resource Spike Warning:** Peringatan instan jika pemakaian CPU > 90% secara terus-menerus.
- 🔍 **Antivirus On-Demand:** Memicu *Quick Scan* atau *Full Scan* (Windows Defender di Windows atau ClamAV di Linux).
- 🔌 **Port & Network Inspection:** Memindai port TCP yang sedang mendengar (*LISTENING*) beserta nama proses dan PID-nya.
- 🐳 **Manajemen Docker:** Cek status container dan restart container yang bermasalah langsung dari chat (Cross-Platform).
- 🧱 **Firewall Control:** Blokir alamat IP yang mencurigakan (Windows Firewall di Windows atau UFW / IPTables di Linux).
- 🔒 **Emergency Lockdown:** Fitur darurat untuk memutus tunnel Cloudflare seketika jika server disusupi dari jaringan publik.
- 🧠 **AI Fallback (Ollama):** Mampu menjawab konsultasi dan diskusi teknis seputar kondisi server menggunakan model lokal (Llama 3.2 3B).

---

## 📋 Prasyarat Sistem

### A. Jika Menggunakan Server Windows
1. Windows 10, Windows 11, atau Windows Server 2016/2019/2022.
2. Node.js versi 18.x atau yang lebih baru.
3. Jalankan terminal / Command Prompt dengan **Run as Administrator**.

### B. Jika Menggunakan Server Linux (Ubuntu / Debian / CentOS)
1. Ubuntu 20.04+, Debian 11+, atau CentOS/RHEL/AlmaLinux 8+.
2. Node.js versi 18.x atau yang lebih baru (`sudo apt install nodejs npm`).
3. *(Direkomendasikan)* Paket keamanan Linux:
   ```bash
   sudo apt update && sudo apt install -y clamav ufw fail2ban
   ```

---

## 🛠️ Panduan Instalasi

### 1. Kloning Repositori
```bash
git clone https://github.com/<username-anda>/windows-security-agent.git
cd windows-security-agent
```

### 2. Pasang Dependensi
```bash
npm install
```

### 3. Konfigurasi Lingkungan (`.env`)
Salin file template `.env.example` menjadi `.env`:
* **Windows:**
  ```cmd
  copy .env.example .env
  ```
* **Linux:**
  ```bash
  cp .env.example .env
  ```

Buka `.env` dan atur konfigurasi:
```env
ADMIN_NUMBERS=6281234567890
QR_PORT=5005
WATCHER_INTERVAL_SECONDS=30
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2:3b
```

### 4. Menjalankan Agen

* **Di Windows:**
  Cukup klik dua kali **`start.bat`** atau jalankan:
  ```cmd
  npm start
  ```

* **Di Linux (Manual):**
  ```bash
  chmod +x start.sh
  ./start.sh
  ```

* **Di Linux (Sebagai Background Daemon 24/7 dengan Systemd):**
  ```bash
  sudo cp security-agent.service /etc/systemd/system/
  # Sesuaikan WorkingDirectory di file service jika diletakkan di luar /opt/security-agent
  sudo systemctl daemon-reload
  sudo systemctl enable --now security-agent
  ```

---

## 📲 Menghubungkan ke WhatsApp

1. Saat agen pertama kali dijalankan, buka browser di PC/Server atau melalui IP lokal server:
   ```text
   http://localhost:5005
   ```
2. Buka aplikasi **WhatsApp** di smartphone Anda.
3. Buka menu **Pengaturan / Titik Tiga > Perangkat Tertaut > Tautkan Perangkat**.
4. Arahkan kamera ponsel ke QR Code yang muncul di layar web.
5. Setelah terhubung, sesi akan tersimpan aman di folder lokal `session_auth/`.

---

## 🎮 Daftar Perintah WhatsApp

Ketik **`monitor`** atau **`menu`** di WhatsApp untuk memunculkan menu kontrol:

| No | Perintah | Deskripsi Tindakan |
| :---: | :--- | :--- |
| **1** | `!help` | Menampilkan menu bantuan dan seluruh daftar perintah. |
| **2** | `!status` | Ringkasan pemakaian CPU, RAM, sisa harddisk, Uptime, & status Antivirus. |
| **3** | `!threats` | Riwayat ancaman / malware / brute force SSH yang terdeteksi dan diblokir. |
| **4** | `!scan` | Memicu **Quick Scan** antivirus di latar belakang. |
| **5** | `!scan-full` | Memicu **Full Scan** menyeluruh pada seluruh drive server. |
| **6** | `!ports` | Memindai port TCP aktif (80, 443, 3000, 5432, dll.) beserta proses pemiliknya. |
| **7** | `!docker` | Cek status seluruh container Docker yang sedang berjalan. |
| **8** | `8 <nama>` | Me-restart container Docker tertentu (contoh: `8 ujian_backend`). |
| **9** | `9 <IP>` | Menambahkan aturan blokir IP langsung ke Firewall (Windows Firewall / UFW). |
| **10** | `10` / `!lockdown` | **Mode Darurat:** Memutus Cloudflare Tunnel seketika jika diserang. |
| **11** | `11` / `!restore` | Mengaktifkan kembali Cloudflare Tunnel ke domain server. |

> **Tips:** Anda cukup membalas pesan bot dengan mengetik nomor pilihannya saja (misal: kirim pesan `2` untuk cek status).

---

## 🔐 Keamanan Berlapis (Defense in Depth)

- **Whitelist Nomor Ponsel:** Hanya nomor admin yang terdaftar yang dapat mengeksekusi perintah.
- **🚨 Notifikasi Penyusup (Intruder Alert):** Jika nomor asing/tidak dikenal mencoba mengirim perintah atau pesan ke bot, akses otomatis diblokir diam-diam dan bot langsung mengirim pesan darurat ke WhatsApp Admin (`Nomor, Waktu, Isi Pesan`).
- **🔑 Verifikasi PIN 2-Factor Authentication:** Perintah berisiko tinggi (Restart container, Blokir Firewall, dan Emergency Lockdown) diwajibkan konfirmasi PIN keamanan (default: `1234` di `.env`).
- **Kredensial Sesi Terisolasi:** Kunci otentikasi WhatsApp (`session_auth/`) dan file rahasia (`.env`) otomatis diabaikan oleh `.gitignore` sehingga **TIDAK PERNAH** terunggah ke repositori GitHub.
- **Safe Command Mapping:** Sistem tidak menjalankan raw shell bebas untuk mencegah serangan *Prompt Injection* dan *Command Injection*. Semua parameter diperiksa dengan regex ketat.

---

## 📄 Lisensi
MIT License - Bebas digunakan dan dikembangkan untuk kebutuhan server pribadi maupun perusahaan.
