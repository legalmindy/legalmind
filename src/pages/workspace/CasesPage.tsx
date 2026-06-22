import { Search, Plus, Trash2, Archive, MessageCircle, AlertCircle, Banknote } from 'lucide-react';
import { hasPermission } from '../../lib/permissions';
import type { CasesPageProps } from './types';
export function CasesPage({ cases, searchQuery, statusFilter, categoryFilter, onSearch, onStatusFilterChange, onCategoryFilterChange, onCreateCase, onEditCase, onViewCase, onArchiveCase, onDeleteCase, onSendPaymentReminder, canSendPaymentReminder, canViewCase360 = false, permissions, userRole }: CasesPageProps) {
  const canCreateCase = hasPermission(permissions, 'cases.create', userRole);
  const canEditCase = hasPermission(permissions, 'cases.edit', userRole);
  const canDeleteCase = hasPermission(permissions, 'cases.delete', userRole);
  const canManagePayments = hasPermission(permissions, 'financials.add_payments', userRole);
  const canPrintReceipt = hasPermission(permissions, 'financials.print_receipts', userRole);
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm text-right">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-slate-900">أرشيف وإدارة ملفات القضايا</h1>
          <p className="text-xs text-slate-500 font-medium">افتح، راقب، وعدّل القضايا المعروضة أمام المحاكم اليمنية.</p>
        </div>
        {canCreateCase ? (
          <button type="button" onClick={onCreateCase} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow">
            <Plus className="w-4 h-4 stroke-[2.5]" /> فتح قضية جديدة
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center">
          <Search className="w-4 h-4 text-slate-400 mr-3" />
          <input type="text" placeholder="بحث عن القضية أو العميل" value={searchQuery} onChange={(e) => onSearch(e.target.value)} className="w-full text-right text-xs bg-transparent outline-none" />
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <label className="text-[10px] text-slate-500 mb-2 block">فلتر الحالة</label>
          <select value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none bg-white">
            <option value="الكل">الكل</option>
            <option value="active">نشط</option>
            <option value="archived">مؤرشف</option>
            <option value="closed">مغلق</option>
          </select>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <label className="text-[10px] text-slate-500 mb-2 block">فلتر التصنيف</label>
          <select value={categoryFilter} onChange={(e) => onCategoryFilterChange(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none bg-white">
            <option value="الكل">الكل</option>
            <option value="تجاري">تجاري</option>
            <option value="مدني">مدني</option>
            <option value="عقاري">عقاري</option>
            <option value="عمالي">عمالي</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {cases.map((caseRecord) => {
          const hasPending = (caseRecord.remaining_amount ?? 0) > 0 && caseRecord.status === 'active';
          return (
            <div
              key={caseRecord.id}
              className={`bg-white rounded-2xl border shadow-sm p-6 space-y-4 transition-all text-right ${hasPending ? 'border-amber-300/60 hover:border-amber-400/80' : 'border-slate-100 hover:border-amber-500/30'}`}
            >
              <div className="flex justify-between items-start gap-3">
                <span className="bg-slate-100 text-slate-700 font-mono font-bold text-xs px-2.5 py-1 rounded">رقم {caseRecord.caseNo}</span>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {hasPending && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[10px] font-bold border border-rose-100">
                      <AlertCircle className="w-3 h-3" />
                      مستحق
                    </span>
                  )}
                  <span className={`px-2.5 py-1 rounded text-xs font-bold ${caseRecord.status === 'active' ? 'bg-emerald-100 text-emerald-800' : caseRecord.status === 'archived' ? 'bg-amber-100 text-amber-800' : caseRecord.status === 'closed' ? 'bg-slate-100 text-slate-800' : 'bg-blue-100 text-indigo-900'}`}>{caseRecord.status === 'active' ? 'نشط' : caseRecord.status === 'archived' ? 'مؤرشف' : caseRecord.status === 'closed' ? 'مغلق' : caseRecord.status}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <h3 className="font-extrabold text-base text-slate-900 leading-snug line-clamp-2">{caseRecord.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{caseRecord.description}</p>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-xl text-xs space-y-2">
                <div className="flex justify-between"><span className="text-slate-400">العميل:</span><span className="font-bold text-slate-800">{caseRecord.clientName}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">المحامي المباشر:</span><span className="font-bold text-indigo-800">{caseRecord.lawyerName ?? 'غير معيّن'}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">المحكمة:</span><span className="font-bold text-slate-700">{caseRecord.court}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">التصنيف:</span><span className="font-semibold text-indigo-700">{caseRecord.category}</span></div>
              </div>

              {/* Financial summary */}
              {caseRecord.total_amount > 0 && (
                <div className={`rounded-xl text-xs px-3.5 py-3 space-y-1.5 border ${hasPending ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'}`}>
                  <div className="flex justify-between">
                    <span className="text-slate-500">إجمالي الأتعاب</span>
                    <span className="font-mono font-bold text-slate-700">{(caseRecord.total_amount).toLocaleString('ar-YE')} ر.ي</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">المسدّد</span>
                    <span className="font-mono font-bold text-emerald-700">{(caseRecord.paid_amount).toLocaleString('ar-YE')} ر.ي</span>
                  </div>
                  {hasPending ? (
                    <div className="flex justify-between border-t border-amber-200 pt-1.5">
                      <span className="font-bold text-rose-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> المتبقي المستحق</span>
                      <span className="font-mono font-black text-rose-700">{(caseRecord.remaining_amount).toLocaleString('ar-YE')} ر.ي</span>
                    </div>
                  ) : (
                    <div className="flex justify-between border-t border-emerald-200 pt-1.5">
                      <span className="font-bold text-emerald-600">الأتعاب مسدّدة بالكامل ✓</span>
                      <span className="font-mono font-bold text-emerald-700">0 ر.ي</span>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-slate-100 pt-4 flex justify-between items-center text-xs">
                <span className="text-slate-400">بدأت في: {caseRecord.dateStarted}</span>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {hasPending && canSendPaymentReminder && onSendPaymentReminder && (
                    <button
                      type="button"
                      onClick={() => onSendPaymentReminder(caseRecord)}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-all border border-emerald-100"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      تذكير واتساب
                    </button>
                  )}
                  {canEditCase ? (
                    <button
                      type="button"
                      onClick={() => onArchiveCase(caseRecord)}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-bold text-amber-800 transition-all hover:bg-amber-50"
                    >
                      <Archive className="h-3.5 w-3.5" />
                      أرشفة
                    </button>
                  ) : null}
                  {canViewCase360 ? (
                    <button type="button" onClick={() => onViewCase(caseRecord)} className="inline-flex items-center gap-1 px-3 py-1.5 hover:bg-[#7A1F2B]/10 text-[#7A1F2B] rounded-lg font-bold transition-all">
                      {canManagePayments || canPrintReceipt ? (
                        <>
                          <Banknote className="h-3.5 w-3.5" />
                          المالية وسند القبض
                        </>
                      ) : (
                        'بيانات القضية'
                      )}
                    </button>
                  ) : null}
                  {canEditCase ? (
                    <button type="button" onClick={() => onEditCase(caseRecord)} className="px-3 py-1.5 hover:bg-indigo-50 text-indigo-700 rounded-lg font-bold transition-all">تعديل الملف</button>
                  ) : null}
                  {canDeleteCase ? (
                    <button type="button" onClick={() => onDeleteCase(caseRecord.id)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
