# Disaster Recovery — LegalMind Yemen

Supabase remains the **primary production** database.  
Local PostgreSQL `legalmind_backup` is the **offline mirror** refreshed once per day.

## Design (low resource)

- **No** continuous sync service  
- **No** persistent `node.exe` / polling every minute  
- **One** automatic backup at **02:00** via Windows Task Scheduler (hidden window)  
- If the PC is off at 02:00, a **startup catch-up** runs the backup once, then exits  
- Idle CPU/RAM ≈ **zero** (nothing running between backups)

## Quick start

1. Configure secrets:

```powershell
copy disaster-recovery\.env.disaster-recovery.example .env.disaster-recovery
# Edit .env.disaster-recovery — set SUPABASE_SERVICE_ROLE_KEY
```

2. Bootstrap local DB (once):

```powershell
powershell -ExecutionPolicy Bypass -File disaster-recovery\scripts\setup-local.ps1
```

3. Install scheduled tasks (daily 02:00 + startup catch-up):

```powershell
npm run dr:install-tasks
```

4. Manual backup now:

```bash
npm run dr:backup
```

Artifacts land in `D:\LegalMind_Backups\daily\` (`.dump`, `.sql`, `.zip`, integrity JSON).  
Logs: `D:\LegalMind_Backups\logs\`

5. One-click restore into a **new** database / Supabase project:

```powershell
npm run dr:restore:one-click
# or with an explicit NEW project URL:
powershell -ExecutionPolicy Bypass -File disaster-recovery\scripts\restore-one-click.ps1 `
  -DumpPath "D:\LegalMind_Backups\daily\....dump" `
  -DatabaseUrl "postgresql://postgres:...@db.<NEW_REF>.supabase.co:5432/postgres"
```

Production project ref is refused. Never DROP DATABASE / SCHEMA / TABLE / TRUNCATE without your explicit approval flags.

6. DR simulation (temp local DB only):

```bash
npm run dr:test
```

## Safety guarantees

- Production Supabase is **read-only** for mirror refresh (upserts into local only).
- Retention keeps the latest **90** verified ZIP sets under `daily/`.
- Every backup is verified (`pg_restore -l`, SQL size/content, local `select 1`, table count).
- Scheduled tasks use **Hidden** window style — no Command Prompt / node windows.

See: [BACKUP_SYSTEM_REPORT.md](./BACKUP_SYSTEM_REPORT.md) · [DISASTER_RECOVERY_CHECKLIST.md](./DISASTER_RECOVERY_CHECKLIST.md)

## Layout

```
disaster-recovery/
  BACKUP_SYSTEM_REPORT.md
  DISASTER_RECOVERY_CHECKLIST.md
  scripts/
    daily-backup.mjs              # one-shot mirror + dump + zip + verify
    run-daily-backup-hidden.ps1   # Task Scheduler launcher (no window)
    run-backup-on-startup.ps1     # catch-up if 02:00 was missed
    install-windows-tasks.ps1     # register/remove tasks
    sync-service.mjs              # --once only (default)
    restore-one-click.ps1
    restore-to-new-project.mjs
    ...
```
