import { useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import type { CaseExpense, CaseExpensePaidBy, CaseExpensePaymentStatus, CaseExpenseType } from '../../types/app';
import { addCaseExpenseType } from '../../lib/caseExpenses';

export interface CaseExpenseFormValues {
  expenseType: string;
  amount: string;
  expenseDate: string;
  paymentStatus: CaseExpensePaymentStatus;
  paidBy: CaseExpensePaidBy;
  courtName: string;
  receiptNumber: string;
  notes: string;
  dueDate: string;
  file: File | null;
}

const EMPTY_FORM = (courtHint?: string): CaseExpenseFormValues => ({
  expenseType: '',
  amount: '',
  expenseDate: new Date().toISOString().slice(0, 10),
  paymentStatus: 'غير مدفوع',
  paidBy: 'الموكل',
  courtName: courtHint ?? '',
  receiptNumber: '',
  notes: '',
  dueDate: '',
  file: null
});

interface CaseExpenseModalProps {
  open: boolean;
  types: CaseExpenseType[];
  courtHint?: string;
  initial?: CaseExpense | null;
  saving?: boolean;
  onClose: () => void;
  onTypesChanged: () => void;
  onSubmit: (values: CaseExpenseFormValues) => Promise<void>;
}

export function CaseExpenseModal({
  open,
  types,
  courtHint,
  initial,
  saving,
  onClose,
  onTypesChanged,
  onSubmit
}: CaseExpenseModalProps) {
  const [form, setForm] = useState<CaseExpenseFormValues>(EMPTY_FORM(courtHint));
  const [error, setError] = useState('');
  const [newType, setNewType] = useState('');
  const [addingType, setAddingType] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        expenseType: initial.expenseType,
        amount: String(initial.amount),
        expenseDate: initial.expenseDate,
        paymentStatus: initial.paymentStatus,
        paidBy: initial.paidBy,
        courtName: initial.courtName ?? '',
        receiptNumber: initial.receiptNumber ?? '',
        notes: initial.notes ?? '',
        dueDate: initial.dueDate ?? '',
        file: null
      });
    } else {
      setForm(EMPTY_FORM(courtHint));
    }
    setError('');
    setNewType('');
  }, [open, initial, courtHint]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, saving, onClose]);

  if (!open) return null;

  const handleAddType = async () => {
    if (!newType.trim()) return;
    setAddingType(true);
    setError('');
    try {
      const created = await addCaseExpenseType(newType.trim());
      setForm((f) => ({ ...f, expenseType: created.name }));
      setNewType('');
      onTypesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة النوع');
    } finally {
      setAddingType(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!form.expenseType) {
      setError('اختر نوع المصروف.');
      return;
    }
    if (!amount || amount <= 0) {
      setError('أدخل مبلغاً صحيحاً.');
      return;
    }
    setError('');
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ المصروف');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="case-expense-modal-title"
    >
      <button type="button" className="absolute inset-0 cursor-default" aria-label="إغلاق" onClick={onClose} />

      <div className="relative z-10 flex max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:max-h-[min(90dvh,760px)] sm:rounded-2xl">
        {/* Fixed header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4 py-3 sm:px-5">
          <div>
            <h2 id="case-expense-modal-title" className="text-sm font-black text-slate-900 sm:text-base">
              {initial ? 'تعديل مصروف' : 'إضافة مصروف'}
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">املأ البيانات ثم احفظ من أسفل النافذة</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
            aria-label="إغلاق النافذة"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex min-h-0 flex-1 flex-col">
          {/* Scrollable body only */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            <div className="space-y-3.5">
              <label className="block space-y-1.5">
                <span className="text-[11px] font-bold text-slate-600">نوع المصروف</span>
                <select
                  value={form.expenseType}
                  onChange={(e) => setForm({ ...form, expenseType: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]/40 focus:ring-2 focus:ring-[#7A1F2B]/10"
                  required
                >
                  <option value="">اختر النوع…</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  placeholder="نوع جديد غير موجود في القائمة…"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]/40"
                />
                <button
                  type="button"
                  disabled={addingType || !newType.trim()}
                  onClick={() => void handleAddType()}
                  className="inline-flex shrink-0 items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {addingType ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  إضافة نوع
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-600">المبلغ (ر.ي)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]/40"
                    required
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-600">تاريخ المصروف</span>
                  <input
                    type="date"
                    value={form.expenseDate}
                    onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]/40"
                    required
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-600">حالة السداد</span>
                  <select
                    value={form.paymentStatus}
                    onChange={(e) => setForm({ ...form, paymentStatus: e.target.value as CaseExpensePaymentStatus })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]/40"
                  >
                    <option value="غير مدفوع">غير مدفوع</option>
                    <option value="مدفوع">مدفوع</option>
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-600">دفع بواسطة</span>
                  <select
                    value={form.paidBy}
                    onChange={(e) => setForm({ ...form, paidBy: e.target.value as CaseExpensePaidBy })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]/40"
                  >
                    <option value="الموكل">الموكل</option>
                    <option value="المحامي">المحامي / المكتب</option>
                    <option value="الطرف الآخر">الطرف الآخر</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-600">المحكمة (اختياري)</span>
                  <input
                    value={form.courtName}
                    onChange={(e) => setForm({ ...form, courtName: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]/40"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-600">رقم الإيصال</span>
                  <input
                    value={form.receiptNumber}
                    onChange={(e) => setForm({ ...form, receiptNumber: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]/40"
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-[11px] font-bold text-slate-600">موعد السداد المتوقع (للتنبيه)</span>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]/40"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-[11px] font-bold text-slate-600">ملاحظات</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]/40"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-[11px] font-bold text-slate-600">مرفق الإيصال (صورة / PDF)</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })}
                  className="w-full rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-[#7A1F2B] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white"
                />
                {initial?.attachmentFileName && !form.file ? (
                  <p className="text-[10px] text-slate-400">المرفق الحالي: {initial.attachmentFileName}</p>
                ) : null}
              </label>

              {error ? (
                <p className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          {/* Fixed footer — always visible */}
          <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 sm:px-5">
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60 sm:min-w-[7rem]"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded-xl bg-[#7A1F2B] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#6a1a25] disabled:opacity-60"
              >
                {saving ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري الحفظ…
                  </span>
                ) : initial ? (
                  'حفظ التعديلات'
                ) : (
                  'حفظ المصروف'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
