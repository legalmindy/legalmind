# Startup catch-up: if the 02:00 backup was missed (PC was off), run it once then exit.
$ErrorActionPreference = "Stop"

$backupRoot = "D:\LegalMind_Backups"
$logDir = Join-Path $backupRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$successFile = Join-Path $logDir "last-success.json"
$launcher = Join-Path $PSScriptRoot "run-daily-backup-hidden.ps1"
$stamp = Get-Date -Format "yyyy-MM-dd"
$logFile = Join-Path $logDir "startup-catchup-$stamp.log"

function Write-Log([string]$msg) {
  Add-Content -Path $logFile -Value ("[{0}] {1}" -f (Get-Date -Format "o"), $msg) -Encoding UTF8
}

$needBackup = $true
if (Test-Path $successFile) {
  try {
    $json = Get-Content $successFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $at = [datetime]::Parse($json.at, $null, [System.Globalization.DateTimeStyles]::RoundtripKind)
    $ageHours = ((Get-Date).ToUniversalTime() - $at.ToUniversalTime()).TotalHours
    if ($ageHours -lt 20) {
      $needBackup = $false
      Write-Log "SKIP recent successful backup ${ageHours:N1}h ago ($($json.at))"
    } else {
      Write-Log "CATCHUP last success was ${ageHours:N1}h ago — running backup"
    }
  } catch {
    Write-Log "WARN could not parse last-success.json — running backup"
  }
} else {
  Write-Log "CATCHUP no last-success.json — running backup"
}

if (-not $needBackup) { exit 0 }

& powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $launcher
exit $LASTEXITCODE
