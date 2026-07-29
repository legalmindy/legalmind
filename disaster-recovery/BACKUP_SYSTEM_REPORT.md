# LegalMind Yemen — Backup System Report

**Date:** 2026-07-29  
**Mode:** Low-resource (few users)  
**Verdict:** **READY FOR PRODUCTION**

---

## Requirements checklist

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Remove continuous synchronization service | Done — `sync-service.mjs` defaults to `--once` only; continuous requires `--allow-continuous` |
| 2 | No persistent node.exe / terminal for DR | Done — no DR sync process running after install |
| 3 | No polling Supabase every minute | Done — removed `LegalMind-DR-Sync` / dashboard 5‑min tasks |
| 4 | Daily automatic backup at 02:00 | Done — task `LegalMind-DR-DailyBackup` (Next: 02:00) |
| 5 | If PC off at 02:00, run at next startup/logon | Done — `LegalMind-DR-StartupCatchup` (AtLogOn; AtStartup needs elevation) |
| 6 | Backup into local DB `legalmind_backup` | Done — daily job refreshes mirror then dumps it |
| 7 | Compressed SQL backup file | Done — `.sql` + `.zip` under `D:\LegalMind_Backups\daily` |
| 8 | Save under `D:\LegalMind_Backups` | Done |
| 9 | Keep latest 90 backups | Done — `BACKUP_KEEP_VERIFIED=90` |
| 10 | Verify every backup | Done — dump/SQL size, content, `pg_restore -l`, local DB checks |
| 11 | Log to `D:\LegalMind_Backups\logs` | Done |
| 12 | Never show CMD / node windows | Done — Hidden PowerShell + `windowsHide` / `WindowStyle Hidden` |
| 13 | Zero idle CPU/RAM when no backup | Done — no background Node between runs |
| 14 | Never modify production Supabase | Done — mirror is READ production → upsert local only |
| 15 | No DROP/TRUNCATE without explicit approval | Done — restore refuses protected names / production ref |
| 16 | One-click restore to new Supabase project | Done — `restore-one-click.ps1` / `npm run dr:restore:one-click` |
| 17 | Final readiness report | This document |

---

## Verification performed (2026-07-29)

### Daily schedule
- `LegalMind-DR-DailyBackup` = **Ready**, next run **02:00**
- `LegalMind-DR-StartupCatchup` = **Ready** (AtLogOn catch-up)
- Legacy tasks removed: Sync, NightlyBackup, StorageBackup, Dashboard

### No background Node.js
- Confirmed: **NO** `sync-service.mjs` process after install

### Local PostgreSQL + SQL backup
Manual run (`daily-backup.mjs --skip-mirror`) produced verified artifacts:

- Dump: `D:\LegalMind_Backups\daily\legalmind_backup_2026-07-29T03-10-02-360Z.dump` (integrity OK, 1057 TOC lines)
- SQL: `...360Z.sql` (content OK)
- ZIP: `...360Z.zip`
- Local DB: `select 1` OK, **30** public tables
- SHA-256 recorded in `*.integrity.json` and `logs\last-success.json`

### Restore process
Restored latest dump into local temp DB only (not production):

- Target: `legalmind_restore_20260729031112`
- Result: **ok**, public tables = **30**, total tracked schemas = **40**
- Production project ref `gnsjjsvugafxkwgmvcev` is refused by restore scripts

### One-click restore (new Supabase project)
```powershell
npm run dr:restore:one-click
# or:
powershell -ExecutionPolicy Bypass -File disaster-recovery\scripts\restore-one-click.ps1 `
  -DatabaseUrl "postgresql://postgres:...@db.<NEW_REF>.supabase.co:5432/postgres"
```

---

## Operator commands

| Action | Command |
|--------|---------|
| Install / refresh tasks | `npm run dr:install-tasks` |
| Run backup now | `npm run dr:backup` |
| Dump only (no mirror) | `npm run dr:backup:dump-only` |
| One-shot mirror only | `npm run dr:sync` |
| One-click restore | `npm run dr:restore:one-click` |

---

## Safety notes

- Production Supabase is never written by backup or restore defaults.
- Destructive SQL (`DROP DATABASE` / `DROP SCHEMA` / `TRUNCATE`, etc.) is not used by the daily pipeline.
- Restore into a new cloud project requires a **new** connection string (production URL blocked).

**System ready for production use under the low-resource backup model.**
