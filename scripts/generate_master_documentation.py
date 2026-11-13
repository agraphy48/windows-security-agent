# -*- coding: utf-8 -*-
"""
Generator Master Dokumentasi Teknis Sistem HA-Cluster, Disaster Recovery, dan SecOps Agent
Format: Microsoft Word (.docx)
"""

import os
import sys
import docx
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn

def create_document():
    doc = Document()

    # 1. Page Setup (A4, 2 cm margins)
    for section in doc.sections:
        section.top_margin = Inches(0.8)
        section.bottom_margin = Inches(0.8)
        section.left_margin = Inches(0.8)
        section.right_margin = Inches(0.8)
        section.different_first_page_header_footer = True
        
        # Header & Footer setup for subsequent pages
        header = section.header
        hp = header.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hrun = hp.add_run("Dokumentasi Arsitektur Teknologi HA-Cluster & SecOps | Kedukan Aksara - EGN")
        hrun.font.name = "Calibri"
        hrun.font.size = Pt(8.5)
        hrun.font.color.rgb = RGBColor(148, 163, 184)

        footer = section.footer
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        frun = fp.add_run("Klasifikasi: DOKUMEN TEKNIS INTERNAL - RAHASIA & PROPRIETARY")
        frun.font.name = "Calibri"
        frun.font.size = Pt(8.5)
        frun.font.color.rgb = RGBColor(148, 163, 184)

    # Styling Palette
    COLOR_PRIMARY = RGBColor(30, 58, 138)    # #1E3A8A - Deep Navy Blue
    COLOR_SECONDARY = RGBColor(37, 99, 235)  # #2563EB - Royal Blue
    COLOR_DARK = RGBColor(15, 23, 42)        # #0F172A - Slate Dark Text
    COLOR_MUTED = RGBColor(100, 116, 139)    # #64748B - Gray Subtitle
    COLOR_EMERALD = RGBColor(5, 150, 105)    # #059669 - Green Success
    HEX_PRIMARY = "1E3A8A"
    HEX_LIGHT_BG = "F8FAFC"
    HEX_BORDER = "CBD5E1"
    HEX_CALLOUT_BG = "F1F5F9"
    HEX_CALLOUT_BORDER = "2563EB"

    # Helper Functions
    def add_title(text):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(24)
        p.paragraph_format.space_after = Pt(4)
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(24)
        run.font.bold = True
        run.font.color.rgb = COLOR_PRIMARY
        return p

    def add_subtitle(text):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(18)
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(12)
        run.font.color.rgb = COLOR_MUTED
        return p

    def add_h1(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(22)
        p.paragraph_format.space_after = Pt(8)
        p.paragraph_format.keep_with_next = True
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(16)
        run.font.bold = True
        run.font.color.rgb = COLOR_PRIMARY
        return p

    def add_h2(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(14)
        p.paragraph_format.space_after = Pt(5)
        p.paragraph_format.keep_with_next = True
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(13)
        run.font.bold = True
        run.font.color.rgb = COLOR_SECONDARY
        return p

    def add_h3(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(10)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.keep_with_next = True
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(11)
        run.font.bold = True
        run.font.color.rgb = COLOR_DARK
        return p

    def add_body(text, bold_prefix=None, space_after=6):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.line_spacing = 1.18
        if bold_prefix:
            run_b = p.add_run(bold_prefix)
            run_b.font.name = "Calibri"
            run_b.font.size = Pt(10.5)
            run_b.font.bold = True
            run_b.font.color.rgb = COLOR_DARK
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(10.5)
        run.font.color.rgb = COLOR_DARK
        return p

    def add_bullet(text, bold_prefix=None):
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.15
        if bold_prefix:
            run_b = p.add_run(bold_prefix)
            run_b.font.name = "Calibri"
            run_b.font.size = Pt(10)
            run_b.font.bold = True
            run_b.font.color.rgb = COLOR_DARK
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(10)
        run.font.color.rgb = COLOR_DARK
        return p

    def add_callout(title, body_text):
        tbl = doc.add_table(rows=1, cols=1)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = tbl.cell(0, 0)
        cell.width = Inches(6.8)
        tcPr = cell._tc.get_or_add_tcPr()
        
        # Shading
        shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{HEX_CALLOUT_BG}"/>')
        tcPr.append(shd)
        
        # Left thick border, no other borders
        borders = parse_xml(f'''
            <w:tcBorders {nsdecls("w")}>
                <w:top w:val="none"/>
                <w:left w:val="single" w:sz="36" w:space="0" w:color="{HEX_CALLOUT_BORDER}"/>
                <w:bottom w:val="none"/>
                <w:right w:val="none"/>
            </w:tcBorders>
        ''')
        tcPr.append(borders)
        
        # Margins inside cell
        mar = parse_xml(f'''
            <w:tcMar {nsdecls("w")}>
                <w:top w:w="140" w:type="dxa"/>
                <w:left w:w="200" w:type="dxa"/>
                <w:bottom w:w="140" w:type="dxa"/>
                <w:right w:w="200" w:type="dxa"/>
            </w:tcMar>
        ''')
        tcPr.append(mar)

        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(3)
        run_t = p.add_run(f"📌 {title}: ")
        run_t.font.name = "Calibri"
        run_t.font.size = Pt(10.5)
        run_t.font.bold = True
        run_t.font.color.rgb = COLOR_SECONDARY

        run_b = p.add_run(body_text)
        run_b.font.name = "Calibri"
        run_b.font.size = Pt(10)
        run_b.font.color.rgb = COLOR_DARK

        doc.add_paragraph().paragraph_format.space_after = Pt(4)

    def style_table(table, col_widths, headers, data):
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        # Header Row
        hdr_cells = table.rows[0].cells
        for i, h_text in enumerate(headers):
            hdr_cells[i].text = h_text
            tcPr = hdr_cells[i]._tc.get_or_add_tcPr()
            shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{HEX_PRIMARY}"/>')
            tcPr.append(shd)
            mar = parse_xml(f'<w:tcMar {nsdecls("w")}><w:top w:w="120" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>')
            tcPr.append(mar)
            p = hdr_cells[i].paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for r in p.runs:
                r.font.name = "Calibri"
                r.font.size = Pt(9.5)
                r.font.bold = True
                r.font.color.rgb = RGBColor(255, 255, 255)

        # Data Rows
        for r_idx, row_data in enumerate(data):
            row = table.rows[r_idx + 1]
            bg_color = HEX_LIGHT_BG if (r_idx % 2 == 1) else "FFFFFF"
            for c_idx, val in enumerate(row_data):
                cell = row.cells[c_idx]
                cell.text = str(val)
                tcPr = cell._tc.get_or_add_tcPr()
                if bg_color != "FFFFFF":
                    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{bg_color}"/>')
                    tcPr.append(shd)
                mar = parse_xml(f'<w:tcMar {nsdecls("w")}><w:top w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>')
                tcPr.append(mar)
                p = cell.paragraphs[0]
                p.paragraph_format.space_before = Pt(0)
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.1
                for r in p.runs:
                    r.font.name = "Calibri"
                    r.font.size = Pt(9.5)
                    r.font.color.rgb = COLOR_DARK

        # Apply column widths & borders to all rows
        for row in table.rows:
            trPr = row._tr.get_or_add_trPr()
            trPr.append(parse_xml(f'<w:cantSplit {nsdecls("w")}/>'))
            for c_idx, w in enumerate(col_widths):
                row.cells[c_idx].width = Inches(w)
                tcPr = row.cells[c_idx]._tc.get_or_add_tcPr()
                borders = parse_xml(f'''
                    <w:tcBorders {nsdecls("w")}>
                        <w:top w:val="single" w:sz="4" w:space="0" w:color="{HEX_BORDER}"/>
                        <w:left w:val="single" w:sz="4" w:space="0" w:color="{HEX_BORDER}"/>
                        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="{HEX_BORDER}"/>
                        <w:right w:val="single" w:sz="4" w:space="0" w:color="{HEX_BORDER}"/>
                    </w:tcBorders>
                ''')
                tcPr.append(borders)

        doc.add_paragraph().paragraph_format.space_after = Pt(4)

    # =========================================================================
    # COVER / HEADER PAGE
    # =========================================================================
    add_title("BUKU PANDUAN & DOKUMENTASI TEKNOLOGI ARSITEKTUR SISTEM")
    add_subtitle("Enterprise Multi-Cloud High-Availability Cluster, Zero-Trust Disaster Recovery & Autonomous SecOps Agent\nPT Expro Gio Nusantara & Kedukan Aksara (Tahun 2026)")

    # Document Metadata Table
    meta_headers = ["Atribut Dokumen", "Keterangan Spesifikasi"]
    meta_data = [
        ["Judul Arsitektur", "High-Availability Distributed Cluster, Autonomous SecOps & Disaster Recovery"],
        ["Lingkungan Infrastruktur", "Hybrid Multi-Cloud: Hostinger Cloud VPS, Hyper-V VM (LAN), Host Windows 11 Pro"],
        ["Sistem Operasi", "AlmaLinux 9 Minimal (Cloud-Init), Windows 11 Enterprise / Pro x64"],
        ["Target Ketersediaan", "High Availability (HA) Failover RPO ~ 0 Menit, RTO < 30 Detik"],
        ["Pengembang & Operator", "Tim Rekayasa Keamanan Siber & Tim Infrastruktur Cloud Kedukan Aksara"],
        ["Klasifikasi Keamanan", "PROPRIETARY & CONFIDENTIAL - INTERNAL INFRASTRUCTURE MANUAL"],
        ["Versi Dokumen", "Versi 2.4.0 (Full Synchronization & Dynamic Web Portal Catalog Edition)"],
        ["Tanggal Berlaku", "November 2026"]
    ]
    meta_table = doc.add_table(rows=len(meta_data)+1, cols=2)
    style_table(meta_table, [2.3, 4.5], meta_headers, meta_data)

    add_callout(
        "RINGKASAN EKSEKUTIF ARSITEKTUR",
        "Dokumen teknis ini merangkum secara menyeluruh seluruh rekayasa teknologi, standar keamanan tingkat tinggi (Zero-Trust), arsitektur redundansi multi-server, replikasi basis data real-time, integrasi kecerdasan buatan otonom, dan portal navigasi terpadu yang telah dibangun secara operasional untuk menjamin ketersediaan 100% dari 31+ aplikasi bisnis dan publik PT Expro Gio Nusantara serta Kedukan Aksara."
    )

    doc.add_page_break()

    # =========================================================================
    # BAB 1: TOPOLOGI MULTI-NODE HYBRID CLUSTER
    # =========================================================================
    add_h1("BAB 1: ARSITEKTUR & TOPOLOGI MULTI-NODE HYBRID CLUSTER")
    add_body(
        "Sistem infrastruktur dirancang menggunakan paradigma Multi-Node Hybrid Cluster yang menggabungkan kekuatan komputasi Public Cloud VPS, Private Virtualization Hyper-V pada jaringan lokal, dan Host Windows sebagai koordinator kecerdasan buatan dan orkestrasi jaringan Zero-Trust. Topologi ini terdiri dari 3 simpul (node) utama:"
    )

    cluster_headers = ["Identitas Node", "Peran Cluster", "Lingkungan Fisik / Virtual", "Alamat IP & Jaringan", "Komponen Utama"]
    cluster_data = [
        [
            "node-01\n(Standby Master)",
            "Standby Coordinator &\nFailover Gateway",
            "Host Fisik Windows 11 Pro\n(Intel Xeon 24 vCPU, 32GB RAM)",
            "Localhost (:5005)\nCloudflare Ingress (QUIC)",
            "Node.js Agent, Cloudflare Argo Tunnel, Docker CBT, Ollama LLM (Llama 3.2:3b)"
        ],
        [
            "node-02\n(Primary Master)",
            "Master Koordinator &\nCloud Web Services",
            "Public Cloud VPS AlmaLinux 9\n(Hostinger Cloud Data Center)",
            "Publik: 62.72.20.122\nTailscale: node-vps",
            "CyberPanel, OpenLiteSpeed (31 VHosts), MariaDB 10.11, Baileys WhatsApp Gateway, GDrive Backup"
        ],
        [
            "node-03\n(Worker Node)",
            "Local Disaster Recovery &\nHigh-Availability Mirror",
            "VM Hyper-V Gen 2 (UEFI)\n(8 vCPU, 16GB RAM, 150GB VHDX)",
            "LAN: 192.168.18.81\nTailscale: 100.110.122.22",
            "OpenLiteSpeed Mirror, MariaDB Replikasi 16 DB, 31 Linux User Replica, CyberPanel :8090"
        ]
    ]
    cluster_tbl = doc.add_table(rows=len(cluster_data)+1, cols=5)
    style_table(cluster_tbl, [1.1, 1.2, 1.6, 1.4, 1.5], cluster_headers, cluster_data)

    add_h2("1.1. Perincian Node-01 (Host Windows 11 Pro - Standby & AI Gateway)")
    add_bullet("Beroperasi sebagai Primary Standby Coordinator yang terus-menerus memantau kesehatan Node-02 (VPS) setiap 30 detik melalui failover watcher.", "Fungsi Koordinasi: ");
    add_bullet("Menjalankan Large Language Model (LLM) Llama 3.2:3b pada port 11434 untuk analisis ancaman, pembuatan tanggapan cerdas, dan mitigasi otomatis.", "AI Engine Terpasang: ");
    add_bullet("Mengoperasikan client Cloudflare Tunnel (cloudflared.exe) untuk mengarahkan trafik internet terenkripsi tanpa membuka port inbound pada router publik.", "Zero-Trust Tunnel: ");
    add_bullet("Menjalankan tumpukan Docker CBT (Computer-Based Testing) offline-first yang siap melayani ujian massal tanpa ketergantungan koneksi internet luar.", "Docker Containers: ");

    add_h2("1.2. Perincian Node-02 (Cloud VPS AlmaLinux 9 - Master Koordinator)")
    add_bullet("Menampung 31 direktori situs web dan 42 virtual host produksi aktif di bawah pengelolaan OpenLiteSpeed Enterprise grade.", "Hosting Produksi: ");
    add_bullet("Menyediakan RDBMS MariaDB 10.11 dengan 16 database produksi untuk aplikasi POS, Keuangan, CV Agus, Toko, Bimbel, dan Sekolah.", "Basis Data Utama: ");
    add_bullet("Menjalankan soket Baileys WhatsApp multi-device gateway sebagai antarmuka komando utama administrator via WhatsApp.", "Soket WhatsApp: ");
    add_bullet("Mengeksekusi cron rclone ke Google Drive setiap jam 02:00 WIB dan sinkronisasi database ke local setiap 6 jam via Tailscale.", "Sistem Backup Otomatis: ");

    add_h2("1.3. Perincian Node-03 (Hyper-V VM AlmaLinux 9 - Local Disaster Recovery)")
    add_bullet("Dibuat menggunakan otomatisasi Hyper-V Gen 2 (UEFI) dengan Secure Boot aktif (MicrosoftUEFICertificateAuthority).", "Virtualisasi Generasi 2: ");
    add_bullet("Menggunakan ExternalSwitch bridging adapter fisik motherboard sehingga mendapatkan IP LAN mandiri (192.168.18.81).", "Konektivitas Bridge LAN: ");
    add_bullet("Menampung salinan identik seluruh web di /home/vps_mirror/ yang di-symlink ke /home/<domain> dengan kepemilikan UID Linux yang sesuai 100%.", "Replikasi 1:1 Berkas: ");
    add_bullet("Menjalankan MariaDB lokal yang menerima replikasi streaming seluruh basis data produksi dan konfigurasi hak akses user aplikasi.", "MariaDB Standby Replikasi: ");

    # =========================================================================
    # BAB 2: INFRASTRUKTUR JARINGAN TERENKRIPSI & ZERO-TRUST TUNNELING
    # =========================================================================
    add_h1("BAB 2: JARINGAN TERENKRIPSI & ZERO-TRUST TUNNELING")
    add_body(
        "Konektivitas antar-server dan akses publik ke sistem dirancang dengan prinsip Zero-Trust Security. Tidak ada port sensitif (seperti SSH Port 22, CyberPanel Port 8090, atau MySQL Port 3306) yang dibuka secara terbuka ke publik internet tanpa enkripsi berlapis."
    )

    add_h2("2.1. Jaringan Privat Mesh Tailscale (WireGuard)")
    add_body(
        "Komunikasi antara Node-02 (Cloud VPS) dan Node-03 (Hyper-V VM) dihubungkan menggunakan jaringan mesh privat Tailscale berbasis protokol modern WireGuard (kriptografi ChaCha20-Poly1305 dan Curve25519).",
        bold_prefix="Konektivitas Antar-Server: "
    )
    add_bullet("node-vps: Mengarahkan komunikasi langsung ke VPS AlmaLinux 9 di Cloud.", "Hostname Internal: ");
    add_bullet("node-local (100.110.122.22): Mengarahkan komunikasi langsung ke Hyper-V VM di LAN Palembang.", "Hostname Internal: ");
    add_bullet("Replikasi database MySQL, rsync berkas website, dan pertukaran sinyal detak jantung cluster mengalir lewat jalur ini tanpa bisa disadap pihak ketiga.", "Keuntungan Keamanan: ");

    add_h2("2.2. Cloudflare Argo Tunnel (Edge Multiplexing & SSL Otomatis)")
    add_body(
        "Cloudflare Argo Tunnel (cloudflared.exe) dioperasikan pada Node-01 untuk menghubungkan pengunjung internet dengan aplikasi internal pada server lokal tanpa perlu IP Publik Statis, tanpa port forwarding pada router WiFi/ISP (Indihome/MyRepublic), dan terlindungi dari serangan DDoS.",
        bold_prefix="Akses Publik Terenkripsi: "
    )

    cf_headers = ["Domain / Hostname Publik", "Target Layanan Internal", "Keterangan Routing & Header Injeksi"]
    cf_data = [
        ["portal.kedukanaksara.com", "http://localhost:5005", "Dashboard Web Portal Navigasi Terpadu Seluruh Layanan"],
        ["secops.kedukanaksara.com", "http://localhost:5005", "SecOps Command Center, 2FA Emergency Portal & Audit"],
        ["cbt.kedukanaksara.com", "http://localhost:80", "Docker Frontend Ujian Online CBT Offline-First (Nginx/Go)"],
        ["pos.portal-egn.com", "http://192.168.18.81:80", "Failover Aplikasi POS Kasir SaaS (Hyper-V OpenLiteSpeed)"],
        ["pos.kedukanaksara.com", "http://192.168.18.81:80", "Testing Cermin POS (Host Header: pos.portal-egn.com)"],
        ["agus.portal-egn.com", "http://192.168.18.81:80", "Failover Aplikasi CV Agus Setiawan (Hyper-V OLS)"],
        ["agus.kedukanaksara.com", "http://192.168.18.81:80", "Testing Cermin Agus (Host Header: agus.portal-egn.com)"],
        ["keu.portal-egn.com", "http://192.168.18.81:80", "Failover Aplikasi Keuangan EGN (Hyper-V OLS)"],
        ["keu.kedukanaksara.com", "http://192.168.18.81:80", "Testing Cermin Keu (Host Header: keu.portal-egn.com)"],
        ["toko.exprogionusantara.my.id", "http://192.168.18.81:80", "Failover Toko E-Commerce EGN (Hyper-V OLS)"],
        ["ukp.portal-egn.com", "http://192.168.18.81:80", "Failover Portal Bimbel UKP (Hyper-V OLS)"],
        ["local-cyberpanel.kedukanaksara.com", "https://192.168.18.81:8090", "Akses Aman ke CyberPanel Hyper-V (noTLSVerify: true)"]
    ]
    cf_tbl = doc.add_table(rows=len(cf_data)+1, cols=3)
    style_table(cf_tbl, [2.2, 1.8, 2.8], cf_headers, cf_data)

    # =========================================================================
    # BAB 3: ARSITEKTUR DISASTER RECOVERY & FAILOVER DOMAIN ASLI
    # =========================================================================
    add_h1("BAB 3: ARSITEKTUR DISASTER RECOVERY & FAILOVER DOMAIN ASLI")
    add_body(
        "Kunci utama dari implementasi Pilihan 1 (Failover Domain Asli) adalah memastikan bahwa saat VPS Utama di Cloud mati, seluruh pengguna tidak perlu diarahkan ke URL lain atau mengganti subdomain. Mereka tetap mengakses alamat asli yang sama, dan trafik dialihkan secara instan ke server lokal Hyper-V."
    )

    add_h2("3.1. Penyelarasan Akun Linux & Hak Akses Berkas (UID/GID Mirroring)")
    add_body(
        "Setiap situs web di CyberPanel dijalankan di bawah akun Linux khusus (misal: agusp6886, pospo1911, eduka9750). Jika file disalin tanpa user yang sesuai, OpenLiteSpeed akan menghasilkan error 403 Forbidden atau 500 Internal Server Error."
    )
    add_bullet("Seluruh 31 user Linux dari UID 5002 hingga UID 5035 disinkronkan secara eksak ke /etc/passwd dan /etc/group di Hyper-V.", "Otomatisasi User: ");
    add_bullet("Folder /home/vps_mirror/<domain> memiliki izin kepemilikan persis sama dengan VPS asli.", "Integritas Izin: ");
    add_bullet("Dibuat symlink di /home/<domain> yang merujuk ke /home/vps_mirror/<domain> sehingga konfigurasi OpenLiteSpeed tidak perlu diubah jalur absolutnya.", "Struktur Symlink: ");

    add_h2("3.2. Penyelarasan Virtual Host OpenLiteSpeed")
    add_body(
        "OpenLiteSpeed di Node-03 (Hyper-V) dikonfigurasikan mendengarkan listener Default port 80 dan listener SSL port 443 dengan pemetaan 42 Virtual Host identik dengan VPS asli."
    )
    add_bullet("File vhost.conf untuk setiap domain disimpan di /usr/local/lsws/conf/vhosts/<domain>/vhost.conf.", "VHost Directory: ");
    add_bullet("Direktori httpd_config.conf memetakan seluruh nama domain asli ke virtual host masing-masing.", "Global Config: ");
    add_bullet("Diverifikasi dengan perintah openlitespeed -t untuk memastikan sintaks 100% valid sebelum reload.", "Validasi Sintaks: ");

    add_h2("3.3. Replikasi Basis Data MariaDB & Hak Akses Aplikasi")
    add_body(
        "Aplikasi web modern seperti Laravel KasirDigital (POS) dan CV Agus memerlukan koneksi basis data yang sah. Penyelarasan basis data di Hyper-V mencakup dua aspek penting:"
    )
    add_bullet("16 Basis Data Produksi (pos_saas, agus_cv, keu_egn, toko_egn, ukp_bimbel, kedu_aksara, polr_palembang, sman_10plg, dsb) direplikasi secara utuh.", "Basis Data: ");
    add_bullet("Seluruh kredensial diekstrak dari file .env aplikasi dan dibuatkan user MariaDB lokal untuk localhost dan 127.0.0.1 (contoh: pos_user, agus_cv, keu_egn).", "Kredensial User: ");
    add_bullet("Uji coba lokal menghasilkan HTTP 200 OK untuk seluruh aplikasi penting yang siap melayani transaksi.", "Hasil Pengujian: ");

    # =========================================================================
    # BAB 4: MESIN OTOMATISASI SINKRONISASI VPS (vpsClusterSyncer.js)
    # =========================================================================
    add_h1("BAB 4: MESIN OTOMATISASI SINKRONISASI VPS (vpsClusterSyncer.js)")
    add_body(
        "Untuk menjawab kebutuhan operasional dinamis di mana administrator sering menambahkan website, subdomain, atau basis data baru di VPS, dibangun modul mesin otonom vpsClusterSyncer.js. Modul ini menjamin bahwa setiap penambahan di VPS akan langsung dicerminkan ke server lokal tanpa campur tangan manusia."
    )

    add_h2("4.1. Siklus Kerja Pemindaian Otonom (Autonomous Scanning Loop)")
    add_bullet("Timer background berjalan setiap 5 menit (dapat diatur di konfigurasi) untuk memindai daftar VHost, direktori /home/, dan daftar basis data di VPS.", "Interval Pemindaian: ");
    add_bullet("Sistem membandingkan kondisi VPS terkini dengan database status lokal (vps-sync-state.json).", "Deteksi Anomali / Perubahan: ");
    add_bullet("Jika terdeteksi ada domain baru yang belum ada di Hyper-V, alur kerja replikasi multi-tahap dipicu seketika.", "Triger Eksekusi: ");

    add_h2("4.2. Alur Kerja Replikasi Otomatis Multi-Tahap")
    add_body("Saat website baru terdeteksi, mesin sinkronisasi mengeksekusi tahapan berikut secara berurutan:")
    add_bullet("Rsync berkas direktori web dari node-vps:/home/<domain>/ ke /home/vps_mirror/<domain>/ dengan mengecualikan folder logs dan .git.", "Tahap 1 (File Replikasi): ");
    add_bullet("Membuat symlink /home/<domain> -> /home/vps_mirror/<domain>.", "Tahap 2 (Symlink): ");
    add_bullet("Menyalin akun pengguna Linux pemilik direktori dari /etc/passwd dan /etc/group VPS ke Hyper-V.", "Tahap 3 (User Account): ");
    add_bullet("Menyalin konfigurasi vhost.conf dan mendaftarkan pemetaan ke /usr/local/lsws/conf/httpd_config.conf.", "Tahap 4 (OpenLiteSpeed): ");
    add_bullet("Mengeksekusi graceful reload OpenLiteSpeed (systemctl reload lsws) di Hyper-V.", "Tahap 5 (Reload Web Server): ");
    add_bullet("Jika ada database baru, membuat CREATE DATABASE dan streaming mysqldump via SSH gzip pipe ke MariaDB Hyper-V.", "Tahap 6 (Database Sync): ");
    add_bullet("Memperbarui file C:\\Users\\agrap\\.cloudflared\\config.yml dengan menambahkan failover ingress hostname baru.", "Tahap 7 (Cloudflare Ingress): ");
    add_bullet("Mendaftarkan aplikasi baru ke data/portal-apps.json sehingga otomatis muncul sebagai kartu di portal navigasi.", "Tahap 8 (Portal Web Update): ");

    # =========================================================================
    # BAB 5: DASHBOARD WEB PORTAL NAVIGASI TERPADU (portal.kedukanaksara.com)
    # =========================================================================
    add_h1("BAB 5: DASHBOARD WEB PORTAL NAVIGASI TERPADU (portal.kedukanaksara.com)")
    add_body(
        "Web Portal Navigasi Terpadu (tersedia di https://portal.kedukanaksara.com, http://localhost:5005/apps, dan http://localhost:5005/portal) dibangun sebagai antarmuka sentral tunggal untuk mengakses seluruh ekosistem aplikasi organisasi."
    )

    add_h2("5.1. Desain & Arsitektur Antarmuka (Dark Glassmorphism UI)")
    add_bullet("Latar belakang bertema Dark Space Gradient (#1e1b4b ke #0b0f19) dengan kartu kaca transparan (backdrop-filter: blur(12px)).", "Estetika Desain: ");
    add_bullet("Tata letak grid responsif dinamis yang menyesuaikan layar monitor workstation, tablet, dan smartphone.", "Responsif Penuh: ");
    add_bullet("Dilengkapi jam digital real-time Waktu Indonesia Barat (WIB) dan badge status kesehatan simpul (Node-01, Node-02, Node-03).", "Indikator Real-Time: ");

    add_h2("5.2. Fitur Interaktif Tingkat Tinggi")
    add_bullet("Pengguna dapat mengetik nama aplikasi, subdomain, atau kata kunci untuk menyaring kartu secara seketika tanpa refresh.", "Live Search Bar: ");
    add_bullet("Tersedia 9 tab kategori: Semua (29), Prioritas, Kasir & SaaS, Administrasi, CBT & Edukasi, Keuangan, Infrastruktur, AI & Otomasi, Media.", "Filter Tabs Kategori: ");
    add_bullet("Setiap kartu aplikasi menyediakan 2 tombol akses cerdas: [Buka Server Utama (VPS)] untuk akses normal, dan [Buka Cermin Failover (Local)] untuk akses cadangan.", "Aksi Tombol Ganda: ");
    add_bullet("Tombol di header portal yang dapat diklik pengguna untuk memaksa sinkronisasi instan dari VPS dengan animasi spinning dan live toast feedback.", "Tombol Sinkronisasi Instan: ");

    add_h2("5.3. Katalog Aplikasi Produksi yang Terdaftar Saat Ini")
    add_body("Saat ini sebanyak 29 aplikasi produksi telah terindeks secara dinamis dalam portal-apps.json:")

    app_headers = ["No", "Nama Aplikasi / Layanan", "Domain Publik", "Kategori Layanan", "Status Failover"]
    app_data = [
        ["1", "Aplikasi POS Multi-Cabang (Kasir)", "pos.portal-egn.com", "Kasir & Retail SaaS", "Siap di Hyper-V (200 OK)"],
        ["2", "Aplikasi CV Agus Setiawan", "agus.portal-egn.com", "Sistem Administrasi", "Siap di Hyper-V (200 OK)"],
        ["3", "Ujian Online CBT / LMS", "cbt.kedukanaksara.com", "CBT & LMS Offline-First", "Aktif di Docker Windows (200 OK)"],
        ["4", "Sistem Keuangan EGN", "keu.portal-egn.com", "Keuangan & Akuntansi", "Siap di Hyper-V (200 OK)"],
        ["5", "Panel CyberPanel Hyper-V", "local-cyberpanel.kedukanaksara.com", "Infrastruktur Server", "Aktif di Hyper-V Port 8090"],
        ["6", "SecOps Command Center & Defense", "pentest.portal-egn.com", "Keamanan & Monitoring AI", "Aktif di Node-01 (:5005)"],
        ["7", "Toko E-Commerce EGN", "toko.exprogionusantara.my.id", "E-Commerce & Belanja", "Tersinkron di Hyper-V"],
        ["8", "Portal Bimbel UKP", "ukp.portal-egn.com", "Pendidikan & Akademik", "Siap di Hyper-V (200 OK)"],
        ["9", "Portal Korporat EGN", "portal-egn.com", "Korporat & Bisnis", "Siap di Hyper-V (200 OK)"],
        ["10", "Portal Polrestabes Palembang", "polrestabespalembang.portal-egn.com", "Layanan Kepolisian", "Siap di Hyper-V (200 OK)"],
        ["11", "SMA Negeri 10 Palembang", "smanegeri10palembang.sch.id", "Akademik & Sekolah", "Siap di Hyper-V (200 OK)"],
        ["12", "Sistem Informasi Sekolah EGN", "sekolah.exprogionusantara.my.id", "Akademik & Sekolah", "Siap di Hyper-V (200 OK)"],
        ["13", "Jasa Pajak Polsri", "jasapajakpolsri.com", "Konsultasi Perpajakan", "Siap di Hyper-V (200 OK)"],
        ["14", "Portal Berita EGN", "berita.portal-egn.com", "Media & Publikasi", "Siap di Hyper-V (200 OK)"],
        ["15", "Penerbit & Publikasi EGN", "penerbit.portal-egn.com", "Publikasi Karya Ilmiah", "Siap di Hyper-V (200 OK)"],
        ["16", "Sistem Informasi Sriwijaya", "sriwijaya.portal-egn.com", "Sistem Informasi Daerah", "Siap di Hyper-V (200 OK)"],
        ["17", "AI Chatbot & Intelligent Assistant", "chatbot.portal-egn.com", "AI & Otomasi Cerdas", "Siap di Hyper-V (200 OK)"],
        ["18", "REST API Gateway EGN", "api.portal-egn.com", "Backend & Developer API", "Siap di Hyper-V (200 OK)"],
        ["19", "Jurnal Ilmiah JLPP", "jlpp.exprogionusantara.my.id", "Riset & Jurnal Ilmiah", "Siap di Hyper-V (200 OK)"],
        ["20", "Portal CBT Edukasi Asli", "edukasi.portal-egn.com", "CBT & LMS Offline-First", "Tersinkron di Server Lokal"],
        ["21+", "Layanan Lainnya (10 Layanan Tambahan)", "Domain terkait *.portal-egn.com", "Layanan Web Otomatis", "Auto-Discovered & Terkatalog"]
    ]
    app_tbl = doc.add_table(rows=len(app_data)+1, cols=5)
    style_table(app_tbl, [0.4, 2.2, 1.8, 1.3, 1.1], app_headers, app_data)

    # =========================================================================
    # BAB 6: SISTEM KEAMANAN SIBER BERLAPIS (ZERO-TRUST SECOPS DEFENSE)
    # =========================================================================
    add_h1("BAB 6: SISTEM KEAMANAN SIBER BERLAPIS (ZERO-TRUST SECOPS DEFENSE)")
    add_body(
        "Keamanan sistem mengadopsi standar pertahanan industri modern (Defense-in-Depth) yang mengasumsikan bahwa setiap jaringan berpotensi disusupi (Zero-Trust Principle)."
    )

    add_h2("6.1. Proteksi Timing Attack (Constant-Time Safe Comparison)")
    add_body(
        "Semua verifikasi otentikasi (PIN keamanan WhatsApp, password login Web Portal, secret token cluster, dan kode OTP) wajib diproses melalui fungsi safeCompare() berbasis crypto.timingSafeEqual().",
        bold_prefix="Kriptografi Aman: "
    )
    add_bullet("Mencegah penyerang menebak PIN atau token menggunakan teknik pengukuran jeda waktu respon mikrodetik (Side-Channel Timing Attacks).", "Manfaat Pertahanan: ");
    add_bullet("Setiap input di-hash menjadi SHA-256 (32 bytes) sebelum dibandingkan, menjamin waktu perbandingan selalu konstan terlepas dari panjang karakter input.", "Mekanisme: ");

    add_h2("6.2. Otorisasi Zero-Trust PIN & Sesi Dinamis")
    add_bullet("Setiap perintah kritis administrator (misal: restart server, flush log, eksekusi perintah shell, atau sinkronisasi data) wajib menyertakan PIN 6-digit rahasia.", "Kebijakan PIN: ");
    add_bullet("Setelah PIN dimasukkan dengan benar, sesi terbuka selama 15 menit (PIN_TIMEOUT_MINUTES=15). Administrator dapat mengetik 'lock' untuk mengunci sesi seketika.", "Sesi Dinamis: ");
    add_bullet("Nomor asing yang mengirim pesan ke bot WhatsApp akan memicu notifikasi penyusup ke nomor administrator dan otomatis diblokir.", "Intruder Alert: ");

    add_h2("6.3. Autentikasi Web Portal: 2FA OTP via Email SMTP & CSRF Protection")
    add_bullet("Login ke dashboard komando darurat (/dashboard) menerapkan autentikasi 2-faktor (2FA).", "Dua Faktor Wajib: ");
    add_bullet("Setelah memasukkan username dan password yang benar, sistem menghasilkan kode OTP 6-digit numerik acak dengan masa berlaku 5 menit.", "OTP Acak: ");
    add_bullet("Kode OTP dikirimkan secara instan ke email terdaftar (agraphylearn@gmail.com) melalui SMTP.", "Pengiriman Email: ");
    add_bullet("Dilindungi anti-CSRF token per sesi untuk menangkal serangan Cross-Site Request Forgery.", "Perlindungan CSRF: ");

    add_h2("6.4. Rate Limiting & Anti-Brute Force Protection")
    add_bullet("Cluster REST API dibatasi maksimal 300 request per menit per alamat IP.", "Rate Limiting Cluster: ");
    add_bullet("Jika terjadi 5 kali kegagalan login berturut-turut pada Web Portal, IP penyerang otomatis diblokir sementara (banned) selama 30 menit.", "Proteksi Brute-Force: ");

    # =========================================================================
    # BAB 7: AGEN OTONOM WHATSAPP SECOPS & INTEGRASI AI
    # =========================================================================
    add_h1("BAB 7: AGEN OTONOM WHATSAPP SECOPS & INTEGRASI AI")
    add_body(
        "Sistem dilengkapi bot agen keamanan cerdas berbasis Node.js yang berkomunikasi secara dua arah dengan tim administrator melalui aplikasi WhatsApp resmi menggunakan Baileys socket."
    )

    add_h2("7.1. Protokol Soket Baileys Multi-Device")
    add_bullet("Menghubungkan server langsung ke jaringan WhatsApp tanpa ketergantungan pada browser headless Chrome (menghemat RAM hingga 80%).", "Efisiensi Ringan: ");
    add_bullet("Kredensial sesi disimpan terenkripsi di folder session_auth/creds.json.", "Penyimpanan Kredensial: ");
    add_bullet("Mendukung auto-reconnect saat terjadi gangguan sinyal seluler atau internet.", "Ketahanan Sambungan: ");

    add_h2("7.2. Failover Watcher & Automatic Promotion")
    add_bullet("Node-01 (Windows) secara berkala memantau /api/cluster/ping pada Node-02 (VPS) setiap 30 detik.", "Detak Jantung (Heartbeat): ");
    add_bullet("Jika VPS tidak merespons selama 6 kali berturut-turut (total 35 detik tidak aktif), failover watcher otomatis mempromosikan Node-01 menjadi Master Koordinator.", "Deteksi Kematian Server: ");
    add_bullet("Node-01 segera menginisialisasi soket WhatsApp Baileys dan mengirimkan pesan siaga darurat ke nomor admin.", "Promosi Otomatis: ");

    add_h2("7.3. Perintah Eksekutif Administrator via WhatsApp")
    wa_headers = ["Perintah WhatsApp", "Sintaks Perintah", "Fungsi & Hasil Eksekusi"]
    wa_data = [
        ["Status Armada", "nodes / servers", "Menampilkan status hidup/mati seluruh armada server cluster."],
        ["Kesehatan Server", "all status / monitor", "Menampilkan penggunaan CPU, RAM, Disk, dan Uptime seluruh node."],
        ["Sinkronisasi VPS", "sync vps / sync all", "Memicu pemindaian dan sinkronisasi otomatis VHost, DB, dan Portal."],
        ["Status Backup DB", "sync db / sync", "Memeriksa status replikasi basis data ke Hyper-V lokal."],
        ["Trigger Sync DB", "sync now / trigger sync", "Memaksa eksekusi streaming database saat itu juga."],
        ["Status Google Drive", "backup / backup status", "Mengecek catatan log backup server ke Google Drive."],
        ["Trigger GDrive", "backup now / trigger backup", "Memulai proses backup kompresi server ke Google Drive."],
        ["Kunci Sesi", "lock / kunci", "Mengunci kembali sesi bot secara instan untuk keamanan Zero-Trust."]
    ]
    wa_tbl = doc.add_table(rows=len(wa_data)+1, cols=3)
    style_table(wa_tbl, [1.5, 1.8, 3.5], wa_headers, wa_data)

    # =========================================================================
    # BAB 8: SISTEM UJIAN ONLINE CBT / LMS (DOCKER OFFLINE-FIRST)
    # =========================================================================
    add_h1("BAB 8: SISTEM UJIAN ONLINE CBT / LMS (DOCKER OFFLINE-FIRST)")
    add_body(
        "Aplikasi Ujian Online Computer-Based Testing (CBT) dan Learning Management System (LMS) dirancang dengan konsep Offline-First PWA menggunakan arsitektur kontainer Docker di server lokal ini."
    )

    add_h2("8.1. Arsitektur Tumpukan Kontainer Docker")
    add_bullet("ujian_frontend (Port 80/443): Nginx web server yang menyajikan antarmuka PWA Vue/React teroptimasi, melayani aset statis dan service workers.", "Frontend Kontainer: ");
    add_bullet("ujian_backend (Port 9090): REST API backend berkecepatan tinggi berbasis Go/Node.js yang menangani autentikasi peserta, distribusi paket soal, dan pencatatan jawaban ujian.", "Backend Kontainer: ");
    add_bullet("ujian_postgres (Port 5432): Basis data PostgreSQL tangguh yang menyimpan bank soal, token ujian, riwayat ujian, dan kalkulasi nilai otomatis.", "Database Kontainer: ");

    add_h2("8.2. Keunggulan Teknologi Offline-First PWA")
    add_bullet("Setelah peserta memuat halaman ujian pertama kali, seluruh soal tersimpan di IndexedDB browser siswa.", "Bebas Kuota Internet: ");
    add_bullet("Ujian dapat terus berlangsung meskipun koneksi internet ke ISP tiba-tiba terputus.", "Ketahanan Jaringan: ");
    add_bullet("Jawaban siswa tersimpan di cache lokal dan otomatis di-sync ke server lokal saat jaringan tersambung kembali.", "Sinkronisasi Jawaban: ");
    add_bullet("Dapat diakses secara lokal di intranet sekolah lewat port 80 (http://localhost) maupun dari luar lewat internet di https://cbt.kedukanaksara.com.", "Fleksibilitas Akses: ");

    # =========================================================================
    # BAB 9: STANDAR PROSEDUR OPERASIONAL (SOP) & PANDUAN BENCANA
    # =========================================================================
    add_h1("BAB 9: STANDAR PROSEDUR OPERASIONAL (SOP) & PANDUAN BENCANA")

    add_h2("9.1. Prosedur Saat VPS Cloud Mengalami Gangguan / Mati Total (Failover)")
    add_body("Jika VPS Cloud Hostinger mati karena pemadaman listrik global, perbaikan data center, atau kegagalan OS:")
    add_bullet("Node-01 (Windows) akan mendeteksi putusnya sinyal detak jantung dalam 35 detik dan mengirim peringatan ke WhatsApp admin.", "Langkah 1 (Deteksi Otomatis): ");
    add_bullet("Buka dashboard Cloudflare DNS (dash.cloudflare.com) untuk domain *.portal-egn.com atau *.exprogionusantara.my.id.", "Langkah 2 (DNS Switch): ");
    add_bullet("Ubah A Record domain utama menjadi CNAME yang mengarah ke Argo Tunnel: 67775b37-cc35-49c5-9cf2-7135fabea95a.cfargotunnel.com dengan Proxy Status Aktif (Awan Oranye).", "Langkah 3 (Pengalihan Trafik): ");
    add_bullet("Seluruh trafik publik seketika mengalir ke server Hyper-V lokal tanpa downtime dan tanpa merusak URL asli.", "Langkah 4 (Verifikasi): ");

    add_h2("9.2. Prosedur Pemulihan Kembali Saat VPS Cloud Normal (Failback)")
    add_body("Setelah VPS Cloud kembali hidup dan siap operasional:")
    add_bullet("Jalankan sinkronisasi database dari Hyper-V kembali ke VPS jika terdapat transaksi kasir baru selama masa failover.", "Langkah 1 (Data Reconciliation): ");
    add_bullet("Ubah kembali CNAME di Cloudflare menjadi A Record yang mengarah ke IP publik VPS: 62.72.20.122.", "Langkah 2 (DNS Reversal): ");
    add_bullet("Verifikasi status cluster lewat WhatsApp dengan mengetik nodes atau all status.", "Langkah 3 (Pemeriksaan Sistem): ");

    # Save to targets
    target_path_hyperv = r"D:\Hyper-V\Dokumentasi-Teknologi-Sistem-HA-Cluster-SecOps.docx"
    target_path_artifact = r"C:\Users\agrap\.gemini\antigravity\brain\5bda19d0-fb3d-42da-87d6-10062f73a5b9\Dokumentasi-Teknologi-Sistem-HA-Cluster-SecOps.docx"

    doc.save(target_path_hyperv)
    print(f"[OK] Berhasil menyimpan dokumen di: {target_path_hyperv}")

    try:
        doc.save(target_path_artifact)
        print(f"[OK] Berhasil menyimpan salinan di: {target_path_artifact}")
    except Exception as e:
        print(f"[WARN] Gagal menyimpan salinan artifact: {e}")

if __name__ == "__main__":
    create_document()

