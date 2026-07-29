# Migration numbering notes (non-destructive)

## Gap 051 → 053

There is **no** `052_*.sql` in `supabase/migrations`.

This is intentional historical numbering (migration `053_fix_office_owner_role.sql`
followed `051_aggressive_profile_repair.sql`). Ordering is still correct because
files sort numerically and by filename prefix.

Do **not** invent a backfilled `052` migration on production unless a real schema
change is required — empty placeholders can confuse `schema_migrations` history
on databases that already applied 053+.

Verification:

```text
001 … 051, 053 … 112   ✓ monotonic sort order
```
