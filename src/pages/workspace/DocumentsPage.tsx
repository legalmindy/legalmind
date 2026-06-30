import { useMemo, useState } from 'react';
import { Briefcase, FileText, Plus, Download, Loader2, Printer } from 'lucide-react';
import { escapeHtml } from '../../lib/sanitize';
import type { DocumentItem } from '../../types/app';
import type { DocumentsPageProps } from './types';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

function getFileExt(url: string): string {
  return (url.split('?')[0]?.split('.').pop() ?? '').toLowerCase();
}

function isImageDoc(doc: DocumentItem): boolean {
  return IMAGE_EXTS.includes(getFileExt(doc.url));
}

function DocTypeIcon({ category }: { category: string }) {
  const colorMap: Record<string, string> = {
    'عريضة دعوى': 'bg-blue-50 text-blue-700',
    'مذكرة دفاع': 'bg-purple-50 text-purple-700',
    'أدلة إثبات': 'bg-amber-50 text-amber-700',
    'توكيلات رسمية': 'bg-emerald-50 text-emerald-700',
    'حكم قضائي': 'bg-rose-50 text-rose-700',
    'تقارير فنية': 'bg-cyan-50 text-cyan-700',
    'عقد أو اتفاقية': 'bg-indigo-50 text-indigo-700',
    'شهادة أو إفادة': 'bg-orange-50 text-orange-700',
    'مراسلات رسمية': 'bg-teal-50 text-teal-700',
    'صورة أو إثبات': 'bg-pink-50 text-pink-700'
  };
  const cls = colorMap[category] ?? 'bg-slate-50 text-slate-700';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold ${cls}`}>
      {category}
    </span>
  );
}

function DocCard({
  doc,
  onGetUrl
}: {
  doc: DocumentItem;
  onGetUrl?: (id: string) => Promise<string>;
}) {
  const [loading, setLoading] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const isImg = isImageDoc(doc);

  const fetchFreshUrl = async (): Promise<string> => {
    if (onGetUrl) return await onGetUrl(doc.id);
    return doc.url;
  };

  const handleDownload = async () => {
    setLoading(true);
    try {
      const url = await fetchFreshUrl();
      const response = await fetch(url);
      if (!response.ok) throw new Error('فشل التحميل');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = doc.title;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch {
      const url = await fetchFreshUrl().catch(() => doc.url);
      window.open(url, '_blank');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = async () => {
    setPrintLoading(true);
    try {
      const url = await fetchFreshUrl();
      if (isImg) {
        const win = window.open('', '_blank', 'width=900,height=700');
        if (win) {
          const safeTitle = escapeHtml(doc.title);
          const safeUrl = escapeHtml(url);
          win.document.write(
            `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"/><title>${safeTitle}</title>` +
            `<style>*{margin:0;padding:0;box-sizing:border-box}` +
            `body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#fff;font-family:sans-serif;gap:12px}` +
            `h2{font-size:14px;color:#333;padding:8px}` +
            `img{max-width:100%;max-height:90vh;object-fit:contain;box-shadow:0 2px 12px rgba(0,0,0,.15)}` +
            `@media print{h2{display:none}}` +
            `</style></head><body>` +
            `<h2>${safeTitle}</h2>` +
            `<img src="${safeUrl}" onload="setTimeout(function(){window.print();},400)" onerror="document.body.textContent='تعذر تحميل الصورة'" />` +
            `</body></html>`
          );
          win.document.close();
        }
      } else {
        window.open(url, '_blank');
      }
    } catch {
      window.open(doc.url, '_blank');
    } finally {
      setPrintLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all text-right overflow-hidden group">
      <div className="relative h-32 bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center overflow-hidden">
        {isImg && doc.url ? (
          <img
            src={doc.url}
            alt={doc.title}
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="flex flex-col items-center gap-1">
            <FileText className="w-10 h-10 text-slate-300" />
            <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">
              {getFileExt(doc.url) || 'doc'}
            </span>
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className="text-[9px] bg-black/40 text-white px-1.5 py-0.5 rounded font-mono">{doc.size}</span>
        </div>
      </div>

      <div className="p-4 space-y-2">
        <h3 className="font-bold text-sm text-slate-800 line-clamp-2 leading-tight">{doc.title}</h3>
        <div className="flex flex-wrap gap-1">
          <DocTypeIcon category={doc.category} />
        </div>
        <p className="text-[10px] text-slate-400">رُفعت في: {doc.dateUploaded}</p>
      </div>

      <div className="px-4 pb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={loading}
          className="flex-1 min-w-[5rem] flex items-center justify-center gap-1.5 bg-indigo-900 hover:bg-indigo-800 disabled:opacity-50 text-white font-bold px-3 py-2 rounded-xl text-[11px] transition-colors"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          تحميل
        </button>
        <button
          type="button"
          onClick={() => void handlePrint()}
          disabled={printLoading}
          title="طباعة المستند"
          className="flex items-center justify-center gap-1 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-600 font-bold px-3 py-2 rounded-xl text-[11px] transition-colors"
        >
          {printLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
          طباعة
        </button>
      </div>
    </div>
  );
}

export function DocumentsPage({ documents, onCreateDocument, onGetUrl }: DocumentsPageProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, { caseTitle: string; docs: DocumentItem[] }>();
    for (const doc of documents) {
      const key = doc.caseId || '__no_case__';
      if (!map.has(key)) map.set(key, { caseTitle: doc.caseTitle || 'غير مرتبط بقضية', docs: [] });
      map.get(key)!.docs.push(doc);
    }
    return Array.from(map.entries());
  }, [documents]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm text-right">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-slate-900">خزانة المستندات</h1>
          <p className="text-xs text-slate-500 font-medium">
            {documents.length} مستند — مرتبة حسب القضية
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateDocument}
          className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow"
        >
          <Plus className="w-4 h-4" /> رفع وثيقة جديدة
        </button>
      </div>

      {documents.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-bold text-sm">لا توجد مستندات بعد</p>
          <p className="text-xs mt-1">اضغط &quot;رفع وثيقة جديدة&quot; لإضافة أول مستند</p>
        </div>
      )}

      {grouped.map(([caseId, group]) => (
        <div key={caseId} className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-indigo-900 text-white px-4 py-2 rounded-xl shadow-sm">
              <Briefcase className="w-4 h-4 opacity-80" />
              <span className="font-black text-xs">{group.caseTitle}</span>
            </div>
            <span className="text-[10px] text-slate-400 font-bold">{group.docs.length} مستند</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {group.docs.map((doc) => (
              <DocCard key={doc.id} doc={doc} onGetUrl={onGetUrl} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
