#!/usr/bin/env bash
# ================================================================
# Linux Security Guard Agent Launcher
# ================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

echo "================================================================"
echo "      MEMULAI LINUX / WINDOWS SECURITY AGENT (WHATSAPP)"
echo "================================================================"
echo ""

if [ ! -d "node_modules" ]; then
    echo "[+] Modul belum terpasang. Menjalankan npm install..."
    npm install
fi

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "[!] File .env belum ada. Menyalin dari .env.example..."
        cp .env.example .env
    fi
fi

node src/index.js
