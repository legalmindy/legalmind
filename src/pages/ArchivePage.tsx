import type { CaseRecord } from '../types/app';
import { useMemo, useState } from 'react';
import { Search, RefreshCcw, ArrowUpRight, Archive } from 'lucide-react';

interface ArchivePageProps {
  cases: CaseRecord[];
  onRestore: (caseId: string) => void;
  onPermanentArchive: (caseId: string) => void;
}

export function ArchivePage({ cases, onRestore, onPermanentArchive }: ArchivePageProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('الكل');
  const [statusFilter, setStatusFilter] = useState('الكل');

  const filteredCases = useMemo(() => {
    return cases.filter((item) => {
      const search = query.trim().toLowerCase();
      const matchesQuery =
        item.court_case_number.toLowerCase().includes(search) ||
        item.clientName.toLowerCase().includes(search) ||
        item.title.toLowerCase().includes(search);
      const matchesType = typeFilter === 'الكل' || item.case_type === typeFilter;
      const matchesStatus = statusFilter === 'الكل' || item.status === statusFilter;
      return matchesQuery && matchesType && matchesStatus;
    });
  }, [cases, query, typeFilter, statusFilter]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6 text-right">
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">إدارة الأرشيف والقضايا المغلقة</h1>
            <p className="text-xs text-slate-500 mt-1">استرجع الملفات المؤرشفة أو انسخها إلى سجل الأرشيف الدائم بدون إعادة تحميل الصفحة.</p>
          </div>
          <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-950 text-white text-xs font-bold hover:bg-indigo-800 transition-all">
            <RefreshCcw className="w-4 h-4" /> تحديث البيانات
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="col-span-2 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-3">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث برقم القضية، اسم الموكل أو المحامي"
            className="w-full bg-transparent outline-none text-xs text-right"
          />
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <label className="block text-[10px] text-slate-500 mb-2">فلتر النوع</label>
          <select className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option>الكل</option>
            <option>مدنية</option>
            <option>تجارية</option>
            <option>أحوال شخصية</option>
            <option>عمالية</option>
            <option>مستعجلة</option>
            <option>جنائية</option>
          </select>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <label className="block text-[10px] text-slate-500 mb-2">فلتر الحالة</label>
          <select className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option>الكل</option>
            <option value="archived">مؤرشفة</option>
            <option value="closed">مغلقة</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredCases.map((caseItem) => (
          <div key={caseItem.id} className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 text-right space-y-4">
            <div className="flex justify-between items-start gap-2">
              <div>
                <h2 className="font-black text-slate-900 text-lg">{caseItem.title}</h2>
                <p className="text-[11px] text-slate-500 mt-1">رقم القضية: {caseItem.court_case_number}</p>
              </div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold">
                <Archive className="w-4 h-4" /> {caseItem.status === 'archived' ? 'مؤرشفة' : 'مغلقة'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 text-xs text-slate-600">
              <div className="flex justify-between"><span>الموكل</span><span className="font-bold text-slate-900">{caseItem.clientName}</span></div>
              <div className="flex justify-between"><span>نوع القضية</span><span>{caseItem.case_type}</span></div>
              <div className="flex justify-between"><span>المرحلة</span><span>{caseItem.case_stage}</span></div>
              <div className="flex justify-between"><span>صافي المتبقي</span><span className="font-bold">{caseItem.remaining_amount?.toLocaleString()} ر.ي</span></div>
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={() => onRestore(caseItem.id)} className="px-4 py-2 bg-emerald-500 text-white rounded-xl text-[11px] font-bold hover:bg-emerald-600 transition-all">
                استعادة القضية
              </button>
              <button type="button" onClick={() => onPermanentArchive(caseItem.id)} className="px-4 py-2 bg-rose-500 text-white rounded-xl text-[11px] font-bold hover:bg-rose-600 transition-all">
                أرشفة نهائية
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredCases.length === 0 && (
        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm text-center text-slate-500">
          لا توجد قضايا في الأرشيف بهذه المعايير.
        </div>
      )}
    </div>
  );
}
