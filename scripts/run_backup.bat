@echo off
set PYTHON_EXE="C:\Users\agrap\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe"
set SCRIPT_PY="D:\AI-Server\security-agent\scripts\run_scheduled_backup.py"

if exist %PYTHON_EXE% (
    %PYTHON_EXE% %SCRIPT_PY%
) else (
    python %SCRIPT_PY%
)
exit /b %ERRORLEVEL%

