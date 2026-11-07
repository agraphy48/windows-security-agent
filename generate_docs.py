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

def create_document():
    doc = docx.Document()

    # Set Margins
    for section in doc.sections:
        section.top_margin = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin = Inches(1)
        section.right_margin = Inches(1)

    # Styles
    styles = doc.styles
    normal_style = styles['Normal']
    normal_style.font.name = 'Calibri'
    normal_style.font.size = Pt(11)
    normal_style.font.color.rgb = RGBColor(40, 40, 40)

    # TITLE & HEADER
    p_title = doc.add_paragraph()
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run_sub = p_title.add_run("SPESIFIKASI FITUR SISTEM LENGKAP & BLUEPRINT RISET\n")
    run_sub.font.size = Pt(12)
    run_sub.font.bold = True
    run_sub.font.color.rgb = RGBColor(100, 110, 120)

    run_title = p_title.add_run("Autonomous Multi-Layered SecOps Agent: A Zero-Trust Instant Messaging Framework for Cross-Platform Server Security and Incident Response")
    run_title.font.size = Pt(20)
    run_title.font.bold = True
    run_title.font.color.rgb = RGBColor(20, 50, 90)

    p_meta = doc.add_paragraph()
    p_meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_meta.paragraph_format.space_after = Pt(24)
    run_meta = p_meta.add_run("Dokumen Teknis & Metodologi Penelitian Publikasi Jurnal Internasional Bereputasi (Scopus Q1)\nOleh: Tim Peneliti SecOps / Agus (Politeknik Negeri Sriwijaya) • November 2026")
    run_meta.font.size = Pt(10)
    run_meta.font.italic = True
    run_meta.font.color.rgb = RGBColor(120, 120, 120)

    doc.add_heading("RINGKASAN EKSEKUTIF (EXECUTIVE SUMMARY)", level=1)
    p_exec = doc.add_paragraph(
        "Dokumen ini memuat spesifikasi teknis lengkap dari sistem 'Server Security Guard Agent' yang telah "
        "diimplementasikan, beserta peta jalan (roadmap) metodologi penelitian ilmiah yang dirancang untuk publikasi "
        "pada jurnal internasional bereputasi tinggi terindeks Scopus Q1 (seperti IEEE Transactions on Dependable and "
        "Secure Computing, Elsevier Computers & Security, atau Springer Cybersecurity). Sistem ini mengintegrasikan "
        "antarmuka Instant Messaging (WhatsApp) berbasis protokol WebSocket, arsitektur otentikasi Zero-Trust bertingkat "
        "(JID Whitelisting dan Dynamic Stateful 2FA PIN), abstraksi keamanan sistem operasi lintas platform "
        "(Windows Defender API vs Linux ClamAV/UFW/Fail2ban), dan modul mitigasi otonom terisolasi."
    )
    p_exec.paragraph_format.space_after = Pt(14)

    # BAB I
    doc.add_heading("BAB I: PENDAHULUAN & FORMULASI RISET (Q1 MOTIVATION)", level=1)
    
    doc.add_heading("1.1 Latar Belakang & Research Problem", level=2)
    doc.add_paragraph(
        "Infrastruktur peladen (server) on-premises dan edge server pada institusi pendidikan dan UMKM sering kali menghadapi "
        "tantangan keterbatasan personil Security Operations Center (SOC) yang beroperasi 24/7. Sistem monitoring konvensional "
        "berbasis dasbor web (misalnya Grafana, Zabbix) atau alert email memiliki keterbatasan fatal pada Mean Time to Detect (MTTD) "
        "dan Mean Time to Respond (MTTR). Notifikasi email kerap terlewatkan di luar jam kerja, sementara eksekusi mitigasi "
        "(seperti memblokir IP atau mematikan layanan terkompromi) menuntut administrator membuka laptop, menghubungkan VPN, "
        "dan melakukan autentikasi SSH/RDP yang memakan waktu krusial di saat insiden sedang berlangsung."
    )

    doc.add_heading("1.2 Gap Penelitian (Research Gap)", level=2)
    doc.add_paragraph(
        "Meskipun paradigma ChatOps telah diterapkan pada DevOps (misal bot Slack atau Discord untuk deployment), penerapannya "
        "pada Security Operations (SecOps) berisiko tinggi menghadapi serangan Prompt Injection, pencurian sesi chat, dan "
        "akses tidak sah ke shell root server. Penelitian yang ada belum menyediakan kerangka kerja holistik yang: "
        "(1) Menyediakan isolasi Zero-Trust tanpa mengekspos port publik ke internet, "
        "(2) Berjalan lintas platform (Windows dan Linux) dengan modul sensor terpadu, "
        "(3) Memiliki mekanisme verifikasi tindakan destruktif dengan 2FA instan dan deteksi penyusup proaktif."
    )

    doc.add_heading("1.3 Pertanyaan Penelitian (Research Questions)", level=2)
    p_rq = doc.add_paragraph()
    p_rq.add_run("• RQ1: ").bold = True
    p_rq.add_run("Bagaimana merancang arsitektur interaksi ChatOps berbasis Instant Messaging yang kebal terhadap serangan impersonasi nomor dan prompt injection tanpa mengorbankan kecepatan respons?\n")
    p_rq.add_run("• RQ2: ").bold = True
    p_rq.add_run("Sejauh mana efektivitas integrasi sensor telemetri lintas platform (Windows API dan POSIX Linux) dalam menekan MTTR saat terjadi serangan siber aktif dibandingkan pendekatan SIEM tradisional?\n")
    p_rq.add_run("• RQ3: ").bold = True
    p_rq.add_run("Bagaimana trade-off antara overhead komputasi (CPU/Memory overhead) agen penjaga lokal terhadap performa server saat pemindaian intensif berlangsung?")

    doc.add_heading("1.4 Kebaruan (Novelty) & Kontribusi Ilmiah", level=2)
    doc.add_paragraph(
        "1. Novelty 1: Dual-Layer Zero-Trust Authorization Model pada kanal IM (JID-Binding Whitelist + Stateful PIN Session Locking).\n"
        "2. Novelty 2: Cross-Platform Universal SecOps Engine yang secara transparan mengabstraksi PowerShell Windows API dan Bash POSIX Linux.\n"
        "3. Novelty 3: Human-in-the-Loop Incident Containment dengan fail-safe Boundary Killswitch (Cloudflare Tunnel termination) tanpa memerlukan IP publik statis."
    )

    # BAB II
    doc.add_heading("BAB II: SPESIFIKASI FITUR & ARSITEKTUR TEKNIS SISTEM", level=1)
    doc.add_paragraph(
        "Sistem dibangun menggunakan Node.js runtime terisolasi dengan struktur modular yang menghubungkan 4 lapisan utama: "
        "(1) WhatsApp Protocol Gateway, (2) Zero-Trust Auth & Session Guardian, (3) Cross-Platform OS Abstraction Layer, "
        "dan (4) Proactive Security Watcher Daemon."
    )

    doc.add_heading("2.1 Matriks 12 Fitur Perintah Sistem", level=2)
    
    # Table of Features
    table = doc.add_table(rows=1, cols=4)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False

    hdr_cells = table.rows[0].cells
    headers = ["No", "Perintah / Menu", "Tindakan & Logika Sistem", "Mekanisme Keamanan"]
    widths = [Inches(0.5), Inches(1.8), Inches(3.2), Inches(1.5)]
    
    for i, h in enumerate(headers):
        hdr_cells[i].text = h
        hdr_cells[i].paragraphs[0].runs[0].font.bold = True
        hdr_cells[i].paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        set_cell_background(hdr_cells[i], "1F497D")
        hdr_cells[i].width = widths[i]

    feature_data = [
        ("1", "!help / menu / 1", "Menampilkan panel panduan kendali dan status sesi.", "Whitelist & PIN Session"),
        ("2", "!status / 2", "Kueri telemetri CPU, RAM (total/terpakai), partisi disk, uptime, dan status antivirus.", "Read-only CIM / Procfs"),
        ("3", "!threats / 3", "Membaca riwayat log ancaman Defender (Get-MpThreatDetection) atau Fail2ban bans.", "Sanitized Output"),
        ("4", "!scan / 4", "Memicu pemindaian cepat (Quick Scan) Windows Defender atau ClamAV di latar belakang.", "Asynchronous Job"),
        ("5", "!scan-full / 5", "Memicu pemindaian menyeluruh (Full Scan) pada seluruh drive/partisi server.", "Resource Monitored"),
        ("6", "!ports / 6", "Audit soket TCP status LISTENING beserta pemetaan PID dan nama proses pemilik.", "Socket Inspection"),
        ("7", "!docker / 7", "Membaca status kesehatan dan port forwarding semua container Docker aktif.", "Docker Engine API"),
        ("8", "!docker restart / 8", "Me-restart container tertentu (contoh: '8 ujian_backend').", "2FA PIN / Regex Target"),
        ("9", "!block / 9", "Injeksi aturan blokir IP langsung ke Windows Firewall atau Linux UFW/IPTables.", "IPv4 Regex + 2FA PIN"),
        ("10", "!lockdown / 10", "Mode Darurat: Mematikan proses Cloudflare Tunnel untuk memutus akses dari domain luar.", "2FA PIN Confirmation"),
        ("11", "!restore / 11", "Memulihkan kembali layanan Cloudflare Tunnel ke domain server.", "2FA PIN / Whitelist"),
        ("12", "!lock / kunci / 12", "Mengunci kembali sesi kontrol bot secara manual.", "Immediate Session Purge"),
        ("AI", "Chat Bebas", "Konsultasi sistem pakar menggunakan local LLM (Ollama Llama 3.2 3B).", "Prompt Grounding Context")
    ]

    for row in feature_data:
        r_cells = table.add_row().cells
        for idx, val in enumerate(row):
            r_cells[idx].text = val
            r_cells[idx].width = widths[idx]
            set_cell_margins(r_cells[idx], top=80, bottom=80, left=100, right=100)
            if idx == 0:
                r_cells[idx].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    doc.add_heading("2.2 Mekanisme Keamanan Khusus (Security Mechanisms)", level=2)
    p_sec = doc.add_paragraph()
    p_sec.add_run("1. Total PIN Lock & Session Lifetime: ").bold = True
    p_sec.add_run("Sistem terkunci secara default. Akses perintah hanya diizinkan jika admin mengautentikasi diri dengan PIN rahasia (disimpan aman di .env). Sesi aktif memiliki sliding-timeout (default 15 menit) atau zero-retention.\n")
    p_sec.add_run("2. Intruder Alert & Silent Drop: ").bold = True
    p_sec.add_run("Nomor yang tidak terdaftar pada whitelist JID akan diabaikan tanpa balasan pesan (silent drop), mencegah kebocoran informasi. Secara bersamaan, bot mengirim pesan darurat ke admin utama dengan detail waktu, nomor penyusup, dan isi pesan.\n")
    p_sec.add_run("3. Safe Execution Sandboxing: ").bold = True
    p_sec.add_run("Sistem menolak perintah arbitrer bebas (tanpa eval atau arbitrary shell input). Seluruh perintah divalidasi dengan regular expression ketat.")

    # BAB III
    doc.add_heading("BAB III: MODEL ANCAMAN & ANALISIS KEAMANAN (STRIDE MODEL)", level=1)
    doc.add_paragraph(
        "Untuk standar jurnal Q1, analisis formal model ancaman wajib disertakan. Kami menerapkan metodologi STRIDE "
        "yang diakui oleh IEEE dan Microsoft Security:"
    )

    stride_table = doc.add_table(rows=1, cols=3)
    stride_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    s_hdr = stride_table.rows[0].cells
    s_hdr[0].text = "Ancaman STRIDE"
    s_hdr[1].text = "Vektor Serangan Potensial"
    s_hdr[2].text = "Mitigasi yang Diimplementasikan"
    for c in s_hdr:
        c.paragraphs[0].runs[0].font.bold = True
        c.paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        set_cell_background(c, "366092")

    stride_data = [
        ("Spoofing (Pemalsuan)", "Penyerang memalsukan nomor telepon pengirim melalui gateway SMS/chat.", "Autentikasi kriptografi protokol Baileys (Noise Protocol) + Verifikasi PIN 2FA."),
        ("Tampering (Injeksi)", "Penyerang menyisipkan payload shell injection (misal: !block 1.1.1.1; rm -rf /).", "Validasi parameter kaku dengan Regex IPv4 / alphanumeric only. No arbitrary shell."),
        ("Repudiation (Penyangkalan)", "Admin menyangkal telah mengeksekusi perintah isolasi atau restart.", "Audit logging waktu nyata dengan timestamp ISO dan pencatatan event ID di server."),
        ("Information Disclosure", "Penyerang menyadap data kredensial WhatsApp atau konfigurasi bot.", "Kredensial session_auth/ dan .env diisolasi di disk lokal dan diabaikan oleh .gitignore."),
        ("Denial of Service", "Penyerang mengirim ribuan pesan teks untuk membanjiri antrean proses bot.", "Intruder Alert Rate Limiter (1 alert per 3 menit) dan silent drop tanpa konsumsi komputasi."),
        ("Elevation of Privilege", "User biasa mencoba mengeksekusi restart container atau memutus firewall.", "Whitelist nomor telepon eksklusif + Wajib verifikasi PIN sebelum tindakan destruktif.")
    ]

    for row in stride_data:
        r_cells = stride_table.add_row().cells
        for idx, val in enumerate(row):
            r_cells[idx].text = val
            set_cell_margins(r_cells[idx], top=80, bottom=80, left=100, right=100)

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    # BAB IV
    doc.add_heading("BAB IV: STEP-BY-STEP ROADMAP PENELITIAN MENUJU PUBLIKASI Q1", level=1)
    doc.add_paragraph(
        "Untuk mencapai kriteria publikasi jurnal internasional bereputasi Scopus Q1, penelitian ini harus mengikuti "
        "tahapan metodologi ilmiah yang sistematis, terukur, dan dapat direproduksi (reproducible):"
    )

    roadmap_steps = [
        ("Fase 1: Systematic Literature Review & Formalisasi Gap (Minggu 1-2)",
         "• Melakukan telaah terhadap 30-40 paper terbaru (2022-2026) dari database Scopus/IEEE Xplore seputar ChatOps, SIEM, dan Zero-Trust.\n"
         "• Memetakan kelemahan alat yang ada (Wazuh, Telegram Security Bot, Splunk Phantom).\n"
         "• Merumuskan novelty matriks yang membedakan riset ini secara signifikan."),
        
        ("Fase 2: Perancangan Testbed Eksperimen Virtual (Minggu 3-4)",
         "• Membangun lingkungan uji terkontrol (Isolated Virtual Testbed):\n"
         "  1. Target Host Windows: Windows 11 Pro / Server 2022 (Host Fisik saat ini).\n"
         "  2. Target Host Linux: Ubuntu 24.04 LTS VM (untuk pengujian cross-platform).\n"
         "  3. Attacker Node: Kali Linux 2026 (dilengkapi Hydra, Nmap, Metasploit, EICAR generator).\n"
         "  4. Telemetry Collector: Prometheus & Grafana untuk mencatat lonjakan CPU, RAM, dan network socket."),
        
        ("Fase 3: Eksekusi Skenario Pengujian Serangan Siber (Minggu 5-7)",
         "• Pengujian Skenario 1 (Brute-Force Attack): Menembakkan 500 percobaan login SSH/RDP per menit. Mengukur MTTD dan MTTR bot memblokir IP via Firewall.\n"
         "• Pengujian Skenario 2 (Malware & Trojan Injection): Mengunggah payload uji malware (EICAR dan simulasi script trojan). Mengukur waktu deteksi dan notifikasi darurat ke WA.\n"
         "• Pengujian Skenario 3 (Prompt Injection & Adversarial Attack): Menyerang AI/bot dengan 100 variasi prompt jailbreak untuk menguji ketahanan sandbox.\n"
         "• Pengujian Skenario 4 (Resource Overhead & Latency Benchmark): Mengukur dampak bot terhadap utilitas server (CPU spike < 1%, RAM < 80MB) dan waktu pengiriman pesan (< 2.5 detik)."),
        
        ("Fase 4: Analisis Hasil & Komparasi State-of-the-Art (Minggu 8-9)",
         "• Menyusun grafik perbandingan MTTR (Mean Time to Respond): Pendekatan Manual (15-45 menit) vs SIEM Standar (5-10 menit) vs SecOps WA Agent (< 15 detik).\n"
         "• Menghitung metrik Confusion Matrix: True Positive Rate (TPR), False Positive Rate (FPR), dan Detection Accuracy.\n"
         "• Validasi kehandalan Zero-Trust PIN authentication."),
        
        ("Fase 5: Penulisan Manuskrip Standar IMRaD & Submission (Minggu 10-12)",
         "• Menyusun naskah berbahasa Inggris akademik sesuai format template jurnal target.\n"
         "• Proofreading profesional (native English review).\n"
         "• Melakukan submission ke jurnal bereputasi tinggi Q1.")
    ]

    for title, desc in roadmap_steps:
        doc.add_heading(title, level=2)
        doc.add_paragraph(desc)

    # BAB V
    doc.add_heading("BAB V: DAFTAR TARGET JURNAL INTERNASIONAL REPUTASI Q1", level=1)
    doc.add_paragraph(
        "Berikut adalah jurnal ilmiah target dengan reputasi Scopus Q1 yang sangat relevan dengan topik Cyber Defense, "
        "ChatOps, and Distributed Systems Security:"
    )

    j_table = doc.add_table(rows=1, cols=4)
    j_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    j_hdr = j_table.rows[0].cells
    j_hdr[0].text = "Nama Jurnal"
    j_hdr[1].text = "Penerbit & Indeks"
    j_hdr[2].text = "Impact Factor (IF)"
    j_hdr[3].text = "Fokus & Kesesuaian"
    for c in j_hdr:
        c.paragraphs[0].runs[0].font.bold = True
        c.paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        set_cell_background(c, "1F497D")

    journals = [
        ("Computers & Security", "Elsevier (Scopus Q1)", "5.6", "Sangat cocok untuk arsitektur SecOps praktis, evaluasi malware, dan insiden respons."),
        ("IEEE Transactions on Dependable and Secure Computing (TDSC)", "IEEE Computer Society (Q1)", "7.2", "Sangat prestisius; menuntut pemodelan matematis formal dan evaluasi STRIDE yang mendalam."),
        ("Cybersecurity", "Springer Nature (Scopus Q1)", "4.5", "Jurnal Open Access bereputasi tinggi dengan proses review transparan dan fokus pada sistem terapan."),
        ("Computer Networks", "Elsevier (Scopus Q1)", "5.4", "Sangat tepat untuk aspek boundary isolation, Cloudflare tunneling, dan mitigasi DDoS/brute-force."),
        ("Sensors (Cybersecurity Section)", "MDPI (Scopus Q1)", "3.9", "Proses review cepat (~4-6 minggu), sangat ramah untuk pengujian performa testbed dan latency IoT/Server.")
    ]

    for row in journals:
        r_cells = j_table.add_row().cells
        for idx, val in enumerate(row):
            r_cells[idx].text = val
            set_cell_margins(r_cells[idx], top=80, bottom=80, left=100, right=100)

    doc.add_paragraph().paragraph_format.space_after = Pt(20)

    # CLOSING NOTE
    p_close = doc.add_paragraph()
    p_close.add_run("Kesimpulan Dokumen:\n").bold = True
    p_close.add_run(
        "Sistem 'Server Security Guard Agent' yang telah aktif di server ini telah memenuhi standar teknis fungsional "
        "yang siap dijadikan artefak riset orisinal. Langkah selanjutnya adalah mengeksekusi uji penetrasi (penetration test) "
        "pada testbed untuk mengumpulkan data kuantitatif MTTD, MTTR, dan resource overhead."
    )

    out_path_1 = r"D:\AI-Server\security-agent\docs\Spesifikasi_Fitur_dan_Rencana_Penelitian_Q1.docx"
    out_path_2 = r"D:\AI-Server\Spesifikasi_Fitur_dan_Rencana_Penelitian_Q1.docx"
    
    doc.save(out_path_1)
    doc.save(out_path_2)
    print(f"[OK] Dokumen berhasil dibuat di:\n - {out_path_1}\n - {out_path_2}")

if __name__ == "__main__":
    create_document()
