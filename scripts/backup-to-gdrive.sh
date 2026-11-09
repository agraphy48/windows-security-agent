#!/usr/bin/env bash
set -e

BACKUP_DIR="/backup"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
STAGING_DIR="${BACKUP_DIR}/staging"
ARCHIVE_NAME="vps-backup-${TIMESTAMP}.tar.gz"
LATEST_NAME="vps-latest.tar.gz"

echo "===================================================="
echo "    [$(date)] MEMULAI BACKUP FULL SERVER KE GDRIVE"
echo "===================================================="

# 1. Siapkan direktori
mkdir -p "${STAGING_DIR}/db" "${STAGING_DIR}/system" "${STAGING_DIR}/configs"

# 2. Dump MariaDB
echo ">>> [1/6] Dumping Database MariaDB..."
mysqldump --all-databases --single-transaction --quick > "${STAGING_DIR}/db/mariadb_all.sql"

# 3. Dump PostgreSQL containers
echo ">>> [2/6] Dumping PostgreSQL containers..."
if podman ps -q -f name=ujian-edukasi-postgres 2>/dev/null | grep -q .; then
    podman exec -i ujian-edukasi-postgres pg_dumpall -U ujianadmin > "${STAGING_DIR}/db/postgres_ujian_edukasi.sql"
fi
if podman ps -q -f name=chatbot-postgres 2>/dev/null | grep -q .; then
    podman exec -i chatbot-postgres pg_dumpall -U wa > "${STAGING_DIR}/db/postgres_chatbot.sql"
fi

# 4. Dump PM2
echo ">>> [3/6] Dumping Konfigurasi PM2..."
pm2 save 2>/dev/null || true
if [ -f /root/.pm2/dump.pm2 ]; then
    cp /root/.pm2/dump.pm2 "${STAGING_DIR}/configs/root_pm2.json"
fi
if id "openwa" &>/dev/null; then
    su - openwa -c "pm2 save" 2>/dev/null || true
    if [ -f /home/openwa/.pm2/dump.pm2 ]; then
        cp /home/openwa/.pm2/dump.pm2 "${STAGING_DIR}/configs/openwa_pm2.json"
    fi
fi

# 5. Backup System & CyberPanel Configurations
echo ">>> [4/6] Backing up system accounts, services, and configurations..."
crontab -l > "${STAGING_DIR}/system/crontab_root.txt" 2>/dev/null || true
cp /etc/passwd "${STAGING_DIR}/system/passwd" 2>/dev/null || true
cp /etc/group "${STAGING_DIR}/system/group" 2>/dev/null || true
cp /etc/shadow "${STAGING_DIR}/system/shadow" 2>/dev/null || true
cp /etc/gshadow "${STAGING_DIR}/system/gshadow" 2>/dev/null || true
cp -r /etc/systemd/system/*.service "${STAGING_DIR}/system/" 2>/dev/null || true
cp -r /usr/local/lsws/conf "${STAGING_DIR}/configs/lsws_conf" 2>/dev/null || true
cp -r /etc/cyberpanel "${STAGING_DIR}/configs/cyberpanel_conf" 2>/dev/null || true
cp -r /root/.config/rclone "${STAGING_DIR}/configs/rclone_conf" 2>/dev/null || true

# 6. Mengompresi file (Toleransi file berubah saat dibaca)
echo ">>> [5/6] Mengompresi seluruh file ke ${ARCHIVE_NAME}..."
set +e
tar --use-compress-program=pigz -cf "${BACKUP_DIR}/${ARCHIVE_NAME}" \
    -C / home \
    -C / opt/ujian-edukasi \
    -C / opt/ujian-edukasi-secrets \
    -C "${STAGING_DIR}" . 2>&1
TAR_EXIT=$?
set -e
if [ $TAR_EXIT -ne 0 ] && [ $TAR_EXIT -ne 1 ]; then
    echo "ERROR: tar gagal dengan exit code $TAR_EXIT"
    exit $TAR_EXIT
fi

# 7. Upload ke Google Drive
echo ">>> [6/6] Mengupload arsip backup ke Google Drive..."
rclone copy "${BACKUP_DIR}/${ARCHIVE_NAME}" gdrive:VPS_MIGRATION_BACKUP/archives/ --stats=15s
rclone copyto "gdrive:VPS_MIGRATION_BACKUP/archives/${ARCHIVE_NAME}" "gdrive:VPS_MIGRATION_BACKUP/latest/${LATEST_NAME}"

# 8. Membersihkan file staging & simpan 1 arsip lokal terakhir
rm -rf "${STAGING_DIR}"
ls -t "${BACKUP_DIR}"/vps-backup-*.tar.gz 2>/dev/null | tail -n +2 | xargs -r rm -f

echo "===================================================="
echo " [$(date)] BACKUP SELESAI DAN SUKSES TERSINKRON KE GDRIVE!"
echo "===================================================="

