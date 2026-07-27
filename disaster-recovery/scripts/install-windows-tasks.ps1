# Register Windows Scheduled Tasks for sync + nightly backup (no data deletion).
# Run once in elevated PowerShell from repo root:
#   powershell -ExecutionPolicy Bypass -File disaster-recovery\scripts\install-windows-tasks.ps1

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$node = (Get-Command node).Source

$syncAction = New-ScheduledTaskAction -Execute $node -Argument "`"$repo\disaster-recovery\scripts\sync-service.mjs`"" -WorkingDirectory $repo
$syncTrigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName "LegalMind-DR-Sync" -Action $syncAction -Trigger $syncTrigger -RunLevel Highest -Force | Out-Null

$backupAction = New-ScheduledTaskAction -Execute $node -Argument "`"$repo\disaster-recovery\scripts\nightly-backup.mjs`"" -WorkingDirectory $repo
$backupTrigger = New-ScheduledTaskTrigger -Daily -At 2:15AM
Register-ScheduledTask -TaskName "LegalMind-DR-NightlyBackup" -Action $backupAction -Trigger $backupTrigger -RunLevel Highest -Force | Out-Null

$dashAction = New-ScheduledTaskAction -Execute $node -Argument "`"$repo\disaster-recovery\scripts\dr-dashboard-status.mjs`"" -WorkingDirectory $repo
$dashTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName "LegalMind-DR-Dashboard" -Action $dashAction -Trigger $dashTrigger -RunLevel Highest -Force | Out-Null

Write-Host "Scheduled tasks registered:"
Write-Host "  LegalMind-DR-Sync (at startup)"
Write-Host "  LegalMind-DR-NightlyBackup (02:15 daily)"
Write-Host "  LegalMind-DR-Dashboard (every 5 minutes)"
Write-Host "Open D:\LegalMind_Backups\dashboard.html after first dashboard run."
