# Disaster Recovery Checklist — LegalMind Yemen

دليل خطوة بخطوة لإنشاء مشروع Supabase جديد واستعادة النظام بالكامل بعد فقدان المشروع الحالي.

**قاعدة السلامة:** لا تحذف مشروع الإنتاج ولا تكتب فوقه أثناء التدريب. جرّب الاستعادة أولاً على مشروع/قاعدة مؤقتة.

---

## A) ما يجب أن يكون جاهزاً قبل الكارثة

- [ ] `npm run dr:sync` يعمل باستمرار (مرآة `legalmind_backup`)
- [ ] مهمة ليلية: `npm run dr:backup` (dump + storage)
- [ ] `npm run dr:storage-backup` ناجح و`D:\LegalMind_Backups\storage\LATEST.json` محدّث
- [ ] `npm run dr:export-settings` تم تشغيله وحفظ التقرير مع أسرار SMTP/OAuth في مدير أسرار خارجي
- [ ] نسخة من `.env.disaster-recovery` و`.env.local` (أسماء القيم السرية) محفوظة offline
- [ ] الهجرات في `supabase/migrations` موجودة في Git

---

## B) إنشاء مشروع Supabase جديد

1. [ ] من [Supabase Dashboard](https://supabase.com/dashboard) → **New project**
2. [ ] اختر المنظمة والمنطقة (يفضّل نفس منطقة الإنتاج السابق إن أمكن)
3. [ ] احفظ فوراً في مدير أسرار:
   - Project URL
   - `anon` key
   - `service_role` key
   - Database password
   - JWT Secret (Settings → API)
4. [ ] سجّل المرجع الجديد: `https://<NEW_REF>.supabase.co`

---

## C) إعداد Auth / SMTP / OAuth يدوياً (لا تُستعاد تلقائياً)

استخدم التقرير: `disaster-recovery/PROJECT_SETTINGS_EXPORT.md` أو `D:\LegalMind_Backups\PROJECT_SETTINGS_LATEST.md`

### C1) Site URL و Redirect URLs
- [ ] Authentication → URL Configuration
- [ ] Site URL = قيمة `VITE_APP_URL` الإنتاجية
- [ ] Redirect URLs تشمل نطاق التطبيق + أي deep links

### C2) SMTP
- [ ] Authentication → Emails → SMTP Settings
- [ ] فعّل Custom SMTP وأدخل: Host / Port / User / Password / Sender
- [ ] اختبر: Signup confirmation + Password recovery

### C3) Providers
- [ ] Email/Password: مفعّل (المسار الأساسي للتطبيق)
- [ ] MFA TOTP: اتركه متاحاً (التطبيق يستخدم `supabase.auth.mfa`)
- [ ] OAuth (Google/GitHub/…): فقط إن كان مستخدماً سابقاً — أعد Client ID/Secret

### C4) Edge Function secrets
- [ ] Functions → Secrets:
  - `SITE_URL`
  - (عادة تُحقن تلقائياً) `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- [ ] انشر الدوال من المستودع:
  - `supabase/functions/invite-user`
  - `supabase/functions/firm-backup`

---

## D) تطبيق المخطط (Migrations)

من جهاز فيه Supabase CLI مرتبط بالمشروع **الجديد**:

```powershell
cd D:\LegalMindYemen
npx supabase link --project-ref <NEW_REF>
# عيّن SUPABASE_DB_PASSWORD لكلمة مرور المشروع الجديد
npx supabase db push
# أو طبّق الملفات بالترتيب من supabase/migrations
```

- [ ] تأكد من إنشاء الـ buckets عبر الهجرات:
  - `avatars`
  - `case-documents`
  - `subscription-receipts`
  - `case-payment-receipts`
  - `firm-backups`
- [ ] إن وُجد bucket إضافي غير موجود في الهجرات (مثل `legal-documents` في الإنتاج الحالي): أنشئه يدوياً بنفس الاسم والإعدادات من تقرير الإعدادات
- [ ] تأكد من تطبيق `113` و`114` (صلاحيات `service_role` لنسخ/استعادة Storage)

---

## E) استعادة بيانات قاعدة البيانات

### الخيار الموصى به (مرآة محلية → فحص → مشروع جديد)

1. [ ] اختر أحدث dump موثّق:
   - `D:\LegalMind_Backups\nightly\legalmind_backup_*.dump`
2. [ ] Dry-run محلي أولاً:

```powershell
npm run dr:test
# أو
npm run dr:restore -- --source D:\LegalMind_Backups\nightly\<FILE>.dump
```

3. [ ] استعادة إلى قاعدة المشروع الجديد:

```powershell
npm run dr:restore -- --source D:\LegalMind_Backups\nightly\<FILE>.dump --database-url "postgresql://postgres:<DB_PASSWORD>@db.<NEW_REF>.supabase.co:5432/postgres" --allow-destructive
```

4. [ ] تحقق سريع للعدّادات:
   - `auth.users` / `profiles` / `firms` / `clients` / `cases` / `sessions` / `payments`

> ملاحظة: استعادة `auth.users` إلى مشروع Supabase جديد قد تتطلب مواءمة إضافية (كلمات المرور المشفّرة بـ JWT/instance secrets). إن فشل تسجيل الدخول بكلمات المرور القديمة: استخدم تدفق استعادة كلمة المرور عبر SMTP بعد ضبطه.

---

## F) استعادة ملفات Storage

1. [ ] حدد أحدث نسخة:
   - `D:\LegalMind_Backups\storage\LATEST.json` → `runDir`
2. [ ] تحقق محلي (بدون رفع):

```powershell
npm run dr:storage-restore -- --source <runDir> --dry-run
```

3. [ ] ارفع إلى المشروع الجديد فقط:

```powershell
npm run dr:storage-restore -- --source <runDir> --target-url https://<NEW_REF>.supabase.co --service-role <NEW_SERVICE_ROLE_KEY>
```

- [ ] لا تستخدم `--allow-production-upload` إلا إذا كنت واعياً أنك تكتب على الإنتاج الحالي
- [ ] راجع `MANIFEST.json` → قسم `orphans`: هذه الملفات **لا تُستعاد** لأنه لا يوجد blob أصلاً

---

## G) تحديث التطبيق

- [ ] حدّث `.env.local` / أسرار النشر:
  - `VITE_SUPABASE_URL=https://<NEW_REF>.supabase.co`
  - `VITE_SUPABASE_ANON_KEY=<new anon>`
- [ ] حدّث `.env.disaster-recovery` للمزامنة نحو المشروع الجديد بعد الاستقرار
- [ ] أعد بناء ونشر الويب/الهاتف/سطح المكتب
- [ ] تحقق من تسجيل الدخول، العملاء، القضايا، الملفات، الاشتراكات

---

## H) التحقق النهائي بعد الاستعادة

| فحص | أمر / طريقة | متوقع |
|-----|-------------|--------|
| عداد المستخدمين | SQL `count(*)` على `auth.users` / `profiles` | يطابق آخر مرآة |
| العملاء / القضايا | `clients` / `cases` | يطابق |
| Storage blobs | مقارنة عدد الملفات مع MANIFEST (غير orphans) | تطابق checksum |
| SMTP | طلب إعادة تعيين كلمة مرور | يصل البريد |
| Edge invite | دعوة مستخدم تجريبية | تصل الرسالة |
| MFA | إن كان مفعّلاً لمستخدم | يعمل بعد استعادة عوامل MFA إن وُجدت في dump |

أوامر مساعدة:

```powershell
npm run dr:coverage
npm run dr:orphan-audit
npm run dr:export-settings
npm run dr:dry-run
```

---

## I) ما لن يعود تلقائياً أبداً (أسرار خاصة بالمشروع)

يجب إعادة إنشائها/إدخالها يدوياً في المشروع الجديد:

1. JWT Secret + API keys الجديدة
2. كلمة مرور قاعدة البيانات
3. إعدادات SMTP وكلمة مرور مزوّد البريد
4. OAuth Client Secrets (إن وُجدت)
5. أي مفاتيح Stripe سرّية / webhooks
6. إعدادات لوحة التحكم غير المخزّنة في SQL (rate limits البصرية، إلخ)
7. blobs اليتيمة (metadata بدون ملف) — غير قابلة للاستعادة

---

## J) ترتيب الطوارئ المختصر (صفحة واحدة)

1. أنشئ مشروع Supabase جديد واحفظ المفاتيح  
2. اضبط SMTP + Site URL + Redirect URLs  
3. `supabase db push` (migrations)  
4. `npm run dr:restore -- --database-url ...`  
5. `npm run dr:storage-restore -- --target-url ... --service-role ...`  
6. حدّث `VITE_SUPABASE_*` وانشر التطبيق  
7. اختبر login + بيانات + ملفات + بريد  
