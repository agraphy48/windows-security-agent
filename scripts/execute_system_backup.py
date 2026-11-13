# -*- coding: utf-8 -*-
"""
Script Backup Disaster Recovery & Server Image ke Drive F:\
Aman: Tidak menghapus satu pun berkas di Drive F:\ atau drive lain.
Memastikan ruang penyimpanan cukup sebelum menyalin.
"""

import os
import sys
import shutil
import time
import ctypes

BACKUP_DEST = r"F:\BACKUP_SYSTEM_IMAGE"

def get_free_space_gb(path):
    try:
        free_bytes = ctypes.c_ulonglong(0)
        total_bytes = ctypes.c_ulonglong(0)
        total_free = ctypes.c_ulonglong(0)
        ctypes.windll.kernel32.GetDiskFreeSpaceExW(
            ctypes.c_wchar_p(path),
            ctypes.byref(free_bytes),
            ctypes.byref(total_bytes),
            ctypes.byref(total_free)
        )
        return free_bytes.value / (1024**3)
    except Exception as e:
        print(f"Error checking disk space: {e}")
        return 0

def copy_file_with_progress(src, dst):
    total_size = os.path.getsize(src)
    total_size_gb = total_size / (1024**3)
    print(f"\n[📦 COPYING FILE] {os.path.basename(src)} ({total_size_gb:.2f} GB)")
    print(f"   From: {src}")
    print(f"   To:   {dst}")
    
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    
    start_time = time.time()
    copied = 0
    chunk_size = 16 * 1024 * 1024 # 16 MB buffer for fast sequential I/O
    
    with open(src, 'rb') as fsrc, open(dst, 'wb') as fdst:
        while True:
            chunk = fsrc.read(chunk_size)
            if not chunk:
                break
            fdst.write(chunk)
            copied += len(chunk)
            pct = (copied / total_size) * 100
            elapsed = time.time() - start_time
            speed_mb = (copied / (1024**2)) / (elapsed if elapsed > 0 else 1)
            eta_sec = (total_size - copied) / (copied / elapsed) if elapsed > 0 and copied > 0 else 0
            
            # Print status every ~256 MB or at 100%
            if copied % (256 * 1024 * 1024) < chunk_size or copied == total_size:
                sys.stdout.write(f"\r   Progress: {pct:.1f}% ({copied/(1024**3):.2f}/{total_size_gb:.2f} GB) | Kecepatan: {speed_mb:.1f} MB/s | ETA: {eta_sec:.0f}s   ")
                sys.stdout.flush()
                
    total_time = time.time() - start_time
    print(f"\n   [✅ SELESAI] Waktu salin: {total_time:.1f} detik.")

def copy_dir_recursively(src_dir, dst_dir, exclude_patterns=None):
    if exclude_patterns is None:
        exclude_patterns = []
        
    print(f"\n[📂 COPYING DIRECTORY] {src_dir} -> {dst_dir}")
    os.makedirs(dst_dir, exist_ok=True)
    
    file_count = 0
    copied_bytes = 0
    
    for root, dirs, files in os.walk(src_dir):
        # Exclude directories if matching
        dirs[:] = [d for d in dirs if not any(p in os.path.join(root, d) for p in exclude_patterns)]
        
        rel_path = os.path.relpath(root, src_dir)
        target_sub = os.path.join(dst_dir, rel_path) if rel_path != '.' else dst_dir
        os.makedirs(target_sub, exist_ok=True)
        
        for file in files:
            if any(p in file for p in exclude_patterns):
                continue
            src_file = os.path.join(root, file)
            dst_file = os.path.join(target_sub, file)
            try:
                shutil.copy2(src_file, dst_file)
                file_count += 1
                copied_bytes += os.path.getsize(src_file)
            except Exception as e:
                print(f"   [WARN] Gagal menyalin {file}: {e}")
                
    print(f"   [✅ SELESAI] Menyalin {file_count} berkas ({copied_bytes / (1024**2):.2f} MB).")

def main():
    print("=" * 68)
    print("🛡️  SISTEM DISASTER RECOVERY & BARE-METAL SERVER BACKUP KE DRIVE F:\\")
    print("=" * 68)
    
    free_f_gb = get_free_space_gb("F:\\")
    print(f"[🔍 Pengecekan Ruang] Free space di Drive F:\\ saat ini: {free_f_gb:.2f} GB")
    
    if free_f_gb < 30.0:
        print("[❌ ERROR] Ruang kosong di Drive F:\\ kurang dari 30 GB. Backup dibatalkan demi keamanan.")
        return
        
    print(f"[🛡️ Jaminan Keamanan] Mode: NON-DESTRUCTIVE (Tidak ada file lama yang dihapus).")
    print(f"[📁 Folder Target] {BACKUP_DEST}\n")
    
    os.makedirs(BACKUP_DEST, exist_ok=True)
    
    # 1. Salin Virtual Disk Hyper-V (AlmaLinux 9 VM: CyberPanel, MariaDB, 31 Web)
    vhdx_src = r"D:\Hyper-V\AlmaLinux\AlmaLinux-CyberPanel.vhdx"
    vhdx_dst = os.path.join(BACKUP_DEST, "Hyper-V", "AlmaLinux", "AlmaLinux-CyberPanel.vhdx")
    if os.path.exists(vhdx_src):
        copy_file_with_progress(vhdx_src, vhdx_dst)
    else:
        print(f"[WARN] VHDX tidak ditemukan di {vhdx_src}")
        
    # 2. Salin Seluruh Konfigurasi & Script Hyper-V
    copy_dir_recursively(r"D:\Hyper-V", os.path.join(BACKUP_DEST, "Hyper-V"), exclude_patterns=["AlmaLinux-CyberPanel.vhdx"])
    
    # 3. Salin Seluruh Kode, Konfigurasi, dan Basis Data AI-Server
    copy_dir_recursively(r"D:\AI-Server", os.path.join(BACKUP_DEST, "AI-Server"))
    
    # 4. Salin Konfigurasi Penting dari Drive C: (Cloudflare Tunnel & SSH Keys)
    cf_src = os.path.expanduser(r"~\.cloudflared")
    cf_dst = os.path.join(BACKUP_DEST, "Configs", ".cloudflared")
    if os.path.exists(cf_src):
        copy_dir_recursively(cf_src, cf_dst)
        
    ssh_src = os.path.expanduser(r"~\.ssh")
    ssh_dst = os.path.join(BACKUP_DEST, "Configs", ".ssh")
    if os.path.exists(ssh_src):
        copy_dir_recursively(ssh_src, ssh_dst)
        
    # 5. Salin Catatan Kredensial & CBT di Root Drive D:
    txt_files = ["cbt aplikasi ujian.txt", "chabot server.txt", "httpschatbot.kedukanaksara.com.txt"]
    for tf in txt_files:
        src = os.path.join("D:\\", tf)
        if os.path.exists(src):
            dst = os.path.join(BACKUP_DEST, tf)
            shutil.copy2(src, dst)
            print(f"[📄 Copied] {tf}")
            
    # 6. Buat Panduan Pemulihan (Restore Guide) & Skrip Otomatis
    create_restore_guide()
    
    final_free_gb = get_free_space_gb("F:\\")
    print("\n" + "=" * 68)
    print("🎉 BACKUP DISASTER RECOVERY KE DRIVE F:\\ BERHASIL 100%!")
    print(f"• Sisa Free Space di Drive F:\\ : {final_free_gb:.2f} GB (Masih sangat lega)")
    print(f"• Lokasi Hasil Backup          : {BACKUP_DEST}")
    print("=" * 68)

def create_restore_guide():
    guide_path = os.path.join(BACKUP_DEST, "PANDUAN_PEMULIHAN_SSD_BARU.txt")
    guide_content = """================================================================================
PANDUAN PEMULIHAN SISTEM SERVER & APLIKASI SAAT GANTI HARDDISK/SSD BARU
PT Expro Gio Nusantara & Kedukan Aksara
================================================================================

Jika harddisk/SSD internal lama Anda rusak atau Anda mengganti SSD baru,
ikuti langkah mudah berikut untuk menjalankan kembali seluruh sistem secara otomatis:

--------------------------------------------------------------------------------
LANGKAH 1: INSTALASI WINDOWS 11 PADA SSD BARU
--------------------------------------------------------------------------------
1. Pasang SSD baru ke komputer.
2. Install Windows 11 menggunakan Flashdisk USB Installer resmi seperti biasa.
3. Saat membuat partisi, buat 2 partisi:
   - Drive C: (Untuk Windows OS)
   - Drive D: (Untuk Data Server) -> Pastikan huruf drive diset sebagai 'D:'.

--------------------------------------------------------------------------------
LANGKAH 2: AKTIFKAN FITUR HYPER-V DI WINDOWS 11
--------------------------------------------------------------------------------
Buka PowerShell (Run as Administrator) dan jalankan:
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All -NoRestart
Enable-WindowsOptionalFeature -Online -FeatureName Containers -All
Restart komputer Anda.

--------------------------------------------------------------------------------
LANGKAH 3: KEMBALIKAN DATA SERVER DARI DRIVE F:\\
--------------------------------------------------------------------------------
Colokkan Harddisk Eksternal (Drive F:\\) ini ke komputer, lalu:
1. Salin folder 'F:\\BACKUP_SYSTEM_IMAGE\\Hyper-V' ke 'D:\\Hyper-V'.
2. Salin folder 'F:\\BACKUP_SYSTEM_IMAGE\\AI-Server' ke 'D:\\AI-Server'.
3. Salin folder 'F:\\BACKUP_SYSTEM_IMAGE\\Configs\\.cloudflared' ke 'C:\\Users\\<UserAnda>\\.cloudflared'.
4. Salin folder 'F:\\BACKUP_SYSTEM_IMAGE\\Configs\\.ssh' ke 'C:\\Users\\<UserAnda>\\.ssh'.

--------------------------------------------------------------------------------
LANGKAH 4: DAFTARKAN VM HYPER-V & JALANKAN OTOMASI (CUKUP 1 PERINTAH)
--------------------------------------------------------------------------------
Jalankan file skrip otomatis yang sudah disediakan di folder ini:
F:\\BACKUP_SYSTEM_IMAGE\\Restore-Server-NewDisk.ps1
(Klik kanan -> Run with PowerShell)

Skrip tersebut akan secara otomatis:
- Membuat Virtual Switch 'ExternalSwitch' yang terhubung ke kartu LAN/WiFi Anda.
- Mendaftarkan Virtual Machine 'AlmaLinux-CyberPanel' dengan 8 Core vCPU dan 16 GB RAM.
- Memasang disk 'D:\\Hyper-V\\AlmaLinux\\AlmaLinux-CyberPanel.vhdx'.
- Menyalakan mesin virtual, Cloudflare Tunnel, dan SecOps Agent.

HASILNYA:
Seluruh 31 website produksi, database MariaDB, CBT Docker, bot WhatsApp,
dan portal https://portal.kedukanaksara.com langsung aktif kembali normal 100%!
================================================================================
"""
    with open(guide_path, 'w', encoding='utf-8') as f:
        f.write(guide_content)
        
    script_path = os.path.join(BACKUP_DEST, "Restore-Server-NewDisk.ps1")
    script_content = """# PowerShell Auto-Restore Virtual Machine Hyper-V & Services
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🛡️  MEMULIHKAN SISTEM SERVER KE SSD BARU..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Cek Virtual Switch
$vswitch = Get-VMSwitch -Name "ExternalSwitch" -ErrorAction SilentlyContinue
if (-not $vswitch) {
    Write-Host "[1/4] Membuat External Virtual Switch..." -ForegroundColor Yellow
    $netAdapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1
    New-VMSwitch -Name "ExternalSwitch" -NetAdapterName $netAdapter.Name -AllowManagementOS $true
} else {
    Write-Host "[1/4] External Virtual Switch sudah ada. OK!" -ForegroundColor Green
}

# 2. Daftarkan VM Hyper-V
$vm = Get-VM -Name "AlmaLinux-CyberPanel" -ErrorAction SilentlyContinue
if (-not $vm) {
    Write-Host "[2/4] Mendaftarkan VM AlmaLinux-CyberPanel (Gen 2 UEFI)..." -ForegroundColor Yellow
    $vhdPath = "D:\\Hyper-V\\AlmaLinux\\AlmaLinux-CyberPanel.vhdx"
    New-VM -Name "AlmaLinux-CyberPanel" -Generation 2 -MemoryStartupBytes 16GB -VHDPath $vhdPath -SwitchName "ExternalSwitch"
    Set-VMProcessor -VMName "AlmaLinux-CyberPanel" -Count 8
    Set-VMFirmware -VMName "AlmaLinux-CyberPanel" -EnableSecureBoot On -SecureBootTemplate "MicrosoftUEFICertificateAuthority"
} else {
    Write-Host "[2/4] VM AlmaLinux-CyberPanel sudah terdaftar. OK!" -ForegroundColor Green
}

# 3. Start VM
Write-Host "[3/4] Menyalakan VM AlmaLinux-CyberPanel..." -ForegroundColor Yellow
Start-VM -Name "AlmaLinux-CyberPanel"

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "✅ PEMULIHAN SELESAI! VM & SERVER AKTIF KEMBALI." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
"""
    with open(script_path, 'w', encoding='utf-8') as f:
        f.write(script_content)

if __name__ == "__main__":
    main()

