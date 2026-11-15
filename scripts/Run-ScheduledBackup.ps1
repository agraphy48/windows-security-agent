# PowerShell Scheduled Backup Execution Wrapper
$pythonPath = "C:\Users\agrap\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe"
if (-not (Test-Path $pythonPath)) {
    $pythonPath = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
}

$scriptPath = "D:\AI-Server\security-agent\scripts\run_scheduled_backup.py"

& $pythonPath $scriptPath
exit $LASTEXITCODE

