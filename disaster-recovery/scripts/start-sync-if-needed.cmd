@echo off
REM Start LegalMind sync if not already running (idempotent, non-destructive)
setlocal
set "ROOT=%~dp0..\.."
for /f "tokens=2 delims=," %%P in ('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH') do (
  wmic process where "ProcessId=%%~P" get CommandLine 2>nul | findstr /I "sync-service.mjs" >nul
  if not errorlevel 1 (
    echo Sync already running PID=%%~P
    exit /b 0
  )
)
start "LegalMind-DR-Sync" /MIN node "%ROOT%\disaster-recovery\scripts\sync-service.mjs"
echo Sync started
exit /b 0
