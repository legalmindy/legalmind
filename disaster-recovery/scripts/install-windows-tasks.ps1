# Install LOW-RESOURCE LegalMind backup tasks (Windows Task Scheduler).
# - Removes continuous sync / dashboard / polling tasks
# - Registers daily 02:00 backup (hidden, StartWhenAvailable)
# - Registers AtStartup/AtLogOn catch-up if the PC was off at 02:00
#
#   powershell -ExecutionPolicy Bypass -File disaster-recovery\scripts\install-windows-tasks.ps1

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envFile = Join-Path $repo ".env.disaster-recovery"

function Unregister-LegalMindTask([string]$Name) {
  $existing = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if ($existing) {
    try {
      Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction Stop
      Write-Host "REMOVED  $Name"
    } catch {
      & schtasks.exe /Delete /TN $Name /F 2>$null | Out-Null
      if (-not (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue)) {
        Write-Host "REMOVED  $Name (schtasks)"
      } else {
        Write-Host "WARN could not remove $Name - $($_.Exception.Message)"
      }
    }
  }
}

function Register-HiddenPs1Task {
  param(
    [string]$Name,
    [string]$Ps1Rel,
    [object]$Trigger,
    [string]$Description
  )
  $scriptPath = Join-Path $repo $Ps1Rel
  $arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg -WorkingDirectory $repo
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4) `
    -MultipleInstances IgnoreNew `
    -Hidden
  try {
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Trigger -Settings $settings `
      -Description $Description -Force | Out-Null
    Write-Host "OK  $Name (machine/admin)"
    return $true
  } catch {
    try {
      Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Trigger -Settings $settings `
        -Description $Description -Force -User $env:USERNAME | Out-Null
      Write-Host "OK  $Name (current user)"
      return $true
    } catch {
      Write-Host "FAIL $Name - $($_.Exception.Message)"
      return $false
    }
  }
}

Write-Host "=== Removing legacy continuous / polling DR tasks ==="
@(
  "LegalMind-DR-Sync",
  "LegalMind-DR-NightlyBackup",
  "LegalMind-DR-StorageBackup",
  "LegalMind-DR-Dashboard"
) | ForEach-Object { Unregister-LegalMindTask $_ }

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'sync-service\.mjs' -and $_.CommandLine -notmatch '--once' } |
  ForEach-Object {
    Write-Host "STOPPING continuous sync PID=$($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Write-Host ""
Write-Host "=== Registering silent daily + startup catch-up tasks ==="
$results = @()

$dailyTrigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
$results += Register-HiddenPs1Task `
  -Name "LegalMind-DR-DailyBackup" `
  -Ps1Rel "disaster-recovery\scripts\run-daily-backup-hidden.ps1" `
  -Trigger $dailyTrigger `
  -Description "LegalMind Yemen daily backup at 02:00 (mirror + dump + zip + verify). Hidden. No idle process."

$startupOk = $false
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$startupOk = Register-HiddenPs1Task `
  -Name "LegalMind-DR-StartupCatchup" `
  -Ps1Rel "disaster-recovery\scripts\run-backup-on-startup.ps1" `
  -Trigger $startupTrigger `
  -Description "If the 02:00 backup was missed (PC off), run once at next startup then exit."

if (-not $startupOk) {
  Write-Host "AtStartup denied - registering AtLogOn catch-up instead"
  $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $startupOk = Register-HiddenPs1Task `
    -Name "LegalMind-DR-StartupCatchup" `
    -Ps1Rel "disaster-recovery\scripts\run-backup-on-startup.ps1" `
    -Trigger $logonTrigger `
    -Description "If the 02:00 backup was missed (PC off), run once at next user logon then exit."
}
$results += $startupOk

$passed = @($results | Where-Object { $_ -eq $true }).Count
Write-Host ""
Write-Host "Registered $passed / $($results.Count) tasks"
Get-ScheduledTask -TaskName "LegalMind-DR-*" -ErrorAction SilentlyContinue |
  Select-Object TaskName, State | Format-Table -AutoSize

Write-Host ""
Write-Host "Backups: D:\LegalMind_Backups\daily"
Write-Host "Logs:    D:\LegalMind_Backups\logs"
Write-Host "Env:     $envFile"
Write-Host "Manual:  npm run dr:backup"
Write-Host "Restore: npm run dr:restore:one-click"
if ($passed -lt $results.Count) { exit 1 }
