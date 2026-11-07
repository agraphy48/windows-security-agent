import os
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, fill_hex):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(f'<w:tcMar {nsdecls("w")}><w:top w:w="{top}" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/><w:left w:w="{left}" w:type="dxa"/><w:right w:w="{right}" w:type="dxa"/></w:tcMar>')
    tcPr.append(tcMar)

def add_code_block(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.4)
    p.paragraph_format.right_indent = Inches(0.4)
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(text)
    run.font.name = 'Consolas'
    run.font.size = Pt(9.5)
    run.font.color.rgb = RGBColor(30, 30, 30)
    # Background box for code
    pPr = p._p.get_or_add_pPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="F4F6F8"/>')
    pPr.append(shd)

def build_detailed_guide():
    doc = docx.Document()

    # Set Margins 1 inch
    for section in doc.sections:
        section.top_margin = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin = Inches(1)
        section.right_margin = Inches(1)

    # Base typography
    normal_style = doc.styles['Normal']
    normal_style.font.name = 'Calibri'
    normal_style.font.size = Pt(11)
    normal_style.font.color.rgb = RGBColor(40, 40, 40)

    # COVER / HEADER
    p_pre = doc.add_paragraph()
    p_pre.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_pre = p_pre.add_run("DOKUMEN ARSITEKTUR & PANDUAN TEKNIS MENDALAM\n")
    r_pre.font.size = Pt(12)
    r_pre.font.bold = True
    r_pre.font.color.rgb = RGBColor(100, 110, 120)

    r_title = p_pre.add_run("Cara Kerja Lengkap & Arsitektur Sistem\nAutonomous SecOps Guard Agent\n(WhatsApp Control, Zero-Trust PIN, & High-Availability Cluster)")
    r_title.font.size = Pt(20)
    r_title.font.bold = True
    r_title.font.color.rgb = RGBColor(20, 50, 90)

    p_meta = doc.add_paragraph()
    p_meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_meta.paragraph_format.space_after = Pt(24)
    r_meta = p_meta.add_run("Versi Sistem: 2.5 (Distributed HA Edition) • Tanggal: November 2026\nPenulis: Tim Pengembang & Peneliti SecOps / Agus (Politeknik Negeri Sriwijaya)")
    r_meta.font.size = Pt(10)
    r_meta.font.italic = True
    r_meta.font.color.rgb = RGBColor(110, 110, 110)

    # RINGKASAN SISTEM
    doc.add_heading("RINGKASAN EKSEKUTIF CARA KERJA SISTEM", level=1)
    doc.add_paragraph(
        "Sistem 'Autonomous SecOps Guard Agent' adalah solusi keamanan dan pemantauan peladen (server) otonom "
        "yang memungkinkan administrator mengawasi, mendeteksi ancaman, dan mengendalikan server secara instan "
        "melalui aplikasi pesan instan WhatsApp. Sistem ini beroperasi tanpa perlu membuka port router publik (mengandalkan "
        "WebSocket keluar dan Cloudflare Tunnel), kebal terhadap manipulasi orang asing berkat sistem otentikasi Zero-Trust "
        "berlapis, memiliki sensor antivirus dan firewall lintas platform (Windows dan Linux), serta dilengkapi kemampuan "
        "pemulihan mandiri (Automated Failover Cluster) jika server koordinator utama padam."
    )

    # BAB 1
    doc.add_heading("BAB 1: ARSITEKTUR UMUM & ALUR DATA SISTEM (END-TO-END)", level=1)
    doc.add_paragraph(
        "Secara arsitektural, sistem beroperasi melalui 5 lapisan interaksi utama yang bekerja secara simultan:"
    )

    p_flow = doc.add_paragraph()
    p_flow.add_run("1. Lapisan Antarmuka Pengguna (WhatsApp IM Layer):\n").bold = True
    p_flow.add_run("   Menghubungkan smartphone administrator ke server melalui protokol terenkripsi end-to-end Baileys WebSocket.\n")
    p_flow.add_run("2. Lapisan Otorisasi & Zero-Trust Guardian:\n").bold = True
    p_flow.add_run("   Memvalidasi nomor pengirim (JID Whitelist) dan memverifikasi status sesi PIN sebelum mengizinkan pemrosesan pesan.\n")
    p_flow.add_run("3. Lapisan Command Parser & Sandboxing:\n").bold = True
    p_flow.add_run("   Menerjemahkan teks perintah numerik (1-12) atau kata kunci ke pemanggilan fungsi terisolasi dengan validasi regex.\n")
    p_flow.add_run("4. Lapisan Abstraksi Sistem Operasi (OS Telemetry & Actions):\n").bold = True
    p_flow.add_run("   Mengeksekusi perintah pada kernel/subsystem server (PowerShell CIM di Windows, POSIX utils di Linux).\n")
    p_flow.add_run("5. Lapisan Pemantau Latar Belakang (Proactive Daemon Watcher):\n").bold = True
    p_flow.add_run("   Bekerja otonom setiap 30 detik mendeteksi kemunculan malware, lonjakan CPU, atau serangan brute-force.")

    add_code_block(doc, 
"""[ Admin WhatsApp ] <==== WebSocket (WSS:443) ====> [ Baileys Gateway di Server ]
                                                              │
                                            ┌─────────────────┴─────────────────┐
                                            ▼                                   ▼
                                  [ Whitelist Valid? ]                 [ Validasi PIN Sesi ]
                                    ├── TIDAK -> Silent Drop + Alert     ├── SALAH -> Blokir Akses
                                    └── YA    -> Lanjut Otorisasi        └── BENAR -> Buka Sesi (15 Menit)
                                                                                  │
                                                                                  ▼
                                                                        [ Command Router (1-12) ]
                                                                                  │
                                          ┌───────────────────────┬───────────────┴───────────────┬──────────────────────┐
                                          ▼                       ▼                               ▼                      ▼
                                   [ Windows Defender /    [ Windows Firewall /            [ Docker Engine API ]  [ Cluster Dispatcher ]
                                     ClamAV Scanner ]        Linux UFW Block ]                                    ├── Target: Node Lokal
                                                                                                                  └── Target: Node Remote"""
    )

    # BAB 2
    doc.add_heading("BAB 2: SUBSISTEM KOMUNIKASI WHATSAPP & PENANGANAN SESI", level=1)
    doc.add_heading("2.1 Protokol Baileys & WebSocket Keluar (Outbound-Only)", level=2)
    doc.add_paragraph(
        "Berbeda dengan chatbot berbasis webhook konvensional yang menuntut server memiliki IP publik statis atau membuka "
        "port inbound firewall, agen ini menggunakan library Baileys. Baileys mengemulasikan WhatsApp Web Client resmi menggunakan "
        "koneksi WebSocket keluar (outbound WSS ke server WhatsApp di port 443). Dampak keamanannya sangat signifikan: "
        "Server Anda tidak perlu membuka port router apa pun untuk menerima chat dari WhatsApp."
    )

    doc.add_heading("2.2 Manajemen Kunci Kriptografi Sesi (session_auth/)", level=2)
    doc.add_paragraph(
        "Kredensial login WhatsApp (Noise Protocol keys, identity keys, pre-keys, dan auth token) disimpan di dalam direktori "
        "lokal 'session_auth/'. Direktori ini diproteksi secara ketat:\n"
        "• Tidak diikutsertakan dalam repositori Git (tercatat di .gitignore) agar kunci otentikasi tidak pernah bocor.\n"
        "• Kunci disimpan dalam format file JSON terenkripsi bertingkat menggunakan fungsi useMultiFileAuthState.\n"
        "• Jika terjadi diskoneksi jaringan, Baileys secara otomatis melakukan auto-reconnect tanpa perlu scan QR ulang."
    )

    doc.add_heading("2.3 Portal Mini Scan QR (Port 5005)", level=2)
    doc.add_paragraph(
        "Untuk mempermudah proses penautan pertama kali, sistem menjalankan server HTTP mini di port 5005 (http://localhost:5005). "
        "Server ini merender gambar QR Code beresolusi tinggi yang me-refresh diri setiap 5 detik secara otomatis di browser. "
        "Setelah perangkat tertaut, portal web otomatis beralih menampilkan status hijau 'Terhubung'."
    )

    # BAB 3
    doc.add_heading("BAB 3: LAPISAN OTORISASI & MESIN STATUS PIN (ZERO-TRUST SECURITY ENGINE)", level=1)
    doc.add_paragraph(
        "Lapisan ini adalah 'jantung' pertahanan bot yang mencegah pihak luar mengambil kendali server."
    )

    doc.add_heading("3.1 Verifikasi JID Whitelist & Fitur Silent Drop", level=2)
    doc.add_paragraph(
        "Ketika sebuah pesan masuk melalui event messages.upsert, bot mengekstraksi senderJid (misal: '6281234567890@s.whatsapp.net'). "
        "Nomor ini dicocokkan dengan array ADMIN_NUMBERS yang didefinisikan di file .env.\n"
        "• Jika Nomor Terdaftar (Admin): Pesan dialirkan ke tahap verifikasi PIN.\n"
        "• Jika Nomor Asing (Bukan Admin): Bot menerapkan kebijakan Silent Drop. Bot TIDAK membalas pesan, TIDAK menampilkan menu, "
        "dan menghentikan eksekusi seketika. Bagi pengirim asing, nomor bot tampak seperti nomor pribadi yang centang dua namun tidak aktif."
    )

    doc.add_heading("3.2 Notifikasi Penyusup (Intruder Alert) & Anti-Spam Rate Limiter", level=2)
    doc.add_paragraph(
        "Meskipun pesan penyusup diabaikan, sistem mencatat upaya intrusi tersebut. Jika INTRUDER_ALERT=true, bot segera menyusun "
        "paket notifikasi darurat dan mengirimkannya ke nomor WhatsApp admin terdaftar. Untuk mencegah serangan Denial of Service (DoS) "
        "di mana penyerang mengirim ribuan pesan teks dan membanjiri notifikasi admin, bot dilengkapi algoritma Memory Rate Limiter "
        "(Map intruderAlerts): Bot membatasi maksimal 1 pesan alert per 3 menit untuk nomor asing yang sama."
    )

    doc.add_heading("3.3 Mesin Status Sesi PIN (Stateful PIN Session Machine)", level=2)
    doc.add_paragraph(
        "Ketika REQUIRE_PIN_ALL=true aktif, sistem menerapkan kebijakan gerbang terkunci penuh (Total Lock):\n"
        "1. Status Awal (Locked): Setiap pesan dari admin (seperti 'monitor', 'status', '2') ditahan dalam buffer pendingCommands, "
        "dan bot membalas permintaan memasukkan PIN.\n"
        "2. Verifikasi PIN: Saat admin membalas dengan PIN rahasia (misal: '465157'), bot memvalidasinya terhadap hash/string di .env.\n"
        "3. Transisi Status (Unlocked): Jika benar, bot mencatat timestamp autentikasi di Map adminSessions. Sesi terbuka selama "
        "durasi PIN_TIMEOUT_MINUTES (default 15 menit). Bot secara cerdas langsung mengeksekusi perintah yang tadi sempat tertahan.\n"
        "4. Sliding Expiration: Setiap kali admin mengirim perintah baru selama sesi aktif, timer 15 menit di-reset ulang.\n"
        "5. Penguncian Cepat (Manual Lock): Admin dapat menutup sesi seketika dengan mengirim kata 'lock' atau 'kunci' (Menu 12)."
    )

    doc.add_heading("3.4 Dukungan Perintah Cepat Satu Baris (Inline PIN)", level=2)
    doc.add_paragraph(
        "Bagi administrator yang membutuhkan kecepatan tanpa harus menunggu tanya-jawab PIN dua langkah, sistem mendukung parser Inline PIN: "
        "Bot membedah kata terakhir dari kalimat. Jika kata terakhir cocok dengan PIN (misal: 'status 465157' atau '10 465157'), "
        "bot memotong kata PIN tersebut, mengautentikasi sesi, dan langsung mengeksekusi perintah intinya dalam 1 detik."
    )

    # BAB 4
    doc.add_heading("BAB 4: ABSTRAKSI SISTEM OPERASI LINTAS PLATFORM (WINDOWS VS LINUX)", level=1)
    doc.add_paragraph(
        "Modul 'src/security.js' menggunakan prinsip arsitektur Adapter Pattern. Saat diinisialisasi, sistem mengecek "
        "process.platform untuk menentukan apakah lingkungan adalah Windows (win32) atau Linux."
    )

    # Table OS Comparison
    t_os = doc.add_table(rows=1, cols=3)
    t_os.alignment = WD_TABLE_ALIGNMENT.CENTER
    c_hdr = t_os.rows[0].cells
    c_hdr[0].text = "Fungsi Keamanan"
    c_hdr[1].text = "Implementasi di Windows"
    c_hdr[2].text = "Implementasi di Linux"
    for c in c_hdr:
        c.paragraphs[0].runs[0].font.bold = True
        c.paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        set_cell_background(c, "1F497D")

    os_rows = [
        ("Telemetri CPU & RAM", "PowerShell CIM (Win32_OperatingSystem & Win32_Processor)", "POSIX utilities (top -bn1, free -m, procfs)"),
        ("Audit Partisi Harddisk", "Get-PSDrive -PSProvider FileSystem", "df -h -x tmpfs -x devtmpfs"),
        ("Antivirus On-Demand", "Start-MpScan -ScanType QuickScan / FullScan", "clamscan -r -i /home /tmp /var/www"),
        ("Riwayat Ancaman / Malware", "Get-MpThreatDetection dipadukan Get-MpThreat", "Parsing /var/log/fail2ban.log & /var/log/clamav.log"),
        ("Audit Soket Port Terbuka", "Get-NetTCPConnection -State Listen & Process mapping", "ss -tulpn / netstat listening socket parser"),
        ("Injeksi Blokir Firewall", "New-NetFirewallRule -Action Block -RemoteAddress", "UFW (ufw deny from <IP>) atau IPTables (-j DROP)"),
        ("Isolasi Darurat (Lockdown)", "Stop-Process -Name cloudflared -Force", "pkill -f cloudflared atau systemctl stop cloudflared"),
        ("Lifecycle Container Docker", "Docker CLI CLI (docker ps, docker restart)", "Docker CLI (docker ps, docker restart) - Identik")
    ]

    for r in os_rows:
        cells = t_os.add_row().cells
        for i, val in enumerate(r):
            cells[i].text = val
            set_cell_margins(cells[i], top=80, bottom=80, left=100, right=100)

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    doc.add_heading("4.1 Keamanan Eksekusi PowerShell (Base64 Encoded Command)", level=2)
    doc.add_paragraph(
        "Di Windows, pemanggilan skrip PowerShell melalui child_process rawan mengalami error karakter spasi atau tanda petik. "
        "Sistem kami mengatasi masalah ini dengan teknik industri mutakhir: Skrip PowerShell dikonversi terlebih dahulu ke "
        "buffer biner UTF-16LE, lalu di-encode menjadi string Base64 dan dipanggil via flag '-EncodedCommand'. "
        "Hal ini menjamin skrip dieksekusi 100% mulus tanpa risiko distorsi shell quoting."
    )

    # BAB 5
    doc.add_heading("BAB 5: DAEMON PEMANTAU OTONOM LATAR BELAKANG (PROACTIVE WATCHER)", level=1)
    doc.add_paragraph(
        "Modul 'src/watcher.js' berfungsi sebagai sensor pengawas yang bekerja independen tanpa menunggu instruksi chat."
    )

    doc.add_heading("5.1 Siklus Pemeriksaan Berkala 30 Detik", level=2)
    doc.add_paragraph(
        "Setiap interval WATCHER_INTERVAL_SECONDS (default 30 detik), daemon menjalankan fungsi check() yang membagi tugas menjadi 2 cabang:"
    )

    p_watch = doc.add_paragraph()
    p_watch.add_run("1. Pengawasan Ancaman Antivirus (checkNewThreats):\n").bold = True
    p_watch.add_run("   Daemon membaca daftar DetectionID terbaru dari Windows Defender. Sistem membandingkannya dengan Set memory (seenThreats). "
                    "Jika ditemukan DetectionID baru yang belum pernah dicatat sebelumnya, bot secara instan mengonstruksi pesan darurat "
                    "berisi nama virus, path file terinfeksi, waktu eksekusi, dan status remediate-nya, lalu mengirimkannya ke seluruh admin.\n")
    p_watch.add_run("2. Pengawasan Lonjakan Sumber Daya (checkSystemHealth):\n").bold = True
    p_watch.add_run("   Daemon memeriksa beban CPU. Jika CPU >= 90% terjadi selama 2 siklus berturut-turut (highCpuStreak >= 2), "
                    "bot mengirimkan notifikasi lonjakan performa kepada admin. Agar tidak terjadi spam saat server memang sedang rendering/kompilasi, "
                    "alert dibatasi maksimal 1 kali setiap 10 menit.")

    # BAB 6
    doc.add_heading("BAB 6: ARSITEKTUR CLUSTER MULTI-SERVER & FAILOVER OTOMATIS (HA)", level=1)
    doc.add_paragraph(
        "Inovasi terbesar dari sistem ini adalah kemampuannya menghubungkan banyak server di bawah 1 kendali WhatsApp "
        "tanpa Single Point of Failure (SPOF)."
    )

    doc.add_heading("6.1 Tiga Peran Node dalam Cluster", level=2)
    doc.add_paragraph(
        "Setiap server dalam jaringan cluster menjalankan kode yang sama namun dikonfigurasikan dengan peran (CLUSTER_ROLE) yang berbeda:\n"
        "• Node MASTER: Server koordinator utama. Bertugas memegang koneksi WhatsApp, menerima pesan admin, memelihara tabel registrasi node "
        "(nodes map), dan mendistribusikan instruksi.\n"
        "• Node STANDBY: Server cadangan siaga penuh (*Hot Standby*). Memantau kesehatan Master Utama setiap 5 detik. "
        "Jika Master Utama mati, Standby mempromosikan diri menjadi Master Baru secara otomatis.\n"
        "• Node WORKER: Server biasa. Menjalankan listener REST API internal dan melapor ke Master secara periodik tanpa memegang koneksi WhatsApp."
    )

    doc.add_heading("6.2 Protokol Detak Jantung (Heartbeat) & Deteksi Kematian Server", level=2)
    doc.add_paragraph(
        "1. Node Standby mengirim kueri HTTP GET ke endpoint '/api/cluster/ping' milik Master setiap 5 detik.\n"
        "2. Setiap permintaan menyertakan token autentikasi rahasia pada header 'x-cluster-secret' yang dicocokkan dengan CLUSTER_SECRET di .env.\n"
        "3. Jika Master Utama tidak merespons (timeout) hingga mencapai ambang batas FAILOVER_TIMEOUT_SECONDS (default 30 detik atau 6 kali kegagalan berturut-turut), "
        "Standby mendeklarasikan bahwa Master Utama telah mati (DOWN)."
    )

    doc.add_heading("6.3 Logika Promosi Otonom (Self-Promotion & Failover Execution)", level=2)
    doc.add_paragraph(
        "Ketika failover terpicu:\n"
        "1. Standby menghentikan loop pemantauan failover.\n"
        "2. Mengubah status perannya sendiri menjadi: role = 'master'.\n"
        "3. Memanggil callback 'onPromoteToMaster()' yang secara instan menyalakan modul Baileys WhatsApp Gateway di server cadangan.\n"
        "4. Menyalakan Master Watcher untuk mengambil alih pemantauan node-node worker lainnya.\n"
        "5. Mengirim pesan darurat otomatis ke nomor WhatsApp Admin:\n"
        "   '🚨 PERINGATAN FAILOVER CLUSTER OTOMATIS: Master Utama Offline. Server Cadangan telah mengambil alih kendali sebagai MASTER KOORDINATOR AKTIF!'"
    )

    doc.add_heading("6.4 Agregasi Status Multi-Server (Command: all status)", level=2)
    doc.add_paragraph(
        "Ketika admin mengirim pesan 'all status' di WhatsApp, Master Koordinator mengirimkan kueri paralel via internal RPC "
        "ke seluruh node online di cluster. Master merangkum data CPU, RAM, Uptime, dan OS dari seluruh server menjadi 1 pesan ringkas "
        "sehingga admin dapat memantau kesehatan seluruh infrastruktur server hanya dalam sekali lihat."
    )

    # BAB 7
    doc.add_heading("BAB 7: REKAPITULASI 12 PERINTAH WHATSAPP & PENANGANANNYA", level=1)
    
    cmd_table = doc.add_table(rows=1, cols=4)
    cmd_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    chdr = cmd_table.rows[0].cells
    chdr[0].text = "No"
    chdr[1].text = "Perintah / Menu"
    chdr[2].text = "Alur Kerja Internal Sistem"
    chdr[3].text = "Tingkat Risiko"
    for c in chdr:
        c.paragraphs[0].runs[0].font.bold = True
        c.paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        set_cell_background(c, "1F497D")

    cmd_rows = [
        ("1", "!help / menu / 1", "Mengecek validitas sesi PIN. Jika valid, merender daftar menu dan status cluster.", "Rendah (Read)"),
        ("2", "!status / 2", "Kueri telemetri CPU, RAM, Disk, dan engine Defender/ClamAV via API OS lokal.", "Rendah (Read)"),
        ("3", "!threats / 3", "Membaca rekaman log ancaman virus aktif atau riwayat pemblokiran brute-force.", "Rendah (Read)"),
        ("4", "!scan / 4", "Memicu background job Quick Scan pada sistem operasi host.", "Sedang (Resource)"),
        ("5", "!scan-full / 5", "Memicu background job pemindaian disk menyeluruh di latar belakang.", "Sedang (Resource)"),
        ("6", "!ports / 6", "Memindai soket port TCP status LISTENING beserta pemetaan PID dan proses pemilik.", "Rendah (Audit)"),
        ("7", "!docker / 7", "Memanggil Docker socket untuk membaca status semua container yang berjalan.", "Rendah (Read)"),
        ("8", "8 <nama_container>", "Memeriksa izin PIN. Jika sah, memanggil 'docker restart <container>' secara aman.", "Tinggi (Service Restart)"),
        ("9", "9 <alamat_ip>", "Memvalidasi format IPv4 via Regex ketat, lalu menginjeksi rule BLOCK ke kernel Firewall.", "Tinggi (Firewall Injection)"),
        ("10", "10 / !lockdown", "Memutus akses publik dengan mematikan proses Cloudflare Tunnel seketika.", "Sangat Tinggi (Isolation)"),
        ("11", "11 / !restore", "Meluncurkan kembali binary cloudflared tunnel ke domain resmi server.", "Sedang (Recovery)"),
        ("12", "12 / lock / kunci", "Menghapus timestamp sesi dari memory secara instan (Sesi langsung terkunci).", "Rendah (Security Reset)"),
        ("C1", "nodes / cluster", "Menampilkan tabel kesehatan seluruh node server (Master, Standby, Worker).", "Rendah (Read)"),
        ("C2", "all status", "Mengambil data telemetri seluruh node secara paralel dan merangkumnya ke WA.", "Rendah (Read)"),
        ("C3", "node <id> <cmd>", "Meneruskan perintah spesifik ke node target melalui internal REST RPC.", "Sesuai Perintah Target")
    ]

    for r in cmd_rows:
        cells = cmd_table.add_row().cells
        for i, val in enumerate(r):
            cells[i].text = val
            set_cell_margins(cells[i], top=80, bottom=80, left=100, right=100)

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    # BAB 8
    doc.add_heading("BAB 8: PANDUAN PENGATURAN PARAMETER (.env) LENGKAP", level=1)
    doc.add_paragraph(
        "File konfigurasi '.env' memegang peranan vital dalam mengatur sensitivitas keamanan sistem:"
    )

    p_env = doc.add_paragraph()
    p_env.add_run("• ADMIN_NUMBERS: ").bold = True
    p_env.add_run("Nomor telepon WhatsApp admin yang diizinkan (format internasional tanpa +, dipisahkan koma jika lebih dari satu).\n")
    p_env.add_run("• SECURITY_PIN: ").bold = True
    p_env.add_run("Kode PIN rahasia 4-6 digit (contoh saat ini: 465157). Kunci utama membuka sesi kontrol bot.\n")
    p_env.add_run("• REQUIRE_PIN_ALL: ").bold = True
    p_env.add_run("Jika diset 'true', seluruh perintah (termasuk cek status) wajib diawali dengan pembukaan sesi PIN.\n")
    p_env.add_run("• PIN_TIMEOUT_MINUTES: ").bold = True
    p_env.add_run("Durasi sesi tetap terbuka setelah verifikasi PIN (default 15 menit). Set ke 0 jika ingin setiap perintah harus menyertakan PIN.\n")
    p_env.add_run("• INTRUDER_ALERT: ").bold = True
    p_env.add_run("Jika diset 'true', bot akan mengirim notifikasi darurat ke admin saat nomor asing mencoba mengakses bot.\n")
    p_env.add_run("• CLUSTER_ROLE: ").bold = True
    p_env.add_run("Menentukan peran server: 'master' (koordinator utama), 'standby' (cadangan failover), atau 'worker' (node biasa).\n")
    p_env.add_run("• NODE_ID & NODE_NAME: ").bold = True
    p_env.add_run("Identitas unik server dalam cluster (contoh: 'node-01' dan 'Server Utama Windows').\n")
    p_env.add_run("• CLUSTER_SECRET: ").bold = True
    p_env.add_run("Kunci token bersama (Pre-Shared Key) untuk enkripsi dan autentikasi komunikasi antar server cluster.\n")
    p_env.add_run("• FAILOVER_TIMEOUT_SECONDS: ").bold = True
    p_env.add_run("Waktu toleransi sebelum Standby Master mendeklarasikan Master Utama mati dan mengambil alih kendali (default 30 detik).")

    # SAVE TO FILE
    out_1 = r"D:\AI-Server\security-agent\docs\Cara_Kerja_Sistem_SecOps_Agent_Detail.docx"
    out_2 = r"D:\AI-Server\Cara_Kerja_Sistem_SecOps_Agent_Detail.docx"

    try:
        doc.save(out_1)
        print(f"[OK] Berhasil disimpan di: {out_1}")
    except Exception as e:
        alt_1 = r"D:\AI-Server\security-agent\docs\Cara_Kerja_Sistem_SecOps_Agent_Detail_v2.docx"
        doc.save(alt_1)
        print(f"[OK] Disimpan di: {alt_1}")

    try:
        doc.save(out_2)
        print(f"[OK] Berhasil disimpan di: {out_2}")
    except Exception as e:
        alt_2 = r"D:\AI-Server\Cara_Kerja_Sistem_SecOps_Agent_Detail_v2.docx"
        doc.save(alt_2)
        print(f"[OK] Disimpan di: {alt_2}")

if __name__ == "__main__":
    build_detailed_guide()
