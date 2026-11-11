#!/bin/bash
# ==============================================================================
# SCRIPT REPLIKASI & SINKRONISASI DATABASE CLUSTER
# Dari Master VPS (AlmaLinux) ke Local Hyper-V Worker (node-local / 100.110.122.22)
# ==============================================================================

LOG_FILE="/var/log/cluster-db-sync.log"
DATE_NOW="$(date '+%Y-%m-%d %H:%M:%S')"
REMOTE_HOST="node-local"

echo "====================================================" >> "${LOG_FILE}"
echo "[${DATE_NOW}] Memulai Sinkronisasi Database ke Local..." >> "${LOG_FILE}"
echo "====================================================" >> "${LOG_FILE}"

# 1. Cek Konektivitas SSH ke node-local via Tailscale
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "${REMOTE_HOST}" "hostname" >/dev/null 2>&1; then
  echo "[${DATE_NOW}] ❌ GAGAL: Tidak dapat terhubung ke ${REMOTE_HOST} via Tailscale SSH." | tee -a "${LOG_FILE}"
  exit 1
fi

echo "[${DATE_NOW}] ✅ Terhubung ke ${REMOTE_HOST}. Mulai streaming database..." | tee -a "${LOG_FILE}"

# 2. Daftar Database Produksi yang Disinkronkan
DATABASES=(
  "pent_test"
  "api_portal"
  "kedu_aksara"
  "keu_egn"
  "pos_saas"
  "port_portal"
  "toko_egn"
  "ukp_bimbel"
  "sman_10plg"
  "polr_palembang"
  "polr_restapalembang"
  "sriw_plg"
  "agus_cv"
  "yY5ROZF2yh6maY"
)

SUCCESS_COUNT=0
FAILED_COUNT=0

for db in "${DATABASES[@]}"; do
  # Cek apakah database ada di VPS
  if ! mysql -e "USE \`${db}\`;" >/dev/null 2>&1; then
    echo "[${DATE_NOW}] ⚠️ Database '${db}' tidak ditemukan di VPS. Lewati." | tee -a "${LOG_FILE}"
    continue
  fi

  echo -n "[${DATE_NOW}] 🔄 Sinkronisasi database '${db}'... " | tee -a "${LOG_FILE}"

  # Pastikan database ada di node-local
  ssh "${REMOTE_HOST}" "mariadb -e 'CREATE DATABASE IF NOT EXISTS \`${db}\`;'" >/dev/null 2>&1

  # Dump dari VPS, kompres gzip, pipe via SSH ke mariadb node-local
  if mysqldump --single-transaction --quick --routines --triggers "${db}" 2>/dev/null | gzip -c | ssh "${REMOTE_HOST}" "gunzip -c | mariadb '${db}'" 2>/dev/null; then
    echo "BERHASIL ✅" | tee -a "${LOG_FILE}"
    ((SUCCESS_COUNT++))
  else
    echo "GAGAL ❌" | tee -a "${LOG_FILE}"
    ((FAILED_COUNT++))
  fi
done

FINISH_TIME="$(date '+%Y-%m-%d %H:%M:%S')"
echo "====================================================" >> "${LOG_FILE}"
echo "[${FINISH_TIME}] Selesai: ${SUCCESS_COUNT} Berhasil, ${FAILED_COUNT} Gagal." | tee -a "${LOG_FILE}"
echo "====================================================" >> "${LOG_FILE}"

if [ "${FAILED_COUNT}" -eq 0 ]; then
  exit 0
else
  exit 2
fi
