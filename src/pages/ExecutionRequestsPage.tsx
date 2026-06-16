import { useMemo, useState } from 'react';
import { Edit3, Gavel, Loader2, Plus, Trash2 } from 'lucide-react';
import type { CaseRecord, Client, ExecutionRequest, ExecutionRequestStatus } from '../types/app';
import { useExecutionRequestMutations, useExecutionRequests } from '../hooks/useExecutionRequests';
import { getExecutionStatusLabel } from '../lib/executionRequests';

interface ExecutionRequestsPageProps {
  clients: Client[];
  cases: CaseRecord[];
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const STATUS_OPTIONS: ExecutionRequestStatus[] = ['pending', 'in_progress', 'completed', 'rejected'];

const emptyForm = {
  title: '',
  court: '',
  requestNumber: '',
  status: 'pending' as ExecutionRequestStatus,
  clientId: '',
  caseId: '',
  notes: '',
  dueDate: ''
};

export function ExecutionRequestsPage({ clients, cases, onNotify }: ExecutionRequestsPageProps) {
  const { data: requests = [], isLoading, isError } = useExecutionRequests(true);
  const { create, update, remove } = useExecutionRequestMutations();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExecutionRequest | null>(null);
  const [form, setForm] = useState(emptyForm);

  const statusCounts = useMemo(() => {
    const counts = { pending: 0, in_progress: 0, completed: 0, rejected: 0 };
    for (const item of requests) counts[item.status] += 1;
    return counts;
  }, [requests]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (item: ExecutionRequest) => {
    setEditing(item);
    setForm({
      title: item.title,
      court: item.court,
      requestNumber: item.requestNumber,
      status: item.status,
      clientId: item.clientId ?? '',
      caseId: item.caseId ?? '',
      notes: item.notes ?? '',
      dueDate: item.dueDate?.slice(0, 10) ?? ''
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      onNotify('يرجى إدخال عنوان الطلب.', 'error');
      return;
    }
    const payload = {
      title: form.title,
      court: form.court,
      requestNumber: form.requestNumber,
      status: form.status,
      clientId: form.clientId || undefined,
      caseId: form.caseId || undefined,
      notes: form.notes || undefined,
      dueDate: form.dueDate || undefined
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, input: payload });
        onNotify('تم تحديث طلب التنفيذ.', 'success');
      } else {
        await create.mutateAsync(payload);
        onNotify('تم إضافة طلب التنفيذ.', 'success');
      }
      setShowForm(false);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل حفظ الطلب.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('حذف طلب التنفيذ؟')) return;
    try {
      await remove.mutateAsync(id);
      onNotify('تم حذف الطلب.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل الحذف.', 'error');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6 text-right">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2 justify-end">
            <Gavel className="w-6 h-6 text-amber-600" />
            إدارة طلبات التنفيذ
          </h1>
          <p className="text-xs text-slate-500 font-medium">تسجيل ومتابعة طلبات التنفيذ أمام دوائر التنفيذ.</p>
        </div>
        <button type="button" onClick={openCreate} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow">
          <Plus className="w-4 h-4 stroke-[2.5]" /> طلب تنفيذ جديد
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['pending', 'in_progress', 'completed', 'rejected'] as ExecutionRequestStatus[]).map((status) => (
          <div key={status} className="bg-white rounded-xl border border-slate-100 p-4 text-center">
            <p className="text-[10px] text-slate-500 font-bold">{getExecutionStatusLabel(status)}</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{statusCounts[status]}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : isError ? (
          <p className="p-8 text-center text-rose-600 text-sm">تعذر تحميل طلبات التنفيذ. تأكد من تطبيق migration 028.</p>
        ) : requests.length === 0 ? (
          <p className="p-8 text-center text-slate-400 text-sm">لا توجد طلبات تنفيذ بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100">
                <tr>
                  <th className="py-3.5 px-4 font-bold">العنوان</th>
                  <th className="py-3.5 px-4 font-bold">المحكمة</th>
                  <th className="py-3.5 px-4 font-bold">رقم الطلب</th>
                  <th className="py-3.5 px-4 font-bold">العميل</th>
                  <th className="py-3.5 px-4 font-bold">القضية</th>
                  <th className="py-3.5 px-4 font-bold">الحالة</th>
                  <th className="py-3.5 px-4 font-bold text-center">خيارات</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((item) => (
                  <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="py-3.5 px-4 font-bold text-slate-800">{item.title}</td>
                    <td className="py-3.5 px-4 text-slate-600">{item.court || '—'}</td>
                    <td className="py-3.5 px-4 font-mono text-slate-600">{item.requestNumber || '—'}</td>
                    <td className="py-3.5 px-4 text-slate-600">{item.clientName ?? '—'}</td>
                    <td className="py-3.5 px-4 text-slate-600">{item.caseTitle ?? '—'}</td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">
                        {getExecutionStatusLabel(item.status)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <button type="button" onClick={() => openEdit(item)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded" title="تعديل">
                          <Edit3 className="w-4.5 h-4.5" />
                        </button>
                        <button type="button" onClick={() => void handleDelete(item.id)} className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded" title="حذف">
                          <Trash2 className="w-4.5 h-4.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-xl w-full max-w-lg p-6 space-y-4 text-right max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-black text-slate-900">{editing ? 'تعديل طلب التنفيذ' : 'طلب تنفيذ جديد'}</h3>
            <input type="text" placeholder="عنوان الطلب *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-xs text-right" />
            <div className="grid grid-cols-2 gap-3">
              <input type="text" placeholder="المحكمة / دائرة التنفيذ" value={form.court} onChange={(e) => setForm({ ...form, court: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs text-right" />
              <input type="text" placeholder="رقم الطلب" value={form.requestNumber} onChange={(e) => setForm({ ...form, requestNumber: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs text-right" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs text-right bg-white">
                <option value="">— العميل —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs text-right bg-white">
                <option value="">— القضية —</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ExecutionRequestStatus })} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs text-right bg-white">
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{getExecutionStatusLabel(s)}</option>
                ))}
              </select>
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs text-right" />
            </div>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات" rows={3} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs text-right resize-none" />
            <div className="flex gap-2 justify-start">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100">إلغاء</button>
              <button type="button" disabled={create.isPending || update.isPending} onClick={() => void handleSave()} className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
                {create.isPending || update.isPending ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
