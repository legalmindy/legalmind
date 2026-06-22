import type { CaseRecord } from '../types/app';
import { useMemo, useState } from 'react';
import { History, Search, RefreshCcw, Archive } from 'lucide-react';
import { consumeArchiveTab } from '../lib/appRoutes';
import { AuditLogsPage } from './AuditLogsPage';

interface ArchivePageProps {
  cases: CaseRecord[];
  onRestore: (caseId: string) => void;
  onPermanentArchive: (caseId: string) => void;
  showActivityLog?: boolean;
}

export function ArchivePage({
  cases,
  onRestore,
  onPermanentArchive,
  showActivityLog = false
}: ArchivePageProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('الكل');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [activeTab, setActiveTab] = useState<'cases' | 'activity'>(() => consumeArchiveTab() ?? 'cases');

  const filteredCases = useMemo(() => {
    return cases.filter((item) => {
      const search = query.trim().toLowerCase();
      const matchesQuery =
        item.court_case_number.toLowerCase().includes(search) ||
        item.clientName.toLowerCase().includes(search) ||
        item.title.toLowerCase().includes(search) ||
        (item.lawyerName ?? '').toLowerCase().includes(search);
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
            <h1 className="text-2xl font-black text-slate-900">الأرشيف وسجل النشاط</h1>
            <p className="text-xs text-slate-500 mt-1">
              {showActivityLog
                ? 'إدارة القضايا المؤرشفة ومتابعة نشاط الموظفين في المكتب.'
                : 'استرجع الملفات المؤرشفة أو انسخها إلى سجل الأرشيف الدائم بدون إعادة تحميل الصفحة.'}
            </p>
          </div>
          {activeTab === 'cases' ? (
            <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-950 text-white text-xs font-bold hover:bg-indigo-800 transition-all">
              <RefreshCcw className="w-4 h-4" /> تحديث البيانات
            </button>
          ) : null}
        </div>

        {showActivityLog ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setActiveTab('cases')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
                activeTab === 'cases' ? 'bg-indigo-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Archive className="w-4 h-4" />
              القضايا المؤرشفة
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('activity')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
                activeTab === 'activity' ? 'bg-[#7A1F2B] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <History className="w-4 h-4" />
              سجل النشاط
            </button>
          </div>
        ) : null}
      </div>

      {activeTab === 'activity' && showActivityLog ? (
        <AuditLogsPage embedded />
      ) : (
        <>
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
              <div className="flex justify-between"><span>المحامي المباشر</span><span className="font-bold text-indigo-800">{caseItem.lawyerName ?? 'غير معيّن'}</span></div>
              <div className="flex justify-between"><span>نوع القضية</span><span>{caseItem.case_type}</span></div>
              <div className="flex justify-between"><span>المرحلة</span><span>{caseItem.case_stage}</span></div>
              <div className="flex justify-between"><span>صافي المتبقي</span><span className="font-bold">{caseItem.remaining_amount?.toLocaleString()} ر.ي</span></div>
            </div>

            {caseItem.archive_date ? (
              <p className="text-[11px] text-slate-400">
                تاريخ الأرشفة: {caseItem.archive_date.split('T')[0] ?? caseItem.archive_date}
              </p>
            ) : null}

            {caseItem.notes ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
                <p className="mb-1 font-bold text-amber-900">ملاحظات الأرشيف</p>
                <p className="whitespace-pre-wrap leading-relaxed text-slate-700">{caseItem.notes}</p>
              </div>
            ) : null}

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
        </>
      )}
    </div>
  );
}
