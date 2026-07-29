# تقرير إعدادات المشروع غير القابلة للاستعادة التلقائية
**التاريخ:** 2026-07-27T03:36:52.037Z
**الإنتاج:** https://gnsjjsvugafxkwgmvcev.supabase.co
**المصدر:** قراءة محلية + مرآة PostgreSQL فقط (بدون أسرار / بدون تعديل إنتاج)

## 1) متغيرات البيئة المطلوبة (أسماء فقط)

### App (Vite / client)
| المتغير | مطلوب | سرّي | المصدر |
|---------|-------|------|--------|
| `VITE_SUPABASE_URL` | نعم | لا | Dashboard → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | نعم | نعم | Dashboard → Project Settings → API (anon public) |
| `VITE_APP_URL` | لا | لا | Public app URL used for Auth redirects |
| `VITE_AUTH_SHARED_SESSION` | لا | لا | Optional; true = share login across tabs |
| `VITE_APP_VERSION` | لا | لا | Injected by vite.config from package.json |
| `VITE_APP_VERSION_CODE` | لا | لا | Injected by vite.config |
| `VITE_STRIPE_PUBLISHABLE_KEY` | لا | نعم | Stripe dashboard (future payments) |

### Disaster Recovery / sync
| المتغير | مطلوب | سرّي | المصدر |
|---------|-------|------|--------|
| `SUPABASE_URL` | نعم | لا | Same as project URL |
| `SUPABASE_ANON_KEY` | لا | نعم | Dashboard → API |
| `SUPABASE_SERVICE_ROLE_KEY` | نعم | نعم | Dashboard → API (service_role — NEVER in client) |
| `SUPABASE_DB_PASSWORD` | لا | نعم | Dashboard → Database settings (for CLI migrations) |
| `LOCAL_PG_HOST` | نعم | لا | .env.disaster-recovery |
| `LOCAL_PG_PORT` | نعم | لا | .env.disaster-recovery |
| `LOCAL_PG_DATABASE` | نعم | لا | .env.disaster-recovery |
| `LOCAL_PG_USER` | نعم | لا | .env.disaster-recovery |
| `LOCAL_PG_PASSWORD` | نعم | نعم | Local only |
| `LOCAL_PSQL_PATH` | لا | لا | PostgreSQL bin |
| `LOCAL_PG_DUMP_PATH` | لا | لا | PostgreSQL bin |
| `LOCAL_PG_RESTORE_PATH` | لا | لا | PostgreSQL bin |
| `BACKUP_ROOT` | لا | لا | Default D:\LegalMind_Backups |
| `BACKUP_KEEP_VERIFIED` | لا | لا | Retention count (archive, never delete) |
| `SYNC_POLL_INTERVAL_MS` | لا | لا | Sync poll interval |
| `SYNC_BATCH_SIZE` | لا | لا | Sync batch size |
| `SYNC_MAX_RETRIES` | لا | لا | Sync retry limit |
| `DR_REQUIRE_SERVICE_ROLE` | لا | لا | Warn if service role missing |

### Edge Functions (Deno secrets)
| المتغير | مطلوب | سرّي | المصدر |
|---------|-------|------|--------|
| `SUPABASE_URL` | نعم | لا | Auto-injected in hosted functions |
| `SUPABASE_ANON_KEY` | نعم | نعم | Function secrets |
| `SUPABASE_SERVICE_ROLE_KEY` | نعم | نعم | Function secrets |
| `SITE_URL` | لا | لا | invite-user redirect base (set in Function secrets) |

### Supabase project secrets (dashboard only — cannot auto-restore)
| المتغير | مطلوب | سرّي | المصدر |
|---------|-------|------|--------|
| `JWT_SECRET` | نعم | نعم | Project Settings → API → JWT Secret (project-specific) |
| `POSTGRES_PASSWORD` | نعم | نعم | Database password for new project |
| `SMTP_*` | نعم | نعم | Authentication → Emails → SMTP Settings |
| `OAUTH_CLIENT_ID/SECRET_*` | لا | نعم | Authentication → Providers (if enabled) |

### حالة الملفات المحلية (قيم سرّية مُحجوبة)
- **.env.local**: VITE_SUPABASE_URL=https://gnsjjsvugafxkwgmvcev.supabase.co, VITE_SUPABASE_ANON_KEY=[REDACTED], VITE_STRIPE_PUBLISHABLE_KEY=[REDACTED], VITE_SUPABASE_REDIRECT_URL=http://192.168.1.14:5173, VERCEL_OIDC_TOKEN=[REDACTED]
- **.env.disaster-recovery**: SUPABASE_URL=https://gnsjjsvugafxkwgmvcev.supabase.co, SUPABASE_SERVICE_ROLE_KEY=[REDACTED], SUPABASE_ANON_KEY=[REDACTED], LOCAL_PG_HOST=127.0.0.1, LOCAL_PG_PORT=5432, LOCAL_PG_DATABASE=legalm…ckup, LOCAL_PG_USER=legalm…ckup, LOCAL_PG_PASSWORD=[REDACTED], LOCAL_PSQL_PATH=C:\Pro….exe, LOCAL_PG_DUMP_PATH=C:\Pro….exe, LOCAL_PG_RESTORE_PATH=C:\Pro….exe, BACKUP_ROOT=D:\Leg…kups, BACKUP_KEEP_VERIFIED=90, SYNC_POLL_INTERVAL_MS=15000, SYNC_BATCH_SIZE=500, SYNC_MAX_RETRIES=12

## 2) إعدادات SMTP
- المسار في اللوحة: Authentication → Emails → SMTP Settings
- ملاحظة: Values live only in Supabase Dashboard; not readable via public API. Reconfigure on new project.
- الحقول:
  - Enable Custom SMTP — مطلوب
  - Sender email — مطلوب
  - Sender name
  - Host — مطلوب
  - Port — مطلوب
  - Username — مطلوب
  - Password **(سرّي)** — مطلوب
  - Minimum interval between emails
- تبديلات البريد ذات الصلة:
  - Enable Email Signup
  - Confirm email
  - Secure email change
  - Site URL
  - Redirect URLs (must include VITE_APP_URL / production origins)
- تأثيرها على التطبيق:
  - signUp confirmation emails
  - password recovery (resetPasswordForEmail)
  - resend confirmation
  - invite-user Edge Function emails

## 3) إعدادات OAuth
- المسار: Authentication → Providers
- App currently uses email/password + MFA TOTP. OAuth providers are optional.
| المزوّد | مستخدم في التطبيق | ملاحظات |
|--------|-------------------|---------|
| email | نعم | Primary auth path (signInWithPassword / signUp) |
| phone | لا | Not used by LegalMind client |
| google | لا | If enabled later: Client ID + Client Secret required |
| github | لا | If enabled later: Client ID + Client Secret required |
| azure | لا | If enabled later: Client ID + Client Secret + Tenant |
- MFA TOTP: مُفعّل في التطبيق — App uses supabase.auth.mfa (enroll/challenge/verify). MFA factors live in auth schema and sync with auth.users mirror when available.

## 4) أسماء Buckets
- `avatars` (public=true, size_limit=2097152, mime=["image/jpeg","image/png","image/webp"])
- `case-documents` (public=false, size_limit=52428800, mime=["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","image/jpeg","image/png","image/webp"])
- `case-payment-receipts` (public=false, size_limit=10485760, mime=["image/jpeg","image/png","image/webp","application/pdf"])
- `firm-backups` (public=false, size_limit=524288000, mime=["application/zip","application/octet-stream"])
- `legal-documents` (public=false, size_limit=default, mime=[])
- `subscription-receipts` (public=false, size_limit=5242880, mime=["image/jpeg","image/png","image/webp","application/pdf"])

## 5) إعدادات Storage
{
  "inventorySource": "local_mirror",
  "bucketCount": 6,
  "policiesNote": "Storage RLS policies are in supabase/migrations (replay on new project).",
  "serviceRoleDrPolicies": [
    "113_dr_storage_service_role_access.sql",
    "114_fix_storage_policies_service_role_dr.sql"
  ],
  "backupPath": "D:\\LegalMind_Backups\\storage",
  "restoreCommand": "npm run dr:storage-restore -- --source <storage_backup_DIR> --target-url <NEW_URL> --service-role <NEW_KEY>",
  "latestBackup": {
    "runDir": "D:\\LegalMind_Backups\\storage\\storage_backup_2026-07-27T03-36-49-289Z",
    "createdAt": "2026-07-27T03:36:49.291Z",
    "totals": {
      "buckets": 6,
      "files": 1,
      "bytes": 6906,
      "failed": 0,
      "orphaned": 1
    }
  },
  "apiBuckets": []
}

## 6) قائمة Extensions
- المصدر: local_mirror
- `pg_trgm` 1.6
- `pgcrypto` 1.4
- `plpgsql` 1.0
- `uuid-ossp` 1.1

## 7) Edge Functions في المستودع
- `firm-backup`
- `invite-user`
- `legal-ai`

## 8) ما لا يُنسخ تلقائياً (أسرار المشروع)
- JWT Secret الخاص بالمشروع الجديد (يُولَّد تلقائياً ولا يُنقل من المشروع القديم)
- Anon key / Service role key الجديدة
- كلمة مرور قاعدة PostgreSQL للمشروع الجديد
- SMTP password وبيانات مزوّد البريد
- OAuth client secrets (إن وُجدت)
- أي Webhook secrets / Stripe secret keys خارج المستودع

## 9) Orphans Storage (إن وُجدت)
- `subscription-receipts/79444b1a-9ee1-4585-a859-0d7f4657391e/78acbcd0-143e-4ab0-a339-c934d9990abd.png` — metadata_without_blob
