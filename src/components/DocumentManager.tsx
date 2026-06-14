import { useState } from 'react';
import { FilePlus, Download, Paperclip, Trash2 } from 'lucide-react';
import type { DocumentItem } from '../types/app';

interface DocumentManagerProps {
  documents: DocumentItem[];
  onUpload: (file: File, caseId: string) => Promise<void>;
  cases: { id: string; title: string }[];
}

export function DocumentManager({ documents, onUpload, cases }: DocumentManagerProps) {
  const [selectedCase, setSelectedCase] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const supported = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png', 'image/webp'];

  const handleFiles = async (selected: FileList | null) => {
    if (!selected) return;
    const next: File[] = [];
    for (let i = 0; i < selected.length; i += 1) {
      const file = selected.item(i);
      if (!file) continue;
      if (!supported.includes(file.type)) {
        setError('الملف غير مدعوم. يرجى رفع PDF، DOCX، XLSX، JPG، PNG أو WEBP.');
        continue;
      }
      next.push(file);
    }
    setFiles((current) => [...current, ...next]);
  };

  const uploadAll = async () => {
    if (!selectedCase) {
      setError('يرجى اختيار القضية قبل رفع الملفات.');
      return;
    }
    setError('');
    for (const file of files) {
      await onUpload(file, selectedCase);
    }
    setFiles([]);
  };

  return (
    <div className="space-y-6 text-right">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <label className="block text-slate-500 text-[11px] mb-2 font-bold">القضية المرتبطة</label>
          <select value={selectedCase} onChange={(e) => setSelectedCase(e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm bg-white text-right outline-none">
            <option value="">اختر قضية</option>
            {cases.map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>

          <div className="mt-5 p-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-slate-600">
            <div className="flex flex-col items-center justify-center gap-3">
              <Paperclip className="w-10 h-10 text-indigo-700" />
              <p className="text-sm font-bold">سحب وإسقاط الملفات هنا</p>
              <p className="text-[11px] text-slate-500">يمكنك رفع PDF، DOCX، XLSX، JPG، PNG، WEBP</p>
              <input type="file" multiple accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp" onChange={(e) => handleFiles(e.target.files)} className="w-full text-xs text-right" />
            </div>
          </div>

          {error && <p className="text-rose-600 text-xs">{error}</p>}

          {files.length > 0 && (
            <div className="mt-4 bg-white p-4 rounded-3xl border border-slate-100 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">الملفات المعلقة</p>
                  <p className="text-[11px] text-slate-500">راجع الملفات قبل الرفع.</p>
                </div>
                <button type="button" onClick={() => setFiles([])} className="text-rose-600 text-xs font-bold hover:underline">مسح الكل</button>
              </div>
              <div className="space-y-2">
                {files.map((file) => (
                  <div key={file.name} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-3 bg-slate-50">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{file.name}</p>
                      <p className="text-[11px] text-slate-500">{(file.size / 1024).toFixed(2)} KB</p>
                    </div>
                    <button type="button" onClick={() => setFiles((current) => current.filter((item) => item !== file))} className="text-rose-600 hover:text-rose-700">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={uploadAll} className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-950 text-white py-3 text-xs font-bold hover:bg-indigo-800 transition-all">
                <FilePlus className="w-4 h-4" /> رفع الملفّات المختارة
              </button>
            </div>
          )}
        </div>
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-sm font-black text-slate-900">تحكم سلس في المرفقات</h3>
          <p className="text-[11px] text-slate-500 mt-2">يتم حفظ بيانات كل ملف مع بيانات القضية والمستخدم واتّجاه السحب والإفلات.</p>
          <div className="mt-4 space-y-3">
            {documents.slice(0, 4).map((doc) => (
              <div key={doc.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3">
                <div className="space-y-0.5 text-right">
                  <p className="text-xs font-bold text-slate-900">{doc.title}</p>
                  <p className="text-[10px] text-slate-500">{doc.category} · {doc.size}</p>
                </div>
                <a href={doc.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline text-xs flex items-center gap-1">
                  <Download className="w-4 h-4" /> تنزيل
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
