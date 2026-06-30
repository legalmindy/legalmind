# LegalMind Yemen — Production Deployment Checklist

## Pre-deploy (local)

- [ ] `npm install`
- [ ] `npm run build` completes with zero TypeScript errors
- [ ] `.env.local` has valid `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- [ ] Test login, logout, and page refresh (session must persist)
- [ ] Test lawyer registration with firm code
- [ ] Test document upload + download + print
- [ ] Test avatar upload on profile page

## Supabase — Database migrations

Run all migrations in order (`001` → `086`) in **SQL Editor** or via CLI:

```bash
supabase db push
```

Critical recent migrations:

| File | Purpose |
|------|---------|
| `036_office_expenses.sql` | Office expenses table |
| `037`–`040` | Expense delete RLS + RPC |
| `039_fix_firm_code_lookup.sql` | Firm code registration |
| `041_fix_sync_pull_no_400.sql` | Sync RPC safe errors |
| `042_supabase_security_advisor_fix.sql` | Security Advisor fixes |
| `063_security_hardening_fixes.sql` | Privilege escalation + audit hardening |
| `064`–`069` | Office member registration + per-employee permissions |
| `070_expert_security_hardening.sql` | Security events, error-log RPC gate, CSP headers |
| `086_qa_security_fixes.sql` | Close firms anon enumeration + block orphan signups |

## Supabase — Auth settings

- [ ] **Site URL** matches production domain (e.g. `https://app.yourdomain.com`)
- [ ] **Redirect URLs** include production + `/login`, `/register-lawyer`, `/register-office`
- [ ] Enable **Leaked password protection** (Authentication → Password Security)
- [ ] Email templates configured (confirm signup, reset password, invite)

## Supabase — Storage buckets

Verify buckets exist with RLS policies:

- [ ] `case-documents` — document uploads
- [ ] `avatars` — profile photos
- [ ] `subscription-receipts` — payment receipts (if used)

## Supabase — Security Advisor

- [ ] Run migrations `042` through `070`
- [ ] Refresh Security Advisor — resolve remaining warnings
- [ ] Confirm RLS enabled on all tenant tables
- [ ] Enable **Leaked password protection** + consider mandatory MFA for firm owners
- [ ] Verify `security_events` table receives login/logout events after deploy
- [ ] Confirm HTTP security headers (CSP, X-Frame-Options) on production host

## Hosting environment variables

Set in your host (Vercel / Netlify / etc.):

| Variable | Required |
|----------|----------|
| `VITE_SUPABASE_URL` | Yes |
| `VITE_SUPABASE_ANON_KEY` | Yes |
| `VITE_STRIPE_PUBLISHABLE_KEY` | No (future payments) |

## SPA routing

Configure **fallback to `index.html`** for client-side routes:

- `/login`
- `/register-lawyer`
- `/register-office`
- `/invite/*`

## Post-deploy smoke test

- [ ] Landing page loads on mobile + desktop
- [ ] Office admin can log in and see dashboard
- [ ] Lawyer can register with firm code and log in
- [ ] Create client → case → session → document (full flow)
- [ ] Delete expense (admin reports page)
- [ ] Invite employee and accept invitation
- [ ] No console errors on main pages (except dev-only logs)
- [ ] Subscription lock screen appears when trial expired (if applicable)

## Tauri desktop (optional)

```bash
npm run tauri:build
```

Requires Rust toolchain. Offline sync runs only in Tauri runtime.

## Rollback plan

- Keep previous hosting deployment active until smoke tests pass
- Supabase migrations are forward-only — test on staging project first
- Database backups: Supabase Dashboard → Database → Backups
