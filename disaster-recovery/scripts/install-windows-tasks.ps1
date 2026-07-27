# Register Windows Scheduled Tasks for sync + nightly backup (no data deletion).
# Prefer elevated PowerShell, but falls back to current-user tasks.
#   powershell -ExecutionPolicy Bypass -File disaster-recovery\scripts\install-windows-tasks.ps1

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$node = (Get-Command node).Source
$envFile = Join-Path $repo ".env.disaster-recovery"

function Register-LegalMindTask {
  param(
    [string]$Name,
    [string]$ScriptRel,
    [object]$Trigger,
    [string]$Description
  )
  $scriptPath = Join-Path $repo $ScriptRel
  $arg = "`"$scriptPath`""
  $action = New-ScheduledTaskAction -Execute $node -Argument $arg -WorkingDirectory $repo
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  try {
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Trigger -Settings $settings -Description $Description -Force | Out-Null
    Write-Host "OK  $Name (machine/admin)"
    return $true
  } catch {
    try {
      Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Trigger -Settings $settings -Description $Description -Force -User $env:USERNAME | Out-Null
      Write-Host "OK  $Name (current user)"
      return $true
    } catch {
      Write-Host "FAIL $Name - $($_.Exception.Message)"
      return $false
    }
  }
}

$results = @()

# Continuous sync: watchdog every 5 minutes starts the service only if not already running
$syncWatch = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::FromDays(3650))
$syncScript = Join-Path $repo "disaster-recovery\scripts\start-sync-if-needed.ps1"
$syncAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$syncScript`"" -WorkingDirectory $repo
$syncSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
try {
  Register-ScheduledTask -TaskName "LegalMind-DR-Sync" -Action $syncAction -Trigger $syncWatch -Settings $syncSettings -Description "LegalMind sync watchdog" -Force | Out-Null
  Write-Host "OK  LegalMind-DR-Sync (machine/admin)"
  $results += $true
} catch {
  try {
    Register-ScheduledTask -TaskName "LegalMind-DR-Sync" -Action $syncAction -Trigger $syncWatch -Settings $syncSettings -Description "LegalMind sync watchdog" -Force -User $env:USERNAME | Out-Null
    Write-Host "OK  LegalMind-DR-Sync (current user)"
    $results += $true
  } catch {
    Write-Host "FAIL LegalMind-DR-Sync - $($_.Exception.Message)"
    $results += $false
  }
}

$results += Register-LegalMindTask -Name "LegalMind-DR-NightlyBackup" -ScriptRel "disaster-recovery\scripts\nightly-backup.mjs" `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 2:15AM) -Description "LegalMind nightly dump sql zip"

$dashTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::FromDays(3650))
$results += Register-LegalMindTask -Name "LegalMind-DR-Dashboard" -ScriptRel "disaster-recovery\scripts\dr-dashboard-status.mjs" `
  -Trigger $dashTrigger -Description "LegalMind DR dashboard refresh"

$passed = @($results | Where-Object { $_ -eq $true }).Count
Write-Host ""
Write-Host "Registered $passed / $($results.Count) tasks"
Get-ScheduledTask -TaskName "LegalMind-DR-*" -ErrorAction SilentlyContinue | Select-Object TaskName, State | Format-Table -AutoSize
Write-Host "Ensure $envFile contains SUPABASE and LOCAL_PG settings."
Write-Host "Open D:\LegalMind_Backups\dashboard.html after first dashboard run."
if ($passed -lt $results.Count) { exit 1 }
