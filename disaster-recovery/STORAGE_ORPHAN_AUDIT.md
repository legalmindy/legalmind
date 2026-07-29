# تدقيق ملفات Storage اليتيمة (Orphans)
**التاريخ:** 2026-07-27T03:36:22.383Z
**السلامة:** قراءة فقط — لم يُحذف ولم يُعدَّل أي شيء في الإنتاج.

## الخلاصة
- عدد orphans: **1**
- ملفات قابلة للنسخ: تُعالَج عبر `npm run dr:storage-backup`

## Orphan: `subscription-receipts/79444b1a-9ee1-4585-a859-0d7f4657391e/78acbcd0-143e-4ab0-a339-c934d9990abd.png`
- object id: `f2c8b97f-cf73-49e0-bc9d-9102d47534bd`
- owner: `9a68b124-51da-425e-a6a5-0315f0c9fb91`
- created_at: 2026-07-27T03:54:04.672314+03:00
- metadata: `{"eTag":"\"88c57560310e8ef7e97f767063d5b68e\"","size":43757,"mimetype":"image/png","cacheControl":"max-age=3600","lastModified":"2026-07-27T00:54:05.000Z","contentLength":43757,"httpStatusCode":200}`
- list exists: false
- download: skipped_download_list_missing
- firm: علاو للمحاماة
- subscription_requests: 1
- payments: 1

### السبب
صف في storage.objects موجود، لكن الـ blob غير موجود في محرّك Storage (list=false + download فشل). metadata تشير إلى رفع ناجح سابقاً (size=43757, eTag=yes, httpStatus=200). إذن الملف وُجد ثم فُقد/حُذف من الطبقة الثنائية دون حذف صف الـ metadata. سجلات التطبيق ما زالت تشير إلى هذا المسار (subscription_requests / payments). الحالة التجارية قد تكون مكتملة (approved) بينما صورة الإيصال غير قابلة للعرض. ملاحظة تطبيق: receipt_url يستخدم مسار public بينما الـ bucket خاص (private). هذا لا يسبب اختفاء الـ blob، لكنه يجعل الرابط العام غير صالح؛ العرض يعتمد على signed URL.

### الأثر: منخفض للأعمال (الطلب معتمد) — مرتفع لعرض الإيصال فقط
### هل يُستعاد من النسخة؟ **لا** (لا يوجد blob للنسخ)

### إجراءات يدوية موصى بها
- لا تحذف صف metadata تلقائياً أثناء تدقيق DR.
- اطلب من المكتب إعادة رفع إيصال إن لزم عرض الصورة لاحقاً.
- اختياري لاحقاً (بموافقة صريحة): حذف صف orphan من storage.objects فقط بعد التأكد أن لا حاجة للملف.
- أبقِ النسخ الاحتياطي يسجّل orphans في MANIFEST دون اعتبارها فشل نسخ للملفات الحقيقية.

## SQL اختياري للتنظيف لاحقاً (لا يُنفَّذ تلقائياً)
```sql
-- ONLY with explicit human approval — deletes metadata rows, not blobs
-- delete from storage.objects where id = 'f2c8b97f-cf73-49e0-bc9d-9102d47534bd'; -- subscription-receipts/79444b1a-9ee1-4585-a859-0d7f4657391e/78acbcd0-143e-4ab0-a339-c934d9990abd.png
```
