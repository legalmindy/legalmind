import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  addCaseExpense,
  fetchCaseExpenseTypes,
  fetchCaseExpenses,
  getCaseExpenseReceiptUrl,
  softDeleteCaseExpense,
  summarizeCaseExpenses,
  updateCaseExpense,
  updateCaseExpenseBudget,
  uploadCaseExpenseReceipt
} from '../../lib/caseExpenses';
import { toArabicQueryError } from '../QueryErrorBanner';
import { CaseExpenseModal, type CaseExpenseFormValues } from './CaseExpenseModal';
import type { CaseExpense, CaseFinancialSummary } from '../../types/app';

interface CaseExpensesPanelProps {
  caseId: string;
  courtHint?: string;
  canManage: boolean;
  summary?: CaseFinancialSummary | null;
  onChanged: () => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function CaseExpensesPanel({
  caseId,
  courtHint,
  canManage,
  summary,
  onChanged,
  onNotify
}: CaseExpensesPanelProps) {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CaseExpense | null>(null);
  const [saving, setSaving] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');

  useEffect(() => {
    setBudgetInput(summary?.expenseBudget != null ? String(summary.expenseBudget) : '');
  }, [summary?.expenseBudget]);

  const { data: expenses = [], isLoading, refetch } = useQuery({
    queryKey: ['case-expenses', caseId],
    queryFn: () => fetchCaseExpenses(caseId)
  });

  const { data: types = [], refetch: refetchTypes } = useQuery({
    queryKey: ['case-expense-types'],
    queryFn: fetchCaseExpenseTypes
  });

  const stats = useMemo(() => summarizeCaseExpenses(expenses), [expenses]);
  const overBudget =
    summary?.expenseBudget != null && stats.total > summary.expenseBudget
      ? stats.total - summary.expenseBudget
      : 0;

  const refresh = async () => {
    await refetch();
    onChanged();
    void queryClient.invalidateQueries({ queryKey: ['case-expense-alerts'] });
  };

  const handleSave = async (values: CaseExpenseFormValues) => {
    setSaving(true);
    try {
      const amount = parseFloat(values.amount);
      if (editing) {
        await updateCaseExpense({
          expenseId: editing.id,
          expenseType: values.expenseType,
          amount,
          expenseDate: values.expenseDate,
          paymentStatus: values.paymentStatus,
          paidBy: values.paidBy,
          courtName: values.courtName,
          receiptNumber: values.receiptNumber,
          notes: values.notes,
          dueDate: values.dueDate || null,
          clearDueDate: !values.dueDate
        });
        if (values.file) {
          const uploaded = await uploadCaseExpenseReceipt(caseId, editing.id, values.file);
          await updateCaseExpense({
            expenseId: editing.id,
            attachmentPath: uploaded.path,
            attachmentFileName: uploaded.fileName
          });
        }
        onNotify('تم تحديث المصروف.', 'success');
      } else {
        const { expenseId } = await addCaseExpense({
          caseId,
          expenseType: values.expenseType,
          amount,
          expenseDate: values.expenseDate,
          paymentStatus: values.paymentStatus,
          paidBy: values.paidBy,
          courtName: values.courtName || undefined,
          receiptNumber: values.receiptNumber || undefined,
          notes: values.notes || undefined,
          dueDate: values.dueDate || undefined
        });
        if (values.file) {
          const uploaded = await uploadCaseExpenseReceipt(caseId, expenseId, values.file);
          await updateCaseExpense({
            expenseId,
            attachmentPath: uploaded.path,
            attachmentFileName: uploaded.fileName
          });
        }
        onNotify('تمت إضافة المصروف.', 'success');
      }
      setModalOpen(false);
      setEditing(null);
      await refresh();
    } catch (err) {
      throw new Error(toArabicQueryError(err, 'حفظ المصروف'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (expense: CaseExpense) => {
    if (!window.confirm('حذف هذا المصروف؟')) return;
    try {
      await softDeleteCaseExpense(expense.id);
      onNotify('تم حذف المصروف.', 'success');
      await refresh();
    } catch (err) {
      onNotify(toArabicQueryError(err, 'حذف المصروف'), 'error');
    }
  };

  const openAttachment = async (expense: CaseExpense) => {
    if (!expense.attachmentPath) return;
    try {
      const url = await getCaseExpenseReceiptUrl(expense.attachmentPath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      onNotify(toArabicQueryError(err, 'فتح المرفق'), 'error');
    }
  };

  return (
    <div className="space-y-4">
      {overBudget > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            تجاوزت مصاريف القضية الميزانية بمقدار{' '}
            <strong>{overBudget.toLocaleString('ar-YE')} ر.ي</strong>
            {summary?.expenseBudget != null ? ` (الميزانية ${summary.expenseBudget.toLocaleString('ar-YE')} ر.ي)` : ''}.
          </p>
        </div>
      ) : null}

      {stats.unpaid > 0 ? (
        <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
          يوجد مصروفات غير مدفوعة بقيمة <strong>{stats.unpaid.toLocaleString('ar-YE')} ر.ي</strong>.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'إجمالي المصروفات', value: stats.total, color: 'text-slate-900' },
          { label: 'إجمالي المدفوع', value: stats.paid, color: 'text-emerald-700' },
          { label: 'إجمالي غير المدفوع', value: stats.unpaid, color: 'text-rose-700' },
          { label: 'عدد المصروفات', value: stats.count, color: 'text-indigo-700', raw: true }
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-[10px] text-slate-500">{card.label}</p>
            <p className={`text-lg font-black ${card.color}`}>
              {card.raw ? card.value : Number(card.value).toLocaleString('ar-YE')}
              {!card.raw ? ' ر.ي' : ''}
            </p>
          </div>
        ))}
      </div>

      {canManage ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="space-y-1">
            <span className="text-[10px] font-bold text-slate-500">ميزانية مصاريف القضية (اختياري)</span>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder="بدون حد"
                className="w-36 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    try {
                      const raw = budgetInput.trim();
                      const value = raw === '' ? null : Number(raw);
                      if (value != null && (Number.isNaN(value) || value < 0)) {
                        onNotify('قيمة الميزانية غير صحيحة.', 'error');
                        return;
                      }
                      await updateCaseExpenseBudget(caseId, value);
                      onNotify('تم تحديث ميزانية المصاريف.', 'success');
                      onChanged();
                    } catch (err) {
                      onNotify(toArabicQueryError(err, 'تحديث الميزانية'), 'error');
                    }
                  })();
                }}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
              >
                حفظ الميزانية
              </button>
            </div>
          </label>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-[#7A1F2B] px-3 py-1.5 text-xs font-bold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            إضافة مصروف
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-[#7A1F2B]" />
        </div>
      ) : expenses.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">لا توجد مصروفات مسجّلة لهذه القضية.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="min-w-full text-right text-xs">
            <thead className="bg-slate-50 text-[10px] text-slate-500">
              <tr>
                <th className="px-3 py-2 font-bold">التاريخ</th>
                <th className="px-3 py-2 font-bold">النوع</th>
                <th className="px-3 py-2 font-bold">القيمة</th>
                <th className="px-3 py-2 font-bold">السداد</th>
                <th className="px-3 py-2 font-bold">دفع بواسطة</th>
                <th className="px-3 py-2 font-bold">ملاحظات</th>
                <th className="px-3 py-2 font-bold">مرفق</th>
                {canManage ? <th className="px-3 py-2 font-bold">إجراءات</th> : null}
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id} className="border-t border-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">{expense.expenseDate}</td>
                  <td className="px-3 py-2 font-bold text-slate-800">{expense.expenseType}</td>
                  <td className="px-3 py-2 font-mono font-bold">{expense.amount.toLocaleString('ar-YE')}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        expense.paymentStatus === 'مدفوع'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {expense.paymentStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2">{expense.paidBy}</td>
                  <td className="max-w-[10rem] truncate px-3 py-2 text-slate-500">{expense.notes || '—'}</td>
                  <td className="px-3 py-2">
                    {expense.attachmentPath ? (
                      <button
                        type="button"
                        onClick={() => void openAttachment(expense)}
                        className="inline-flex items-center gap-1 text-[#7A1F2B] hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        عرض
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(expense);
                            setModalOpen(true);
                          }}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-50"
                          title="تعديل"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(expense)}
                          className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"
                          title="حذف"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CaseExpenseModal
        open={modalOpen}
        types={types}
        courtHint={courtHint}
        initial={editing}
        saving={saving}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onTypesChanged={() => void refetchTypes()}
        onSubmit={handleSave}
      />
    </div>
  );
}
