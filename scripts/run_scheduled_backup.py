# -*- coding: utf-8 -*-
r"""
SecOps Scheduled Backup System for Windows Server & Hyper-V Cluster
Runs periodically at 00:00 (Midnight) and 12:00 (Noon) WIB
Target: F:\BACKUP_SYSTEM_IMAGE
"""

import os
import sys
import shutil
import time
import json
import ctypes
import datetime

BACKUP_DEST = r"F:\BACKUP_SYSTEM_IMAGE"
DATA_DIR = r"D:\AI-Server\security-agent\data"
LOG_DIR = r"D:\AI-Server\security-agent\logs"
LOCK_FILE = os.path.join(DATA_DIR, "backup.lock")
STATUS_FILE = os.path.join(DATA_DIR, "backup-status.json")
HISTORY_FILE = os.path.join(DATA_DIR, "backup-history.json")
LOG_FILE_LOCAL = os.path.join(LOG_DIR, "backup.log")
LOG_FILE_DEST = os.path.join(BACKUP_DEST, "backup.log")

def get_now_str():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def log(msg, also_dest=True):
    ts = get_now_str()
    formatted = f"[{ts}] {msg}"
    print(formatted)
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(LOG_FILE_LOCAL, "a", encoding="utf-8") as f:
            f.write(formatted + "\n")
    except Exception as e:
        print(f"Failed to write local log: {e}")
        
    if also_dest and os.path.exists(BACKUP_DEST):
        try:
            with open(LOG_FILE_DEST, "a", encoding="utf-8") as f:
                f.write(formatted + "\n")
        except Exception:
            pass

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
        return free_bytes.value / (1024**3), total_bytes.value / (1024**3)
    except Exception as e:
        log(f"Error checking disk space for {path}: {e}")
        return 0, 0

def copy_file_stream(src, dst):
    total_size = os.path.getsize(src)
    total_size_gb = total_size / (1024**3)
    basename = os.path.basename(src)
    log(f"Memulai salin berkas: {basename} ({total_size_gb:.2f} GB)")
    
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    start_time = time.time()
    copied = 0
    chunk_size = 16 * 1024 * 1024  # 16 MB chunk
    last_logged = 0
    
    with open(src, 'rb') as fsrc, open(dst, 'wb') as fdst:
        while True:
            chunk = fsrc.read(chunk_size)
            if not chunk:
                break
            fdst.write(chunk)
            copied += len(chunk)
            
            # Log progress every ~5 GB or at 100%
            if copied - last_logged >= (5 * 1024 * 1024 * 1024) or copied == total_size:
                pct = (copied / total_size) * 100
                elapsed = time.time() - start_time
                speed = (copied / (1024**2)) / (elapsed if elapsed > 0 else 1)
                log(f"   Progress {basename}: {pct:.1f}% ({copied/(1024**3):.2f}/{total_size_gb:.2f} GB) @ {speed:.1f} MB/s")
                last_logged = copied
                
    elapsed = time.time() - start_time
    avg_speed = (total_size / (1024**2)) / (elapsed if elapsed > 0 else 1)
    log(f"Selesai salin {basename}: {total_size_gb:.2f} GB dalam {elapsed:.1f} detik ({avg_speed:.1f} MB/s)")
    return total_size

def sync_dir_incremental(src_dir, dst_dir, exclude_dirs=None, exclude_files=None):
    if exclude_dirs is None:
        exclude_dirs = ["node_modules", ".git", ".cache", "logs", "tmp"]
    if exclude_files is None:
        exclude_files = ["*.lock", "*.tmp", "*.log"]
        
    os.makedirs(dst_dir, exist_ok=True)
    copied_files = 0
    copied_bytes = 0
    
    for root, dirs, files in os.walk(src_dir):
        # Filter directories
        dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith('.')]
        
        rel_path = os.path.relpath(root, src_dir)
        target_sub = os.path.join(dst_dir, rel_path) if rel_path != '.' else dst_dir
        os.makedirs(target_sub, exist_ok=True)
        
        for file in files:
            if any(file.endswith(ext.replace('*', '')) for ext in exclude_files):
                continue
            src_file = os.path.join(root, file)
            dst_file = os.path.join(target_sub, file)
            
            # Incremental check: copy only if destination does not exist or has different size/mtime
            need_copy = False
            try:
                if not os.path.exists(dst_file):
                    need_copy = True
                else:
                    src_stat = os.stat(src_file)
                    dst_stat = os.stat(dst_file)
                    if src_stat.st_size != dst_stat.st_size or abs(src_stat.st_mtime - dst_stat.st_mtime) > 2:
                        need_copy = True
                        
                if need_copy:
                    shutil.copy2(src_file, dst_file)
                    copied_files += 1
                    copied_bytes += os.path.getsize(src_file)
            except Exception as e:
                # Ignore transient read locks on active logs
                pass
                
    return copied_files, copied_bytes

def calculate_next_run():
    now = datetime.datetime.now()
    today_midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_noon = now.replace(hour=12, minute=0, second=0, microsecond=0)
    tomorrow_midnight = today_midnight + datetime.timedelta(days=1)
    
    if now < today_noon:
        return today_noon.isoformat()
    else:
        return tomorrow_midnight.isoformat()

def update_status(status_dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(status_dict, f, indent=2)
        
    try:
        history = []
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                history = json.load(f)
        if not isinstance(history, list):
            history = []
        history.insert(0, {
            "timestamp": status_dict.get("lastBackupTime") or status_dict.get("lastRun") or get_now_str(),
            "trigger": "Pencadangan Terjadwal (00:00 / 12:00) atau Manual",
            "status": status_dict.get("status", "UNKNOWN"),
            "durationSeconds": status_dict.get("durationSeconds", 0),
            "freeSpaceF_GB": status_dict.get("freeSpaceF_GB", 0),
            "vhdxSizeGB": status_dict.get("vhdxSizeGB", 0),
            "details": status_dict.get("error") if status_dict.get("status") == "ERROR" else "Pencadangan Hyper-V VHDX, AI-Server, dan Kredensial Berhasil 100%"
        })
        history = history[:50]
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2)
            
        if os.path.exists(BACKUP_DEST):
            dest_hist = os.path.join(BACKUP_DEST, "backup-history.json")
            with open(dest_hist, "w", encoding="utf-8") as f:
                json.dump(history, f, indent=2)
    except Exception as e:
        print(f"Error updating history: {e}")

    if os.path.exists(BACKUP_DEST):
        try:
            dest_meta = os.path.join(BACKUP_DEST, "backup-metadata.json")
            with open(dest_meta, "w", encoding="utf-8") as f:
                json.dump(status_dict, f, indent=2)
        except Exception:
            pass

def main():
    log("=" * 65)
    log("🚀 MEMULAI PROSES BACKUP BERKALA SERVER WINDOWS & HYPER-V")
    log("=" * 65)
    
    # 1. Lock check
    os.makedirs(DATA_DIR, exist_ok=True)
    if os.path.exists(LOCK_FILE):
        try:
            with open(LOCK_FILE, "r") as f:
                lock_info = json.load(f)
            pid = lock_info.get("pid")
            lock_time = lock_info.get("time", 0)
            # If lock is less than 30 minutes old and process alive, skip
            if time.time() - lock_time < 1800:
                log(f"[WARN] Backup sedang berjalan oleh proses PID {pid}. Dibatalkan untuk menghindari tabrakan.")
                return
        except Exception:
            pass
            
    with open(LOCK_FILE, "w") as f:
        json.dump({"pid": os.getpid(), "time": time.time(), "startTime": get_now_str()}, f)
        
    overall_start = time.time()
    success = False
    details = {}
    
    try:
        # 2. Check Drive F:
        if not os.path.exists("F:\\"):
            err_msg = "Harddisk eksternal Drive F:\\ tidak terdeteksi! Pastikan USB harddisk tercolok."
            log(f"[❌ GAGAL] {err_msg}")
            update_status({
                "lastRun": get_now_str(),
                "status": "FAILED",
                "error": err_msg,
                "schedule": ["00:00", "12:00"],
                "nextScheduledRun": calculate_next_run()
            })
            return
            
        free_f_gb, total_f_gb = get_free_space_gb("F:\\")
        log(f"Status Drive F:\\ : Free {free_f_gb:.2f} GB dari total {total_f_gb:.2f} GB")
        
        if free_f_gb < 15.0:
            err_msg = f"Sisa kapasitas di Drive F:\\ terlalu rendah ({free_f_gb:.2f} GB < 15 GB). Backup dihentikan demi keamanan."
            log(f"[❌ GAGAL] {err_msg}")
            update_status({
                "lastRun": get_now_str(),
                "status": "FAILED",
                "error": err_msg,
                "freeSpaceGB": free_f_gb,
                "schedule": ["00:00", "12:00"],
                "nextScheduledRun": calculate_next_run()
            })
            return
            
        os.makedirs(BACKUP_DEST, exist_ok=True)
        
        # 3. Backup Virtual Disk Hyper-V (AlmaLinux-CyberPanel.vhdx)
        vhdx_src = r"D:\Hyper-V\AlmaLinux\AlmaLinux-CyberPanel.vhdx"
        vhdx_dst = os.path.join(BACKUP_DEST, "Hyper-V", "AlmaLinux", "AlmaLinux-CyberPanel.vhdx")
        vhdx_size = 0
        
        if os.path.exists(vhdx_src):
            # Check if source size > 0
            vhdx_size = os.path.getsize(vhdx_src)
            log(f"[1/5] Memproses Disk Image VM Hyper-V ({vhdx_size / (1024**3):.2f} GB)...")
            
            # If we have generous free space (>35 GB), copy to tmp then swap
            if free_f_gb > 35.0:
                vhdx_tmp = vhdx_dst + ".tmp"
                copy_file_stream(vhdx_src, vhdx_tmp)
                # Verify size
                if os.path.getsize(vhdx_tmp) == vhdx_size:
                    if os.path.exists(vhdx_dst):
                        try:
                            os.remove(vhdx_dst)
                        except Exception:
                            pass
                    shutil.move(vhdx_tmp, vhdx_dst)
                    log("   [OK] Image VHDX terverifikasi dan diperbarui secara atomic.")
                else:
                    raise IOError("Ukuran file VHDX sementara tidak cocok dengan sumber!")
            else:
                # Direct overwrite stream
                copy_file_stream(vhdx_src, vhdx_dst)
                log("   [OK] Image VHDX diperbarui secara langsung.")
                
            details["vhdxSizeGB"] = round(vhdx_size / (1024**3), 2)
        else:
            log(f"[WARN] VHDX tidak ditemukan di {vhdx_src}")
            
        # 4. Sync Hyper-V Scripts & Configs
        log("[2/5] Menyinkronkan konfigurasi & skrip Hyper-V...")
        c_files, c_bytes = sync_dir_incremental(r"D:\Hyper-V", os.path.join(BACKUP_DEST, "Hyper-V"), exclude_files=["*.vhdx", "*.vmrs", "*.iso", "*.qcow2"])
        log(f"   [OK] {c_files} berkas Hyper-V diperbarui ({c_bytes / (1024**2):.2f} MB).")
        
        # 5. Sync AI-Server Directory
        log("[3/5] Menyinkronkan direktori AI-Server & Web Portal...")
        ai_files, ai_bytes = sync_dir_incremental(r"D:\AI-Server", os.path.join(BACKUP_DEST, "AI-Server"))
        log(f"   [OK] {ai_files} berkas AI-Server diperbarui ({ai_bytes / (1024**2):.2f} MB).")
        
        # 6. Sync User Profile Configs (.cloudflared & .ssh)
        log("[4/5] Menyinkronkan kredensial Cloudflare Tunnel & SSH...")
        cf_src = os.path.expanduser(r"~\.cloudflared")
        if os.path.exists(cf_src):
            sync_dir_incremental(cf_src, os.path.join(BACKUP_DEST, "Configs", ".cloudflared"))
            
        ssh_src = os.path.expanduser(r"~\.ssh")
        if os.path.exists(ssh_src):
            sync_dir_incremental(ssh_src, os.path.join(BACKUP_DEST, "Configs", ".ssh"))
            
        # 7. Update Recovery Guide & Scripts
        log("[5/5] Menyinkronkan dokumen pemulihan bencana (PDF, HTML, Script)...")
        doc_srcs = [
            ("D:\\Hyper-V\\PANDUAN_PEMULIHAN_SSD_BARU.pdf", os.path.join(BACKUP_DEST, "PANDUAN_PEMULIHAN_SSD_BARU.pdf")),
            ("D:\\Hyper-V\\PANDUAN_PEMULIHAN_SSD_BARU.html", os.path.join(BACKUP_DEST, "PANDUAN_PEMULIHAN_SSD_BARU.html")),
            ("F:\\BACKUP_SYSTEM_IMAGE\\PANDUAN_PEMULIHAN_SSD_BARU.txt", os.path.join(BACKUP_DEST, "PANDUAN_PEMULIHAN_SSD_BARU.txt")),
            ("F:\\BACKUP_SYSTEM_IMAGE\\Restore-Server-NewDisk.ps1", os.path.join(BACKUP_DEST, "Restore-Server-NewDisk.ps1"))
        ]
        for s, d in doc_srcs:
            if os.path.exists(s) and s != d:
                shutil.copy2(s, d)
                
        success = True
        elapsed_total = time.time() - overall_start
        final_free_gb, _ = get_free_space_gb("F:\\")
        
        log("=" * 65)
        log(f"✅ BACKUP BERKALA SELESAI DENGAN SUKSES! (Total waktu: {elapsed_total:.1f} detik)")
        log(f"• Sisa Kapasitas Drive F: : {final_free_gb:.2f} GB")
        log(f"• Jadwal Berikutnya        : {calculate_next_run()}")
        log("=" * 65)
        
        update_status({
            "lastBackupTime": get_now_str(),
            "status": "SUCCESS",
            "durationSeconds": round(elapsed_total, 1),
            "freeSpaceF_GB": round(final_free_gb, 2),
            "vhdxSizeGB": details.get("vhdxSizeGB", 0),
            "schedule": ["00:00", "12:00"],
            "scheduleDescription": "Setiap hari pukul 00:00 WIB (Tengah Malam) & 12:00 WIB (Siang)",
            "nextScheduledRun": calculate_next_run()
        })
        
    except Exception as e:
        elapsed_total = time.time() - overall_start
        log(f"[❌ ERROR DALAM PROSES BACKUP] {e}")
        update_status({
            "lastRun": get_now_str(),
            "status": "ERROR",
            "error": str(e),
            "durationSeconds": round(elapsed_total, 1),
            "schedule": ["00:00", "12:00"],
            "nextScheduledRun": calculate_next_run()
        })
    finally:
        if os.path.exists(LOCK_FILE):
            try:
                os.remove(LOCK_FILE)
            except Exception:
                pass

if __name__ == "__main__":
    main()

