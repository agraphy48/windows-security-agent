@echo off
title Windows Security Guard Agent
cd /d "%~dp0"

echo ================================================================
echo       MEMULAI WINDOWS SECURITY & HEALTH AGENT (WHATSAPP)
echo ================================================================
echo.

if not exist node_modules (
    echo [+] Modul belum terpasang. Menjalankan npm install...
    npm install
)

if not exist .env (
    if exist .env.example (
        echo [!] File .env belum ada. Menyalin dari .env.example...
        copy .env.example .env
    )
)

node src/index.js
pause
