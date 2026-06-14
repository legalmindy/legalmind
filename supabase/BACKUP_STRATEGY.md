# Backup Strategy — LegalMind Yemen

## Automated Backups (Supabase)

1. **Daily backups** — Enable in Supabase Dashboard → Settings → Database → Backups (Pro plan+).
2. **Point-in-time recovery** — Available on Pro plan; restore to any second within retention window.

## Manual Backup

```bash
# Export schema
supabase db dump --schema public > backup_schema.sql

# Export data
supabase db dump --data-only > backup_data.sql
```

## Storage Backups

- Enable Supabase Storage replication or periodic sync to external S3-compatible storage.
- Document files are in the `case-documents` bucket.

## Recovery Procedure

1. Restore database from Supabase backup or SQL dump.
2. Re-apply migrations from `supabase/migrations/`.
3. Verify RLS policies are active.
4. Verify storage bucket policies.
5. Run smoke tests against auth and CRUD endpoints.

## Retention Policy

| Type | Retention |
|------|-----------|
| Daily DB backups | 7 days (Free) / 30 days (Pro) |
| Audit logs | 1 year |
| Error logs | 90 days |
| Storage files | Indefinite (soft-delete via `deleted_at`) |
