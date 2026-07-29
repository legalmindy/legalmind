# تقرير جاهزية التعافي من الكوارث (أعلى مستوى ممكن)
**التاريخ:** 2026-07-27  
**الإنتاج:** Supabase `gnsjjsvugafxkwgmvcev` — **لم يُحذف ولم تُعدَّل بياناته** في هذا التدقيق  
**المرآة:** PostgreSQL `legalmind_backup` + `D:\LegalMind_Backups\`

---

## الحكم النهائي

**جاهزية عالية جداً لبيانات التطبيق وملفات Storage القابلة للاسترداد — وليست 100٪ مطلقة.**

بعد فقدان مشروع Supabase بالكامل يمكن استعادة:
- المستخدمون / الملفات الشخصية / المكاتب / العملاء / القضايا / المدفوعات / الاشتراكات / الصلاحيات
- ملفات Storage الموجودة فعلياً (حالياً: 1 ملف avatar سليم)
- المخطط عبر `supabase/migrations`

ما يمنع درجة 100٪ المطلقة:
1. أسرار المشروع (JWT / API keys / DB password) تُولَّد جديداً ولا تُنقل
2. SMTP و OAuth client secrets تُعاد يدوياً من لوحة التحكم / مدير أسرار
3. يوجد **orphan واحد** بلا blob — لا يمكن استعادة صورة الإيصال نفسها

---

## 1) ملفات Storage اليتيمة (Orphans)

| البند | القيمة |
|------|--------|
| العدد | **1** |
| المسار | `subscription-receipts/79444b1a-9ee1-4585-a859-0d7f4657391e/78acbcd0-143e-4ab0-a339-c934d9990abd.png` |
| المكتب | علاو للمحاماة (`79444b1a-…`) |
| السجلات المرتبطة | `subscription_requests` (approved) + `payments` (approved) |
| metadata | size=43757, httpStatus=200, eTag موجود → رفع ناجح سابقاً |
| list / download الآن | الملف الثنائي **غير موجود** |

### السبب الدقيق
صف `storage.objects` بقي بعد اختفاء/حذف الـ blob من محرّك Storage. لا يمكن «إصلاح» الملف بإعادة تنزيله لأنه غير موجود أصلاً في الإنتاج.

### لماذا لم نلمسه في الإنتاج؟
بناءً على طلبك: **لا حذف ولا تعديل لبيانات الإنتاج**. التنظيف الاختياري لصف الـ metadata موثّق فقط في:

- `disaster-recovery/STORAGE_ORPHAN_AUDIT.md`
- `npm run dr:orphan-audit`

الأثر التجاري: منخفض (الطلب معتمد) — الأثر على عرض صورة الإيصال: مرتفع لهذا الملف فقط.

---

## 2) نسخ واستعادة Storage

| فحص | النتيجة |
|-----|---------|
| `npm run dr:storage-backup` | **PASS** — 6 buckets، 1 ملف / 6906 بايت، 0 فشل تنزيل، 1 orphan مُبلَّغ |
| `npm run dr:storage-restore -- --dry-run` | **PASS** — checksum مطابق، 0 mismatches |
| مهمة Windows `LegalMind-DR-StorageBackup` | مثبتة (Ready) |
| مرفوض الكتابة على الإنتاج افتراضياً | نعم (إلا بـ `--allow-production-upload`) |

**الخلاصة:** كل blobs الموجودة تُنسخ محلياً ويمكن استعادتها لمشروع جديد.

---

## 3) أداة تصدير الإعدادات غير القابلة للاستعادة التلقائية

```powershell
npm run dr:export-settings
```

المخرجات:
- `disaster-recovery/PROJECT_SETTINGS_EXPORT.md`
- `D:\LegalMind_Backups\PROJECT_SETTINGS_LATEST.md`
- JSON مفصّل تحت `D:\LegalMind_Backups\PROJECT_SETTINGS_*.json`

يشمل التقرير الواحد:
- أسماء متغيرات البيئة المطلوبة (بدون قيم سرّية)
- إعدادات SMTP المطلوبة ومسار اللوحة
- إعدادات OAuth / MFA
- أسماء Buckets + حدود الحجم/MIME
- إعدادات Storage ومسارات النسخ/الاستعادة
- قائمة Extensions (`pgcrypto`, `uuid-ossp`, `pg_trgm`, `plpgsql` على المرآة)
- Edge Functions في المستودع (`invite-user`, `firm-backup`)

---

## 4) قائمة التحقق خطوة بخطوة

الملف: [`DISASTER_RECOVERY_CHECKLIST.md`](./DISASTER_RECOVERY_CHECKLIST.md)

يغطي: مشروع جديد → Auth/SMTP/OAuth → migrations → استعادة DB → استعادة Storage → تحديث التطبيق → فحوص القبول.

---

## 5) إعادة التحقق: المستخدمون / العملاء / القضايا / الملفات

### عدّادات المرآة المحلية (آخر مزامنة)

| الكيان | العدد | قابل للاستعادة من المرآة/dump؟ |
|--------|------|--------------------------------|
| auth.users | 5 | نعم |
| profiles | 5 | نعم |
| firms | 3 | نعم |
| employees | 5 | نعم |
| clients | 1 | نعم |
| cases | 1 | نعم |
| payments / subscription_requests | 1 / 1 | نعم (السجل نعم؛ صورة الإيصال orphan لا) |
| case_payments | 1 | نعم |
| notifications | 1 | نعم |
| storage blobs السليمة | 1 | نعم |
| storage orphans | 1 | **لا** |

### Dry-run الكامل (`npm run dr:dry-run`)
- استعادة قاعدة مؤقتة `legalmind_dr_test` ثم حذفها فقط: **PASS**
- تطابق 30 جدول public مع المرآة: **PASS**
- لا orphan FK (`profiles_without_auth` / `cases_without_firm` = 0): **PASS**
- الإنتاج: **لم يُمس**

تقرير: `D:\LegalMind_Backups\DR_DRY_RUN_LATEST.md`

---

## 6) ما يُنسخ تلقائياً

- مرآة PostgreSQL المستمرة + dumps ليلية (custom + SQL + ZIP)
- `auth.users` (عند نجاح المزامنة)
- metadata لـ Storage + **الملفات الثنائية الموجودة**
- إعادة تطبيق المخطط من Git (`supabase/migrations`)
- Edge Function **source** من المستودع

## 7) ما لا يُنسخ تلقائياً (أسرار / إعدادات مشروع)

| العنصر | السبب |
|--------|------|
| JWT Secret | خاص بكل مشروع Supabase ويُولَّد عند الإنشاء |
| anon / service_role keys | تُصدر مع المشروع الجديد |
| كلمة مرور قاعدة PostgreSQL | سر المشروع الجديد |
| SMTP host/user/password | لوحة Authentication فقط |
| OAuth client secrets | لوحة Providers فقط |
| إعدادات Site URL / Redirect URLs | لوحة Auth |
| حالة Realtime / Vault الداخلية | خارج نطاق dump التطبيق |
| blob الـ orphan الحالي | الملف غير موجود أصلاً |

---

## 8) فجوات متبقية (لا تمنع الاستعادة، لكنها ترفع الجودة)

1. تعيين `SUPABASE_DB_PASSWORD` لتسهيل `supabase db query/push` وتطبيق الهجرة `114` إن لم تُطبَّق بعد على الإنتاج.
2. حفظ نتائج `dr:export-settings` + كلمات SMTP في مدير أسرار offline.
3. إنشاء bucket `legal-documents` ضمن migrations إن كان مطلوباً دائماً (حالياً موجود في الإنتاج وقد يكون أُنشئ يدوياً).
4. تنظيف صف الـ orphan لاحقاً **بموافقة صريحة** فقط، أو طلب إعادة رفع الإيصال من المكتب.
5. ملاحظة تطبيق: `getPublicUrl` لإيصالات الاشتراك رغم أن الـ bucket private — لا يسبب الـ orphan، لكنه رابط عام غير صالح؛ العرض يعتمد على signed URL.

---

## الأوامر الجديدة

| أمر | الوظيفة |
|-----|---------|
| `npm run dr:orphan-audit` | تدقيق orphans (قراءة فقط) |
| `npm run dr:export-settings` | تصدير إعدادات غير قابلة للاستعادة التلقائية |
| `npm run dr:storage-backup` | نسخ Storage |
| `npm run dr:storage-restore -- --dry-run` | التحقق من سلامة النسخة محلياً |
| `npm run dr:dry-run` | محاكاة استعادة قاعدة كاملة |
| `npm run dr:coverage` | تدقيق تغطية شامل |

---

## الخلاصة التنفيذية

النظام **جاهز للتعافي من الكوارث بأعلى درجة عملية ممكنة** لبيانات LegalMind وملفات Storage الموجودة، مع مسار موثّق لمشروع Supabase جديد.

**ليست 100٪ مطلقة** لأن أسرار Supabase الخاصة بالمشروع وإعدادات SMTP/OAuth لا تُنسخ من داخل Supabase نفسه، ولأن إيصال اشتراك واحد فقد ملفه الثنائي قبل النسخ الاحتياطي.
