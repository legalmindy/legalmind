# LegalMind Yemen — bootstrap local backup PostgreSQL + apply migrations
# Non-destructive: never DROP DATABASE / SCHEMA / TRUNCATE

param(
  [string]$PgHost = "127.0.0.1",
  [int]$Port = 5432,
  [string]$AdminUser = "postgres",
  [string]$AdminPassword = "",
  [string]$BackupUser = "legalmind_backup",
  [string]$BackupPassword = "LegalMind_Backup_Local_2026!",
  [string]$Database = "legalmind_backup",
  [string]$Psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Psql)) {
  throw "psql not found at $Psql — install PostgreSQL 17+ first."
}

if (-not $AdminPassword) {
  $secure = Read-Host "Enter local PostgreSQL password for user '$AdminUser'" -AsSecureString
  $AdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
}

$env:PGPASSWORD = $AdminPassword

Write-Host "==> Ensuring role $BackupUser"
& $Psql -h $PgHost -p $Port -U $AdminUser -d postgres -v ON_ERROR_STOP=1 -c @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$BackupUser') THEN
    CREATE ROLE $BackupUser LOGIN PASSWORD '$BackupPassword' SUPERUSER;
  ELSE
    ALTER ROLE $BackupUser WITH LOGIN PASSWORD '$BackupPassword' SUPERUSER;
  END IF;
END
`$`$;
"@

$exists = (& $Psql -h $PgHost -p $Port -U $AdminUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$Database'").Trim()
if ($exists -ne "1") {
  Write-Host "==> Creating database $Database"
  & $Psql -h $PgHost -p $Port -U $AdminUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $Database OWNER $BackupUser ENCODING 'UTF8' TEMPLATE template0;"
} else {
  Write-Host "==> Database $Database already exists (left untouched)"
}

New-Item -ItemType Directory -Force -Path "D:\LegalMind_Backups","D:\LegalMind_Backups\logs","D:\LegalMind_Backups\nightly","D:\LegalMind_Backups\sync","D:\LegalMind_Backups\archive" | Out-Null

$envFile = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) ".env.disaster-recovery"
# scripts live in disaster-recovery/scripts → repo root is ../..
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$envFile = Join-Path $repoRoot ".env.disaster-recovery"

if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $repoRoot ".env.disaster-recovery.example") $envFile -ErrorAction SilentlyContinue
}

Write-Host "==> Writing .env.disaster-recovery local PG settings"
@"
LOCAL_PG_HOST=$PgHost
LOCAL_PG_PORT=$Port
LOCAL_PG_DATABASE=$Database
LOCAL_PG_USER=$BackupUser
LOCAL_PG_PASSWORD=$BackupPassword
LOCAL_PSQL_PATH=$Psql
LOCAL_PG_DUMP_PATH=$($Psql -replace 'psql.exe','pg_dump.exe')
LOCAL_PG_RESTORE_PATH=$($Psql -replace 'psql.exe','pg_restore.exe')
BACKUP_ROOT=D:\LegalMind_Backups
BACKUP_KEEP_VERIFIED=90
SYNC_POLL_INTERVAL_MS=15000
"@ | Set-Content -Path $envFile -Encoding UTF8

Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
$env:PGPASSWORD = $BackupPassword

Write-Host "==> Applying bootstrap + migrations"
Push-Location $repoRoot
node .\disaster-recovery\scripts\apply-migrations.mjs
Pop-Location

Write-Host "Done. Next: set SUPABASE_SERVICE_ROLE_KEY in .env.disaster-recovery then run npm run dr:sync"
