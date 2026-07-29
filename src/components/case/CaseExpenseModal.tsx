import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

const fieldClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#7A1F2B]/50 focus:ring-2 focus:ring-[#7A1F2B]/10';
const labelClass = 'mb-1 block text-[11px] font-bold text-slate-600';

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
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, saving, onClose]);

  if (!open || typeof document === 'undefined') return null;

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

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="case-expense-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-[1px]"
        aria-label="إغلاق"
        onClick={onClose}
      />

      <div className="relative z-10 grid w-full max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl h-[min(92dvh,820px)] sm:h-auto sm:max-h-[92dvh]">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="min-w-0 text-right">
            <h2 id="case-expense-modal-title" className="truncate text-base font-black text-slate-900">
              {initial ? 'تعديل مصروف' : 'إضافة مصروف'}
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">جميع الحقول ظاهرة أدناه — احفظ من الشريط السفلي</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
            aria-label="إغلاق النافذة"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form id="case-expense-form" onSubmit={(e) => void handleSubmit(e)} className="min-h-0 overflow-y-auto">
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-3 sm:p-5">
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="expense-type">
                نوع المصروف
              </label>
              <select
                id="expense-type"
                value={form.expenseType}
                onChange={(e) => setForm({ ...form, expenseType: e.target.value })}
                className={fieldClass}
                required
              >
                <option value="">اختر النوع…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
              <input
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                placeholder="نوع جديد غير موجود في القائمة…"
                className={`${fieldClass} min-w-0 flex-1`}
              />
              <button
                type="button"
                disabled={addingType || !newType.trim()}
                onClick={() => void handleAddType()}
                className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {addingType ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                إضافة نوع
              </button>
            </div>

            <div>
              <label className={labelClass} htmlFor="expense-amount">
                المبلغ (ر.ي)
              </label>
              <input
                id="expense-amount"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className={fieldClass}
                required
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="expense-date">
                تاريخ المصروف
              </label>
              <input
                id="expense-date"
                type="date"
                value={form.expenseDate}
                onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                className={fieldClass}
                required
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="payment-status">
                حالة السداد
              </label>
              <select
                id="payment-status"
                value={form.paymentStatus}
                onChange={(e) => setForm({ ...form, paymentStatus: e.target.value as CaseExpensePaymentStatus })}
                className={fieldClass}
              >
                <option value="غير مدفوع">غير مدفوع</option>
                <option value="مدفوع">مدفوع</option>
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="paid-by">
                دفع بواسطة
              </label>
              <select
                id="paid-by"
                value={form.paidBy}
                onChange={(e) => setForm({ ...form, paidBy: e.target.value as CaseExpensePaidBy })}
                className={fieldClass}
              >
                <option value="الموكل">الموكل</option>
                <option value="المحامي">المحامي / المكتب</option>
                <option value="الطرف الآخر">الطرف الآخر</option>
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="court-name">
                المحكمة (اختياري)
              </label>
              <input
                id="court-name"
                value={form.courtName}
                onChange={(e) => setForm({ ...form, courtName: e.target.value })}
                className={fieldClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="receipt-number">
                رقم الإيصال
              </label>
              <input
                id="receipt-number"
                value={form.receiptNumber}
                onChange={(e) => setForm({ ...form, receiptNumber: e.target.value })}
                className={fieldClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="due-date">
                موعد السداد المتوقع
              </label>
              <input
                id="due-date"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className={fieldClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="expense-file">
                مرفق الإيصال
              </label>
              <input
                id="expense-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })}
                className="w-full rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs file:ml-3 file:rounded-md file:border-0 file:bg-[#7A1F2B] file:px-2.5 file:py-1 file:text-[11px] file:font-bold file:text-white"
              />
              {initial?.attachmentFileName && !form.file ? (
                <p className="mt-1 text-[10px] text-slate-400">الحالي: {initial.attachmentFileName}</p>
              ) : null}
            </div>

            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="expense-notes">
                ملاحظات
              </label>
              <textarea
                id="expense-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className={`${fieldClass} resize-none`}
              />
            </div>

            {error ? (
              <p className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 sm:col-span-2">
                {error}
              </p>
            ) : null}
          </div>
        </form>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-3 sm:flex-row sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60 sm:min-w-[8rem]"
          >
            إلغاء
          </button>
          <button
            type="submit"
            form="case-expense-form"
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
        </footer>
      </div>
    </div>,
    document.body
  );
}
