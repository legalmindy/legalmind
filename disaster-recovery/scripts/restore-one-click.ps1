# One-click restore: load a local LegalMind backup into a NEW database / Supabase project.
# NEVER targets production. Never DROP DATABASE / DROP SCHEMA / TRUNCATE.
#
# Usage:
#   .\disaster-recovery\scripts\restore-one-click.ps1
#   .\disaster-recovery\scripts\restore-one-click.ps1 -DumpPath "D:\LegalMind_Backups\daily\....dump"
#   .\disaster-recovery\scripts\restore-one-click.ps1 -DatabaseUrl "postgresql://postgres:...@db.<NEW>.supabase.co:5432/postgres"

param(
  [string]$DumpPath = "",
  [string]$DatabaseUrl = "",
  [string]$TargetDb = "",
  [switch]$AllowExisting,
  [switch]$AllowDestructive
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo

$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $repo "disaster-recovery\scripts\restore-to-new-project.mjs"
$dailyDir = "D:\LegalMind_Backups\daily"
$nightlyDir = "D:\LegalMind_Backups\nightly"

# Known production project ref — refuse restore URLs that point here
$prodRef = "gnsjjsvugafxkwgmvcev"
if ($DatabaseUrl -and $DatabaseUrl -match $prodRef) {
  throw "Refusing restore into PRODUCTION Supabase project ($prodRef). Use a NEW project connection string."
}

if (-not $DumpPath) {
  $candidates = @()
  if (Test-Path $dailyDir) {
    $candidates += Get-ChildItem $dailyDir -Filter "*.dump" -ErrorAction SilentlyContinue
  }
  if (Test-Path $nightlyDir) {
    $candidates += Get-ChildItem $nightlyDir -Filter "*.dump" -ErrorAction SilentlyContinue
  }
  $latest = $candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) {
    throw "No .dump file found under $dailyDir or $nightlyDir. Run npm run dr:backup first."
  }
  $DumpPath = $latest.FullName
  Write-Host "Using latest dump: $DumpPath"
}

$argsList = @("--source", $DumpPath)
if ($DatabaseUrl) { $argsList += @("--database-url", $DatabaseUrl) }
if ($TargetDb) { $argsList += @("--target-db", $TargetDb) }
if ($AllowExisting) { $argsList += "--allow-existing" }
if ($AllowDestructive) { $argsList += "--allow-destructive" }

Write-Host "LegalMind Yemen — one-click restore (NEW project / local restore DB only)"
Write-Host "Repo: $repo"
Write-Host "Source: $DumpPath"
Write-Host "Production is never modified."
Write-Host ""

& $node $script @argsList
exit $LASTEXITCODE
