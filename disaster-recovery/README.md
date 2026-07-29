# Disaster Recovery — LegalMind Yemen

Supabase remains the **primary production** database.  
Local PostgreSQL `legalmind_backup` is the **permanent backup mirror**.

## Quick start

1. PostgreSQL 18 is already installed on this machine.
2. Configure secrets:

```powershell
copy disaster-recovery\.env.disaster-recovery.example .env.disaster-recovery
# Edit .env.disaster-recovery — set SUPABASE_SERVICE_ROLE_KEY
```

3. Bootstrap local DB + apply migrations:

```powershell
powershell -ExecutionPolicy Bypass -File disaster-recovery\scripts\setup-local.ps1
```

4. Start continuous sync:

```bash
npm run dr:sync
```

5. Nightly dump (or install scheduled tasks):

```bash
npm run dr:backup
powershell -ExecutionPolicy Bypass -File disaster-recovery\scripts\install-windows-tasks.ps1
```

6. Dashboard:

```bash
npm run dr:dashboard
start D:\LegalMind_Backups\dashboard.html
```

7. One-click restore into a **new** database / Supabase project:

```bash
npm run dr:restore -- --source D:\LegalMind_Backups\nightly\legalmind_backup_XXXX.dump
# or
npm run dr:restore -- --source ....dump --database-url "postgresql://postgres:...@db.<NEW_REF>.supabase.co:5432/postgres"
```

8. DR simulation (temp DB only):

```bash
npm run dr:test
```

9. Storage backup / restore check / settings export / orphan audit:

```bash
npm run dr:storage-backup
npm run dr:storage-restore -- --dry-run
npm run dr:export-settings
npm run dr:orphan-audit
```

Full cutover steps: [DISASTER_RECOVERY_CHECKLIST.md](./DISASTER_RECOVERY_CHECKLIST.md)  
Latest readiness verdict: [FINAL_REPORT.md](./FINAL_REPORT.md)

## Safety guarantees

- Never runs `DROP DATABASE` / `DROP SCHEMA` / `TRUNCATE` without explicit flags and protected-name checks.
- Nightly retention keeps 90 active ZIPs; older files are **moved** to `D:\LegalMind_Backups\archive` (never deleted).
- Sync failures retry via `dr.sync_outbox` with exponential backoff and durable logs in `D:\LegalMind_Backups\logs\sync.jsonl`.
- Sync inventory is taken from the **local** backup DB (avoids empty remote discovery / CLI races).
- Supabase CLI calls are serialized with a lock file under `D:\LegalMind_Backups\sync\`.
- Storage backup is read-only on production; orphans are reported, never auto-deleted.

See also: [MIGRATION_NOTES.md](./MIGRATION_NOTES.md) (explains the 051→053 numbering gap).

## Layout

```
disaster-recovery/
  DISASTER_RECOVERY_CHECKLIST.md
  FINAL_REPORT.md
  PROJECT_SETTINGS_EXPORT.md
  STORAGE_ORPHAN_AUDIT.md
  sql/000_local_bootstrap.sql
  scripts/
    setup-local.ps1
    apply-migrations.mjs
    sync-service.mjs
    nightly-backup.mjs
    storage-backup.mjs
    storage-restore.mjs
    export-project-settings.mjs
    orphan-storage-audit.mjs
    restore-to-new-project.mjs
    test-dr-restore.mjs
    dr-dashboard-status.mjs
    install-windows-tasks.ps1
D:\LegalMind_Backups\
  nightly/  logs/  sync/  archive/  storage/  dashboard.html
```
