# Hidden daily backup launcher — no console window.
# Used by Task Scheduler (02:00) and startup catch-up.
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $repo "disaster-recovery\scripts\daily-backup.mjs"
$backupRoot = "D:\LegalMind_Backups"
$logDir = Join-Path $backupRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stamp = Get-Date -Format "yyyy-MM-dd"
$logFile = Join-Path $logDir "launcher-$stamp.log"

function Write-LaunchLog([string]$msg) {
  Add-Content -Path $logFile -Value ("[{0}] {1}" -f (Get-Date -Format "o"), $msg) -Encoding UTF8
}

$lock = Join-Path $logDir "daily-backup.lock"
if (Test-Path $lock) {
  $ageHours = ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalHours
  if ($ageHours -lt 3) {
    Write-LaunchLog "SKIP another backup appears running (lock age ${ageHours}h)"
    exit 0
  }
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
Set-Content -Path $lock -Value (Get-Date -Format "o") -Encoding UTF8

$outLog = Join-Path $logDir "daily-backup-stdout-$stamp.log"
$errLog = Join-Path $logDir "daily-backup-stderr-$stamp.log"
Write-LaunchLog "START daily-backup.mjs"

try {
  $p = Start-Process -FilePath $node `
    -ArgumentList "`"$script`"" `
    -WorkingDirectory $repo `
    -WindowStyle Hidden `
    -Wait `
    -PassThru `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog

  $code = $p.ExitCode
  Write-LaunchLog "FINISH exit=$code"
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
  exit $code
} catch {
  Write-LaunchLog "ERROR $($_.Exception.Message)"
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
  exit 1
}
