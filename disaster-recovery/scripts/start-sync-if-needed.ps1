# Idempotent sync starter — never deletes data; starts sync-service only if not running.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$script = Join-Path $repo "disaster-recovery\scripts\sync-service.mjs"
$node = (Get-Command node).Source

$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'sync-service\.mjs' }

if ($running) {
  Write-Host "Sync already running PID=$($running.ProcessId -join ',')"
  exit 0
}

Start-Process -FilePath $node -ArgumentList "`"$script`"" -WorkingDirectory $repo -WindowStyle Minimized
Write-Host "Sync started"
exit 0
