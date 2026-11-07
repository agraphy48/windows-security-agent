---
name: whatsapp-secops-agent
description: >-
  Manage, configure, and conduct scientific research on the Autonomous Multi-Layered SecOps Agent.
  Use this skill to operate the server security agent controllable via WhatsApp, configure Zero-Trust
  PIN authorization, monitor Windows Defender/ClamAV/Fail2ban, perform incident response, and
  execute experimental attack simulations for Scopus Q1 academic publications.
---

# WhatsApp SecOps Agent & Q1 Research Skill

Skill ini memuat panduan lengkap pengelolaan, pemeliharaan, dan metodologi penelitian ilmiah untuk **Autonomous Multi-Layered SecOps Agent** yang dikendalikan melalui **WhatsApp**.

---

## 1. Lokasi Proyek & Struktur Repositori

Proyek utama berada di:
* **Path Lokal:** `D:\AI-Server\security-agent`
* **Dokumen Riset Word:** `D:\AI-Server\Spesifikasi_Fitur_dan_Rencana_Penelitian_Q1.docx`
* **Repositori GitHub:** `https://github.com/agraphy48/windows-security-agent`

Struktur berkas:
```text
security-agent/
├── src/
│   ├── index.js          # Entry point & coordinator
│   ├── config.js         # Configuration loader & JID whitelist
│   ├── security.js       # Cross-platform security engine (Windows API & Linux POSIX)
│   ├── watcher.js        # Background proactive threat & resource daemon (30s)
│   └── whatsapp.js       # Baileys WebSocket gateway, PIN session lock & command parser
├── docs/                 # Riset & spesifikasi format Word (.docx)
├── session_auth/         # WhatsApp credentials (diabaikan oleh git)
├── .env                  # Konfigurasi rahasia (PIN, Admin JID, timeout)
├── start.bat             # Peluncur Windows
├── start.sh              # Peluncur Linux
└── security-agent.service # Systemd daemon Linux
```

---

## 2. Model Operasional & Aturan Keamanan

1. **Zero-Trust State Machine:**
   * Bot secara default berstatus `LOCKED`.
   * Perintah hanya dapat dieksekusi jika admin telah mengautentikasi diri dengan PIN rahasia (`SECURITY_PIN`).
   * Sesi aktif memiliki sliding window (default 15 menit, `PIN_TIMEOUT_MINUTES`).
   * Admin dapat mengunci instan kapan saja dengan mengetik `lock` atau `kunci` (menu 12).
2. **Silent Drop & Intruder Alert:**
   * Pesan dari nomor tak dikenal **diabaikan diam-diam** (*no reply*).
   * Notifikasi darurat otomatis dikirim ke admin utama dengan detail nomor, waktu, dan pesan penyerang (rate limit 1x per 3 menit per nomor asing).
3. **Cross-Platform Engine:**
   * Di Windows: Menggunakan PowerShell CIM, Windows Defender API, dan Windows Firewall.
   * Di Linux: Menggunakan `top`, `free`, `df`, ClamAV (`clamscan`), UFW/IPTables, dan Fail2ban (`/var/log/fail2ban.log`).

---

## 3. Matriks Perintah WhatsApp

| Nomor | Perintah | Fungsi | Proteksi |
| :---: | :--- | :--- | :--- |
| **1** | `!help` / `1` | Panel menu bantuan dan status sesi. | PIN Session |
| **2** | `!status` / `2` | Telemetri CPU, RAM, Disk, Uptime & Antivirus. | PIN Session |
| **3** | `!threats` / `3` | Riwayat ancaman Defender / Fail2ban bans. | PIN Session |
| **4** | `!scan` / `4` | Asynchronous Quick Scan di latar belakang. | PIN Session |
| **5** | `!scan-full` / `5` | Asynchronous Full Scan seluruh disk. | PIN Session |
| **6** | `!ports` / `6` | Audit soket TCP LISTENING dan PID pemilik. | PIN Session |
| **7** | `!docker` / `7` | Status semua container Docker. | PIN Session |
| **8** | `8 <nama>` | Me-restart container Docker tertentu. | PIN Session |
| **9** | `9 <IP>` | Injeksi aturan blokir IP ke Firewall. | PIN Session + Regex |
| **10** | `10` / `!lockdown` | Mematikan Cloudflare Tunnel (Boundary Isolation). | PIN Session |
| **11** | `11` / `!restore` | Menyalakan kembali Cloudflare Tunnel. | PIN Session |
| **12** | `12` / `lock` | Mengunci kembali sesi bot secara manual. | Immediate Purge |
| **AI** | Chat Bebas | Konsultasi server via model lokal Ollama Llama 3.2 3B. | PIN Session |

---

## 4. Panduan Eksekusi Riset Jurnal Bereputasi Q1

Saat pengguna ingin melanjutkan tahapan riset, ikuti 5 fase metodologi ilmiah:

### Fase 1: Perumusan Konseptual & Novelty Framing
* **Judul Standar Q1:** *"Autonomous Multi-Layered SecOps Agent: A Zero-Trust Instant Messaging Framework for Cross-Platform Server Security and Incident Response"*
* **Target Jurnal:** Elsevier *Computers & Security* (IF 5.6) / IEEE *TDSC* (IF 7.2) / Springer *Cybersecurity* (IF 4.5).
* **Research Questions:**
  * RQ1: Efektivitas pencegahan unauthorized access & prompt injection pada kanal IM.
  * RQ2: Penurunan MTTR dan MTTD dibandingkan SIEM konvensional (email/dasbor web).
  * RQ3: Overhead komputasi (CPU/Memory spike) agen lokal pada beban pemindaian tinggi.

### Fase 2: Pengujian Kuantitatif & Metrik Eksperimen
Jalankan pengujian terkontrol untuk menghasilkan data tabel dan grafik:
1. **MTTD (Mean Time to Detect):** Waktu (detik) dari injeksi serangan hingga bot mendeteksi.
2. **MTTR (Mean Time to Respond):** Waktu (detik) dari notifikasi hingga operator menekan tombol perintah mitigasi via WA.
3. **Resource Overhead:** Pengukuran persentase CPU dan konsumsi RAM bot (idle ~30-40MB, scan ~60-80MB).
4. **Latency Measurement:** Waktu round-trip pesan WebSocket Baileys pada jaringan 4G/5G/WiFi.

### Fase 3: Simulasi Skenario Serangan
* **Uji Serangan Brute-Force:** Mengirimkan percobaan login SSH/RDP massal, mengevaluasi auto-block Fail2ban/Firewall.
* **Uji Malware Injection:** Menaruh EICAR test string atau trojan script untuk memicu instant alert Defender ke WhatsApp.
* **Uji Intruder Spoofing:** Mengirim pesan dari nomor pihak ketiga, memverifikasi silent-drop dan ketepatan Intruder Alert ke admin.

### Fase 4: Penulisan Manuskrip Format IMRaD
Bantu menyusun paper dalam bahasa Inggris akademik:
* *Section 1: Introduction & Threat Landscape*
* *Section 2: Related Work & Comparative Analysis (Wazuh, Slack ChatOps, Telegram Bots)*
* *Section 3: System Design & Formal STRIDE Threat Model*
* *Section 4: Experimental Evaluation, Attack Scenarios, & Latency Benchmarks*
* *Section 5: Discussion, Limitations, & Conclusion*

---

## 5. Pemecahan Masalah & Maintenance (Runbook)

* **Jika QR Code tidak muncul di terminal:** Buka browser di `http://localhost:5005` (mini web portal).
* **Jika Sesi WhatsApp logout:** Hapus folder `D:\AI-Server\security-agent\session_auth` lalu restart agen untuk scan ulang QR.
* **Jika Port 5005 terpakai:** Ubah `QR_PORT` di `.env`.
* **Jika Ingin Menambah Admin:** Masukkan nomor dengan format internasional (tanpa +) di `ADMIN_NUMBERS` pada file `.env` dipisahkan tanda koma.
