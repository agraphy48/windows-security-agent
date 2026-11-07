# 🛡️ Windows Security Guard Agent (WhatsApp Bot)

Agen pemantau keamanan dan kesehatan server Windows cerdas yang dapat dikendalikan secara interaktif langsung melalui **WhatsApp** menggunakan **Scan QR Code**.

Dilengkapi dengan integrasi **Windows Defender**, **Windows Firewall**, **Docker**, pemantauan performa real-time, dan sistem peringatan proaktif (*watcher*) otomatis jika server terserang virus atau mengalami beban CPU ekstrem.

---

## 🚀 Fitur Utama

- 📱 **Kendali Penuh via WhatsApp:** Cukup kirim kata kunci `monitor` untuk menampilkan panel menu bernomor (1 - 11).
- 🚨 **Proactive Threat Alert:** Mendeteksi virus/malware melalui Windows Defender secara real-time dan langsung mengirim peringatan darurat ke WhatsApp Admin.
- ⚡ **Resource Spike Warning:** Peringatan instan jika pemakaian CPU > 90% secara terus-menerus.
- 🔍 **Antivirus On-Demand:** Memicu *Quick Scan* atau *Full Scan* Windows Defender cukup dengan memilih nomor menu.
- 🔌 **Port & Network Inspection:** Memindai port TCP yang sedang mendengar (*LISTENING*) beserta nama proses dan PID-nya.
- 🐳 **Manajemen Docker:** Cek status container dan restart container yang bermasalah langsung dari chat.
- 🧱 **Firewall Control:** Blokir alamat IP yang mencurigakan ke dalam Windows Firewall secara remote.
- 🔒 **Emergency Lockdown:** Fitur darurat untuk memutus tunnel Cloudflare seketika jika server disusupi dari jaringan publik.
- 🧠 **AI Fallback (Ollama):** Mampu menjawab konsultasi dan diskusi teknis seputar kondisi server menggunakan model lokal (Llama 3.2 3B).

---

## 📋 Prasyarat Sistem

1. **Sistem Operasi:** Windows 10, Windows 11, atau Windows Server 2016/2019/2022.
2. **Node.js:** Versi 18.x atau yang lebih baru (disarankan v20+ atau v24+).
3. **PowerShell:** PowerShell 5.1 bawaan Windows atau PowerShell 7+.
4. **Hak Akses:** Jalankan terminal / Command Prompt dengan **Run as Administrator** agar memiliki izin membaca Defender API dan mengelola Windows Firewall.
5. **(Opsional) Docker Desktop:** Jika Anda menjalankan aplikasi berbasis container di server.
6. **(Opsional) Ollama:** Jika ingin mengaktifkan respons cerdas AI lokal.

---

## 🛠️ Panduan Instalasi di Server Baru

### Langkah 1: Kloning Repositori
Buka Command Prompt / PowerShell di server baru:
```bash
git clone https://github.com/<username-anda>/windows-security-agent.git
cd windows-security-agent
```

### Langkah 2: Pasang Dependensi
```bash
npm install
```

### Langkah 3: Konfigurasi Lingkungan (`.env`)
Salin file template `.env.example` menjadi `.env`:
```bash
copy .env.example .env
```
Buka file `.env` dan atur nomor WhatsApp Anda (atau biarkan kosong jika ingin nomor yang pertama chat otomatis menjadi Admin):
```env
ADMIN_NUMBERS=6281234567890
QR_PORT=5005
WATCHER_INTERVAL_SECONDS=30
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2:3b
```

### Langkah 4: Jalankan Agen
Anda dapat menjalankan menggunakan perintah:
```bash
npm start
```
Atau cukup klik dua kali file **`start.bat`**.

---

## 📲 Menghubungkan ke WhatsApp

1. Saat agen pertama kali dijalankan, buka browser di server atau perangkat lain di jaringan yang sama:
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
| **2** | `!status` | Ringkasan pemakaian CPU, RAM, sisa harddisk, Uptime, & status Defender. |
| **3** | `!threats` | Riwayat ancaman / malware yang pernah terdeteksi dan diisolasi Defender. |
| **4** | `!scan` | Memicu **Quick Scan** antivirus Windows Defender di latar belakang. |
| **5** | `!scan-full` | Memicu **Full Scan** menyeluruh pada seluruh drive server. |
| **6** | `!ports` | Memindai port TCP aktif (80, 443, 3000, 5432, dll.) beserta proses pemiliknya. |
| **7** | `!docker` | Cek status seluruh container Docker yang sedang berjalan. |
| **8** | `8 <nama>` | Me-restart container Docker tertentu (contoh: `8 ujian_backend`). |
| **9** | `9 <IP>` | Menambahkan aturan blokir IP langsung ke Windows Firewall. |
| **10** | `10` / `!lockdown` | **Mode Darurat:** Memutus Cloudflare Tunnel seketika jika diserang. |
| **11** | `11` / `!restore` | Mengaktifkan kembali Cloudflare Tunnel ke domain server. |

> **Tips:** Anda cukup membalas pesan bot dengan mengetik nomor pilihannya saja (misal: kirim pesan `2` untuk cek status).

---

## 🔐 Keamanan & Privasi

- **Whitelist Nomor Ponsel:** Hanya nomor admin yang terdaftar yang dapat mengeksekusi perintah. Pesan dari nomor tak dikenal akan diabaikan secara diam-diam.
- **Kredensial Sesi:** Kunci otentikasi WhatsApp (`session_auth/`) dan file konfigurasi rahasia (`.env`) dimasukkan ke dalam `.gitignore` sehingga **TIDAK PERNAH** terunggah ke repositori publik.
- **Safe Command Mapping:** Sistem tidak menjalankan raw shell bebas untuk mencegah celah *Command Injection*. Setiap input dipetakan ke fungsi terisolasi dengan validasi regex ketat.

---

## 📄 Lisensi
MIT License - Bebas digunakan dan dikembangkan untuk kebutuhan server pribadi maupun perusahaan.
