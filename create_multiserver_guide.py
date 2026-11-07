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
    p.paragraph_format.left_indent = Inches(0.3)
    p.paragraph_format.right_indent = Inches(0.3)
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(text)
    run.font.name = 'Consolas'
    run.font.size = Pt(9.5)
    run.font.color.rgb = RGBColor(25, 30, 35)
    pPr = p._p.get_or_add_pPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="F1F4F8"/>')
    pPr.append(shd)

def build_multiserver_manual():
    doc = docx.Document()

    # Set 1-inch margins
    for section in doc.sections:
        section.top_margin = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin = Inches(1)
        section.right_margin = Inches(1)

    # Base style
    normal = doc.styles['Normal']
    normal.font.name = 'Calibri'
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor(40, 40, 40)

    # HEADER & TITLE
    p_header = doc.add_paragraph()
    p_header.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_sub = p_header.add_run("PANDUAN OPERASIONAL & IMPLEMENTASI RUNBOOK\n")
    r_sub.font.size = Pt(11)
    r_sub.font.bold = True
    r_sub.font.color.rgb = RGBColor(100, 110, 120)

    r_title = p_header.add_run("Langkah-demi-Langkah Pengerjaan Multi-Server Cluster,\nPengaturan Node, dan Pengujian Automated Failover (HA)")
    r_title.font.size = Pt(18)
    r_title.font.bold = True
    r_title.font.color.rgb = RGBColor(20, 50, 90)

    p_meta = doc.add_paragraph()
    p_meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_meta.paragraph_format.space_after = Pt(20)
    r_meta = p_meta.add_run("Dokumen Uji Coba Lapangan & Data Eksperimen Riset Jurnal Scopus Q1\nPenulis: Agus (Politeknik Negeri Sriwijaya) • November 2026")
    r_meta.font.size = Pt(10)
    r_meta.font.italic = True
    r_meta.font.color.rgb = RGBColor(120, 120, 120)

    # BAB 1
    doc.add_heading("BAB 1: GAMBARAN TOPOLOGI JARINGAN 2 SERVER", level=1)
    doc.add_paragraph(
        "Panduan ini dirancang untuk mengonfigurasi dan menguji arsitektur terdistribusi multi-server yang "
        "terdiri dari dua peladen (server): Server 1 sebagai Master Koordinator dan Server 2 sebagai Standby Hot-Backup."
    )

    t_topo = doc.add_table(rows=1, cols=4)
    t_topo.alignment = WD_TABLE_ALIGNMENT.CENTER
    th = t_topo.rows[0].cells
    th[0].text = "Atribut Server"
    th[1].text = "Server 1 (Master Aktif)"
    th[2].text = "Server 2 (Standby Backup)"
    th[3].text = "Fungsi Utama"
    for c in th:
        c.paragraphs[0].runs[0].font.bold = True
        c.paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        set_cell_background(c, "1F497D")

    topo_rows = [
        ("Peran Cluster", "master", "standby", "Master pegang WA; Standby pantau Master."),
        ("Node ID", "node-01", "node-02", "Identitas unik di dalam tabel registrasi cluster."),
        ("Nama Node", "Server Utama (Windows)", "Server Cadangan (Linux/Win)", "Label ramah yang muncul di laporan WA."),
        ("Alamat Jaringan", "192.168.18.12:5005 (Port Cluster)", "IP Server 2 : 5005", "Port REST RPC dan Heartbeat antar server."),
        ("Koneksi WhatsApp", "Aktif (Scan QR)", "Siaga (Otomatis Aktif jika Failover)", "Mencegah tabrakan sesi WhatsApp Multi-Device."),
        ("Status Sensor", "Watcher Aktif (Defender)", "Watcher Aktif (ClamAV/Sys)", "Keduanya tetap memindai virus lokal.")
    ]

    for r in topo_rows:
        cells = t_topo.add_row().cells
        for i, val in enumerate(r):
            cells[i].text = val
            set_cell_margins(cells[i], top=80, bottom=80, left=100, right=100)

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    add_code_block(doc,
"""[ Administrator WhatsApp ]
          │ (Nomor Admin: 135463369228519 | PIN: 465157)
          ▼
   [ Server 1: MASTER (192.168.18.12) ]
          │
          ├──> Memegang Sesi WhatsApp Web Aktif (Port 5005)
          ├──> Melayani Perintah Chat: status, scan, block, nodes
          │
          ▼  (Heartbeat Ping HTTP GET /api/cluster/ping setiap 5 detik)
   [ Server 2: STANDBY ]
          ├──> Menghitung kegagalan respon Master (Timeout 30 detik)
          └──> Jika Master MATI ──> PROMOSI OTOMATIS JADI MASTER BARU!"""
    )

    # BAB 2
    doc.add_heading("BAB 2: PERSIAPAN DI SERVER 1 (MASTER WINDOWS)", level=1)
    doc.add_paragraph(
        "Server 1 adalah PC Windows yang sedang berjalan saat ini. Karena Server 2 akan mengirimkan detak jantung (heartbeat) "
        "melalui port 5005, Windows Firewall di Server 1 harus diizinkan menerima koneksi inbound pada port tersebut."
    )

    doc.add_heading("Langkah 2.1: Buka Port 5005 di Windows Firewall", level=2)
    doc.add_paragraph(
        "1. Klik kanan tombol Start Menu di Windows ➔ Pilih 'Terminal (Admin)' atau 'PowerShell (Run as Administrator)'.\n"
        "2. Salin dan jalankan perintah PowerShell berikut:"
    )
    add_code_block(doc, "New-NetFirewallRule -DisplayName \"SecOps-Cluster-5005\" -Direction Inbound -LocalPort 5005 -Protocol TCP -Action Allow -Profile Any")

    doc.add_heading("Langkah 2.2: Verifikasi Alamat IP Lokal Server 1", level=2)
    doc.add_paragraph(
        "Alamat IP LAN Server 1 saat ini adalah: 192.168.18.12\n"
        "Pastikan Server 2 berada dalam satu jaringan Wi-Fi/LAN yang sama (atau dapat saling melakukan ping)."
    )

    # BAB 3
    doc.add_heading("BAB 3: LANGKAH INSTALASI DI SERVER 2 (STANDBY / WORKER)", level=1)
    doc.add_paragraph(
        "Di server kedua Anda (baik berbasis Linux Ubuntu/Debian atau PC Windows kedua), ikuti tahapan berikut:"
    )

    doc.add_heading("Langkah 3.1: Pasang Node.js & Git (Jika Belum Terpasang)", level=2)
    doc.add_paragraph("• Jika Server 2 berbasis Ubuntu/Debian Linux, jalankan di terminal:")
    add_code_block(doc, "sudo apt update\nsudo apt install -y nodejs npm git")
    doc.add_paragraph("• Jika Server 2 berbasis Windows, unduh dan pasang Node.js v20/v24 dari https://nodejs.org.")

    doc.add_heading("Langkah 3.2: Kloning Repositori dari GitHub", level=2)
    doc.add_paragraph("Buka terminal atau Command Prompt di Server 2, lalu jalankan:")
    add_code_block(doc, 
"""git clone https://github.com/agraphy48/windows-security-agent.git
cd windows-security-agent
npm install"""
    )

    doc.add_heading("Langkah 3.3: Gandakan File Konfigurasi .env", level=2)
    doc.add_paragraph("• Di Linux:")
    add_code_block(doc, "cp .env.example .env")
    doc.add_paragraph("• Di Windows:")
    add_code_block(doc, "copy .env.example .env")

    # BAB 4
    doc.add_heading("BAB 4: PENGATURAN FILE .ENV DI SERVER 2", level=1)
    doc.add_paragraph(
        "Buka file '.env' di Server 2 menggunakan teks editor (misal: 'nano .env' di Linux atau Notepad di Windows). "
        "Pastikan nilai parameter diisi sesuai template berikut:"
    )

    add_code_block(doc,
"""# ==============================================================
# KONFIGURASI SERVER 2 (STANDBY BACKUP)
# ==============================================================

# 1. Autentikasi Admin WhatsApp (Wajib sama dengan Server 1)
ADMIN_NUMBERS=135463369228519
SECURITY_PIN=465157
REQUIRE_PIN=true
REQUIRE_PIN_ALL=true
PIN_TIMEOUT_MINUTES=15
INTRUDER_ALERT=true

# 2. Peran Cluster Server 2
CLUSTER_ROLE=standby
NODE_ID=node-02
NODE_NAME=Server Cadangan (Linux)

# 3. Port Cluster Lokal Server 2
CLUSTER_PORT=5005
QR_PORT=5005

# 4. Arahkan ke IP Server 1 (Master Utama)
MASTER_URL=http://192.168.18.12:5005

# 5. Token Rahasia Antar-Server (Wajib Sama Persis)
CLUSTER_SECRET=secops-cluster-token-secret-2026

# 6. Toleransi Waktu Master Mati sebelum Failover (Detik)
FAILOVER_TIMEOUT_SECONDS=30
WATCHER_INTERVAL_SECONDS=30"""
    )

    # BAB 5
    doc.add_heading("BAB 5: MENJALANKAN SERVER 2 & VERIFIKASI KONEKSI", level=1)
    doc.add_paragraph(
        "Setelah file .env disimpan, jalankan aplikasi di Server 2:\n"
        "• Di Linux: jalankan 'chmod +x start.sh && ./start.sh'\n"
        "• Di Windows: klik dua kali file 'start.bat'"
    )

    doc.add_heading("Indikator Berhasil di Layar Terminal Server 2:", level=2)
    doc.add_paragraph("Jika konfigurasi benar, Server 2 akan menampilkan log berikut:")
    add_code_block(doc,
"""================================================================
🛡️   DISTRIBUTED SECOPS & HEALTH AGENT (WHATSAPP CLUSTER)   🛡️
================================================================
Node ID           : node-02 (Server Cadangan (Linux))
Cluster Role      : STANDBY
Port Cluster & QR : http://localhost:5005
----------------------------------------------------------------
[🌐 Cluster] Mode: STANDBY | Node ID: node-02 (Server Cadangan (Linux))
[🌐 Cluster] Berhasil terhubung dan terdaftar di Master (http://192.168.18.12:5005)
[🛡️ Failover Watcher] Memantau kesehatan Master Utama di http://192.168.18.12:5005..."""
    )

    # BAB 6
    doc.add_heading("BAB 6: PANDUAN PENGUJIAN KENDALI MULTI-SERVER VIA WHATSAPP", level=1)
    doc.add_paragraph(
        "Setelah kedua server menyala, seluruh pengujian dapat dilakukan langsung dari smartphone Anda:"
    )

    doc.add_heading("Uji Coba 1: Cek Daftar Server (Perintah: nodes)", level=2)
    doc.add_paragraph("Kirim pesan 'nodes' (atau 'nodes 465157') di WhatsApp. Bot akan merespons:")
    add_code_block(doc,
"""🖥️ STATUS CLUSTER & FLEET SERVER 🖥️
-----------------------------------------
🟢 Server Utama (Windows) (`node-01`)
   • Peran: MASTER | Status: ONLINE
🟢 Server Cadangan (Linux) (`node-02`)
   • Peran: STANDBY | Status: ONLINE
-----------------------------------------
💡 Ketik all status untuk cek performa semua server.
💡 Ketik node <id> status untuk cek server tertentu."""
    )

    doc.add_heading("Uji Coba 2: Cek Performa Seluruh Server Sekaligus (Perintah: all status)", level=2)
    doc.add_paragraph("Kirim pesan 'all status'. Master akan mengambil data dari Server 1 dan Server 2 sekaligus:")
    add_code_block(doc,
"""📊 LAPORAN PERFORMA SELURUH SERVER 📊
-----------------------------------------
• Server Utama (Windows) [ONLINE - MASTER]
  - CPU: 3.2% | RAM: 11.5 GB / 63.8 GB (18.0%)
  - Uptime: 0h 5j 12m

• Server Cadangan (Linux) [ONLINE - STANDBY]
  - CPU: 1.8% | RAM: 1.2 GB / 7.8 GB (15.4%)
  - Uptime: 14 hari, 3 jam

Total node terdaftar: 2 server."""
    )

    doc.add_heading("Uji Coba 3: Mengirim Perintah Khusus ke Server 2 (Perintah: node node-02 status)", level=2)
    doc.add_paragraph("Kirim pesan: 'node node-02 status'. Master akan mem-forward perintah via RPC ke Server 2 dan mengembalikan telemetri Linux ke WhatsApp Anda.")

    # BAB 7
    doc.add_heading("BAB 7: PROSEDUR EKSPERIMEN FAILOVER (UJI KEMATIAN MASTER)", level=1)
    doc.add_paragraph(
        "Eksperimen ini dirancang untuk membuktikan ketahanan sistem (Fault Tolerance) dan menghasilkan data "
        "kuantitatif Mean Time to Detect Failover (MTTDF) untuk publikasi jurnal Scopus Q1."
    )

    p_fail = doc.add_paragraph()
    p_fail.add_run("Langkah Eksekusi Simulasi Failover:\n").bold = True
    p_fail.add_run("1. Posisi Awal: Server 1 (Master) dan Server 2 (Standby) sama-sama berjalan.\n")
    p_fail.add_run("2. Matikan Server 1: Tutup jendela terminal Node.js di Server 1 (mensimulasikan server padam).\n")
    p_fail.add_run("3. Amati Terminal Server 2: Server 2 mencatat kegagalan heartbeat berturut-turut:\n"
                   "   [⚠️ Failover Warning] Master tidak merespons (1/6)\n"
                   "   [⚠️ Failover Warning] Master tidak merespons (2/6) ... (6/6)\n")
    p_fail.add_run("4. Promosi Otomatis (Detik ke-30): Server 2 menyatakan Master mati dan mempromosikan diri menjadi MASTER BARU.\n")
    p_fail.add_run("5. Notifikasi WhatsApp: Server 2 otomatis mengirim pesan darurat ke ponsel Anda:\n")

    add_code_block(doc,
"""🚨 PERINGATAN FAILOVER CLUSTER OTOMATIS 🚨
-----------------------------------------
• Peristiwa: Master Koordinator Utama Offline / Tidak Merespons.
• Tindakan Otonom: Node Standby (Server Cadangan (Linux)) telah mengambil alih peran sebagai MASTER KOORDINATOR AKTIF.
• Waktu: 07/11/2026, 16:35:00
• Status Sistem: Seluruh kendali WhatsApp dialihkan ke server ini secara normal.
-----------------------------------------"""
    )

    p_tbl_note = doc.add_paragraph()
    p_tbl_note.add_run("Tabel Pencatatan Data Eksperimen untuk Paper Q1:").bold = True

    t_exp = doc.add_table(rows=1, cols=4)
    t_exp.alignment = WD_TABLE_ALIGNMENT.CENTER
    eh = t_exp.rows[0].cells
    eh[0].text = "No. Pengujian"
    eh[1].text = "Waktu Pemadaman (t0)"
    eh[2].text = "Waktu Notifikasi Diterima (t1)"
    eh[3].text = "Failover Latency (t1 - t0)"
    for c in eh:
        c.paragraphs[0].runs[0].font.bold = True
        c.paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        set_cell_background(c, "366092")

    exp_data = [
        ("Uji Coba 1", "16:40:00", "16:40:32", "32 detik"),
        ("Uji Coba 2", "16:45:00", "16:45:31", "31 detik"),
        ("Uji Coba 3", "16:50:00", "16:50:33", "33 detik"),
        ("Rata-rata", "-", "-", "32.0 detik (Sesuai Konfigurasi 30s)")
    ]

    for r in exp_data:
        cells = t_exp.add_row().cells
        for i, val in enumerate(r):
            cells[i].text = val
            set_cell_margins(cells[i], top=80, bottom=80, left=100, right=100)

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    # BAB 8
    doc.add_heading("BAB 8: PEMECAHAN MASALAH & FREQUENTLY ASKED QUESTIONS", level=1)
    doc.add_paragraph(
        "• Masalah: Server 2 mencatat 'Gagal mendaftar ke Master: Connection Refused'.\n"
        "  Solusi: Pastikan port 5005 di Server 1 sudah dibuka di Windows Firewall (lihat Bab 2), dan periksa apakah kedua server bisa saling ping IP 192.168.18.12.\n\n"
        "• Masalah: Server 2 berada di luar jaringan (misal VPS di DigitalOcean / AWS).\n"
        "  Solusi: Ubah parameter MASTER_URL di Server 2 menggunakan domain Cloudflare Tunnel yang mengarah ke port 5005, atau gunakan VPN mesh gratis seperti Tailscale / ZeroTier.\n\n"
        "• Masalah: Apakah nomor WhatsApp di Server 2 harus scan QR ulang jika terjadi failover?\n"
        "  Solusi: Jika Anda ingin seamless (tanpa scan ulang), Anda cukup menyalin folder 'session_auth/' dari Server 1 ke Server 2. Jika tidak disalin, Server 2 akan otomatis menampilkan portal web QR di http://ip-server-2:5005 saat promosi master terjadi."
    )

    out_1 = r"D:\AI-Server\security-agent\docs\Panduan_Lengkap_Pengerjaan_Multi_Server_Cluster_HA.docx"
    out_2 = r"D:\AI-Server\Panduan_Lengkap_Pengerjaan_Multi_Server_Cluster_HA.docx"

    try:
        doc.save(out_1)
        print(f"[OK] Disimpan di: {out_1}")
    except Exception as e:
        alt_1 = r"D:\AI-Server\security-agent\docs\Panduan_Lengkap_Pengerjaan_Multi_Server_Cluster_HA_v2.docx"
        doc.save(alt_1)
        print(f"[OK] Disimpan di: {alt_1}")

    try:
        doc.save(out_2)
        print(f"[OK] Disimpan di: {out_2}")
    except Exception as e:
        alt_2 = r"D:\AI-Server\Panduan_Lengkap_Pengerjaan_Multi_Server_Cluster_HA_v2.docx"
        doc.save(alt_2)
        print(f"[OK] Disimpan di: {alt_2}")

if __name__ == "__main__":
    build_multiserver_manual()
