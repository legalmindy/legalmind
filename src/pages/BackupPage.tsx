import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, HardDrive, Loader2, RefreshCcw, Upload } from 'lucide-react';
import { createFirmBackup, previewBackupRestore, restoreFirmBackup } from '../lib/backupService';
import { BACKUP_TABLE_LABELS, type BackupTable } from '../lib/backupTypes';
import { fetchFirmBackups, formatBytes } from '../lib/securityApi';
import { formatActivityDateTime } from '../lib/auditLogLabels';
import { toArabicQueryError } from '../components/QueryErrorBanner';

function formatTableLabel(table: string): string {
  return BACKUP_TABLE_LABELS[table as BackupTable] ?? table;
}

export function BackupPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewBackupRestore>> | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  const { data: backups = [], isLoading } = useQuery({
    queryKey: ['firm-backups'],
    queryFn: () => fetchFirmBackups(50)
  });

  const handleCreateBackup = async (uploadToServer = false) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createFirmBackup({ uploadToServer });
      setMessage(
        `تم إنشاء النسخة الاحتياطية (${formatBytes(result.sizeBytes)}) — ${result.filename} — ${result.totalRecords} سجل`
      );
      await queryClient.invalidateQueries({ queryKey: ['firm-backups'] });
      await queryClient.invalidateQueries({ queryKey: ['firm-security-stats'] });
    } catch (err) {
      setError(toArabicQueryError(err, 'إنشاء النسخة الاحتياطية'));
    } finally {
      setBusy(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    setRestoreFile(file);
    setError(null);
    try {
      const p = await previewBackupRestore(file);
      setPreview(p);
    } catch (err) {
      setPreview(null);
      setError(toArabicQueryError(err, 'قراءة النسخة'));
    }
  };

  const handleRestore = async () => {
    if (!restoreFile) return;
    if (!window.confirm('سيتم دمج البيانات من النسخة الاحتياطية مع بيانات المكتب الحالية. هل تريد المتابعة؟')) return;
    setBusy(true);
    setError(null);
    try {
      const result = await restoreFirmBackup(restoreFile);
      const warningText = [...result.warnings, ...result.documentFailures].filter(Boolean);
      const base = `تمت الاستعادة: ${result.restored.join('، ') || '—'}`;
      setMessage(warningText.length ? `${base}\nتحذيرات: ${warningText.slice(0, 5).join('؛ ')}` : base);
      setPreview(null);
      setRestoreFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['firm-backups'] }),
        queryClient.invalidateQueries({ queryKey: ['clients'] }),
        queryClient.invalidateQueries({ queryKey: ['cases'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
        queryClient.invalidateQueries({ queryKey: ['expenses'] }),
        queryClient.invalidateQueries({ queryKey: ['firm-security-stats'] })
      ]);
    } catch (err) {
      setError(toArabicQueryError(err, 'استعادة النسخة'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6" dir="rtl">
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-indigo-950/10 p-3">
              <HardDrive className="h-7 w-7 text-indigo-950" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900">النسخ الاحتياطي</h1>
              <p className="mt-1 text-xs text-slate-500">
                احفظ نسخة كاملة من جداول المكتب والملفات والإعدادات — يمكنك تنزيلها واستعادتها لاحقاً.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCreateBackup()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#7A1F2B] px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            إنشاء نسخة احتياطية الآن
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCreateBackup(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-[#7A1F2B] px-4 py-2.5 text-xs font-bold text-[#7A1F2B] disabled:opacity-50"
            title="يحفظ نسخة على Supabase Storage بالإضافة للتنزيل المحلي"
          >
            نسخة سحابية + تنزيل
          </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-black text-slate-800">استعادة نسخة احتياطية</h2>
          <p className="text-xs text-slate-500">
            ارفع ملف ZIP الذي أنشأته من LegalMind. تُستعاد البيانات بالدمج (upsert) دون حذف السجلات الحالية — يشمل العملاء والقضايا والجلسات والمدفوعات وسندات القبض والمصروفات والأدوار والصلاحيات والإشعارات والاشتراكات والملفات.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelect(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700"
          >
            <Upload className="h-4 w-4" /> اختيار ملف النسخة
          </button>
          {preview ? (
            <div className="rounded-xl bg-slate-50 p-4 text-xs space-y-2">
              <p><strong>المكتب:</strong> {preview.firmName ?? '—'}</p>
              <p><strong>التاريخ:</strong> {preview.createdAt ? formatActivityDateTime(preview.createdAt) : '—'}</p>
              <p><strong>الإصدار:</strong> {preview.version ?? '—'}</p>
              <p><strong>إجمالي السجلات:</strong> {preview.totalRecords ?? '—'}</p>
              <p><strong>الجداول:</strong> {preview.tables.map(formatTableLabel).join('، ')}</p>
              {preview.integrity?.warnings.length ? (
                <p className="text-amber-700"><strong>تحذيرات:</strong> {preview.integrity.warnings.join('؛ ')}</p>
              ) : null}
              {preview.integrity && !preview.integrity.valid ? (
                <p className="text-rose-700"><strong>أخطاء:</strong> {preview.integrity.errors.join('؛ ')}</p>
              ) : null}
              <button
                type="button"
                disabled={busy || (preview.integrity != null && !preview.integrity.valid)}
                onClick={() => void handleRestore()}
                className="mt-2 rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50"
              >
                استعادة البيانات
              </button>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-800">النسخ السابقة</h2>
            <button type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: ['firm-backups'] })} className="text-slate-400 hover:text-slate-600">
              <RefreshCcw className="h-4 w-4" />
            </button>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#7A1F2B]" /></div>
          ) : backups.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-slate-400">
              <Archive className="mb-2 h-8 w-8 opacity-40" />
              <p className="text-xs font-bold">لا توجد نسخ مسجّلة بعد</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-2">
              {backups.map((b) => (
                <div key={b.id} className="rounded-xl border border-slate-100 p-3 text-xs">
                  <div className="flex justify-between font-bold text-slate-800">
                    <span>{formatActivityDateTime(b.createdAt)}</span>
                    <span>{formatBytes(b.sizeBytes)}</span>
                  </div>
                  <p className="mt-1 text-slate-500">{b.createdByName ?? 'مدير المكتب'} — {b.fileCount} ملف</p>
                  <p className="text-[10px] text-slate-400">{b.tablesIncluded.join('، ')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {message ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">{message}</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{error}</p> : null}
    </div>
  );
}
