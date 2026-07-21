import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Printer, X } from 'lucide-react';
import type { CaseRecord, ReceiptVoucher } from '../types/app';
import { addCasePayment, fetchCaseFinancialSummary, fetchCasePayments } from '../lib/caseFinancials';
import { createReceiptVoucher, fetchCaseReceipts } from '../lib/receiptVoucher';
import { printReceiptVoucher, ReceiptVoucherPrint } from './case/ReceiptVoucherPrint';
import { toArabicQueryError } from './QueryErrorBanner';

interface ReceiptVoucherModalProps {
  open: boolean;
  onClose: () => void;
  cases: CaseRecord[];
  firmName: string;
  canAddPayment: boolean;
  canPrintReceipt: boolean;
  initialCaseId?: string;
}

const PAYMENT_METHODS = ['نقداً', 'تحويل بنكي', 'شيك', 'محفظة إلكترونية', 'أخرى'] as const;

export function ReceiptVoucherModal({
  open,
  onClose,
  cases,
  firmName,
  canAddPayment,
  canPrintReceipt,
  initialCaseId
}: ReceiptVoucherModalProps) {
  const queryClient = useQueryClient();
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [caseSearch, setCaseSearch] = useState('');
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [selectedPaymentId, setSelectedPaymentId] = useState('');
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'نقداً',
    notes: ''
  });
  const [voucher, setVoucher] = useState<ReceiptVoucher | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const eligibleCases = useMemo(
    () => cases.filter((c) => c.status === 'active'),
    [cases]
  );

  const filteredCases = useMemo(() => {
    const q = caseSearch.trim().toLowerCase();
    if (!q) return eligibleCases;
    return eligibleCases.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.clientName.toLowerCase().includes(q) ||
        c.caseNo.toLowerCase().includes(q)
    );
  }, [caseSearch, eligibleCases]);

  const selectedCase = useMemo(
    () => eligibleCases.find((c) => c.id === selectedCaseId) ?? null,
    [eligibleCases, selectedCaseId]
  );

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['receipt-modal-summary', selectedCaseId],
    queryFn: () => fetchCaseFinancialSummary(selectedCaseId),
    enabled: open && Boolean(selectedCaseId)
  });

  const { data: payments = [], isLoading: paymentsLoading } = useQuery({
    queryKey: ['receipt-modal-payments', selectedCaseId],
    queryFn: () => fetchCasePayments(selectedCaseId),
    enabled: open && Boolean(selectedCaseId)
  });

  const { data: receipts = [], isLoading: receiptsLoading } = useQuery({
    queryKey: ['receipt-modal-receipts', selectedCaseId],
    queryFn: () => fetchCaseReceipts(selectedCaseId),
    enabled: open && Boolean(selectedCaseId)
  });

  const paymentsWithoutVoucher = useMemo(() => {
    const issued = new Set(receipts.map((r) => r.casePaymentId));
    return payments.filter((p) => !issued.has(p.id));
  }, [payments, receipts]);

  const financialLoading = summaryLoading || paymentsLoading || receiptsLoading;

  useEffect(() => {
    if (!open) return;
    setVoucher(null);
    setError('');
    setCaseSearch('');
    setSelectedCaseId(initialCaseId ?? eligibleCases[0]?.id ?? '');
    setMode('new');
    setSelectedPaymentId('');
    setPaymentForm({
      amount: '',
      paymentDate: new Date().toISOString().slice(0, 10),
      paymentMethod: 'نقداً',
      notes: ''
    });
  }, [open, initialCaseId, eligibleCases]);

  useEffect(() => {
    if (!open || mode !== 'existing') return;
    setSelectedPaymentId(paymentsWithoutVoucher[0]?.id ?? '');
  }, [open, mode, paymentsWithoutVoucher]);

  useEffect(() => {
    if (!open || !selectedCaseId) return;
    if (canAddPayment) {
      setMode('new');
      return;
    }
    if (paymentsWithoutVoucher.length > 0) {
      setMode('existing');
    }
  }, [open, selectedCaseId, canAddPayment, paymentsWithoutVoucher.length]);

  const invalidateFinancialQueries = async (caseId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['cases'] }),
      queryClient.invalidateQueries({ queryKey: ['case-detail', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['case-payments', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['case-receipts', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['case-financial-summary', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['receipt-modal-payments', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['receipt-modal-receipts', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['receipt-modal-summary', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['receipt-vouchers'] })
    ]);
  };

  const handleCreateVoucher = async (paymentId: string) => {
    if (!canPrintReceipt) {
      setError('ليس لديك صلاحية إنشاء سندات القبض.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const created = await createReceiptVoucher(paymentId);
      setVoucher(created);
      await invalidateFinancialQueries(selectedCaseId);
    } catch (err) {
      setError(toArabicQueryError(err, 'إنشاء سند القبض'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitNewPayment = async () => {
    if (!selectedCaseId) {
      setError('اختر القضية أولاً.');
      return;
    }
    if (!canAddPayment) {
      setError('ليس لديك صلاحية تسجيل الدفعات.');
      return;
    }
    const amount = parseFloat(paymentForm.amount);
    if (!amount || amount <= 0) {
      setError('أدخل مبلغاً صحيحاً أكبر من صفر.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const { paymentId } = await addCasePayment({
        caseId: selectedCaseId,
        amount,
        paymentDate: paymentForm.paymentDate,
        paymentMethod: paymentForm.paymentMethod,
        notes: paymentForm.notes.trim() || undefined
      });
      await invalidateFinancialQueries(selectedCaseId);
      await handleCreateVoucher(paymentId);
    } catch (err) {
      setError(toArabicQueryError(err, 'تسجيل الدفعة'));
      setSubmitting(false);
    }
  };

  const handleSubmitExistingPayment = async () => {
    if (!selectedPaymentId) {
      setError('اختر دفعة مسجّلة بدون سند.');
      return;
    }
    await handleCreateVoucher(selectedPaymentId);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto text-right" dir="rtl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-lg font-black text-slate-900">إنشاء سند قبض</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">اختر القضية، سجّل الدفعة، وأنشئ السند دون فتح ملف القضية.</p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {voucher ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
                تم إنشاء سند {voucher.receiptNumber} بنجاح.
              </div>
              <ReceiptVoucherPrint
                voucher={voucher}
                firmName={firmName}
                onPrint={() => printReceiptVoucher(voucher, firmName)}
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setVoucher(null);
                    setPaymentForm((s) => ({ ...s, amount: '', notes: '' }));
                  }}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  سند جديد
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
                >
                  إغلاق
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label htmlFor="receipt-case-search" className="text-xs font-bold text-slate-700 block">
                  اختيار القضية *
                </label>
                <input
                  id="receipt-case-search"
                  type="text"
                  value={caseSearch}
                  onChange={(e) => setCaseSearch(e.target.value)}
                  placeholder="ابحث بالعنوان، العميل، أو رقم القضية..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
                <select
                  value={selectedCaseId}
                  onChange={(e) => {
                    setSelectedCaseId(e.target.value);
                    setError('');
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs outline-none bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                >
                  {filteredCases.length === 0 ? (
                    <option value="">لا توجد قضايا نشطة</option>
                  ) : (
                    filteredCases.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} — {c.clientName} (متبقي {(c.remaining_amount ?? 0).toLocaleString('ar-YE')} ر.ي)
                      </option>
                    ))
                  )}
                </select>
              </div>

              {selectedCase && (
                <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs">
                  <div>
                    <p className="text-slate-500">إجمالي العقد</p>
                    <p className="font-black text-slate-900 font-mono">
                      {financialLoading ? '...' : (summary?.contractTotal ?? selectedCase.total_amount ?? 0).toLocaleString('ar-YE')} ر.ي
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">المحصّل</p>
                    <p className="font-black text-emerald-700 font-mono">
                      {financialLoading ? '...' : (summary?.totalPaid ?? selectedCase.paid_amount ?? 0).toLocaleString('ar-YE')} ر.ي
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">المتبقي</p>
                    <p className="font-black text-amber-700 font-mono">
                      {financialLoading ? '...' : (summary?.remaining ?? selectedCase.remaining_amount ?? 0).toLocaleString('ar-YE')} ر.ي
                    </p>
                  </div>
                </div>
              )}

              {canAddPayment && paymentsWithoutVoucher.length > 0 ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('new')}
                    className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${mode === 'new' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    دفعة جديدة
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('existing')}
                    className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${mode === 'existing' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    دفعة مسجّلة ({paymentsWithoutVoucher.length})
                  </button>
                </div>
              ) : null}

              {mode === 'new' && canAddPayment ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-4 space-y-3">
                  <p className="text-sm font-black text-slate-800">بيانات الدفعة</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-[11px] font-bold text-slate-500 block mb-1">المبلغ (ر.ي) *</label>
                      <input
                        type="number"
                        min={0}
                        value={paymentForm.amount}
                        onChange={(e) => setPaymentForm((s) => ({ ...s, amount: e.target.value }))}
                        placeholder="0"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-500 block mb-1">التاريخ</label>
                      <input
                        type="date"
                        value={paymentForm.paymentDate}
                        onChange={(e) => setPaymentForm((s) => ({ ...s, paymentDate: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[11px] font-bold text-slate-500 block mb-1">طريقة الدفع</label>
                      <select
                        value={paymentForm.paymentMethod}
                        onChange={(e) => setPaymentForm((s) => ({ ...s, paymentMethod: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none bg-white focus:border-emerald-500"
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[11px] font-bold text-slate-500 block mb-1">ملاحظات (اختياري)</label>
                      <textarea
                        value={paymentForm.notes}
                        onChange={(e) => setPaymentForm((s) => ({ ...s, notes: e.target.value }))}
                        rows={2}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500 resize-none"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={submitting || !canPrintReceipt || !selectedCaseId}
                    onClick={() => void handleSubmitNewPayment()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    تسجيل الدفعة وإنشاء سند قبض
                  </button>
                </div>
              ) : null}

              {mode === 'existing' && paymentsWithoutVoucher.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm font-black text-slate-800">دفعات بدون سند</p>
                  {paymentsWithoutVoucher.map((p) => (
                    <label
                      key={p.id}
                      className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors ${selectedPaymentId === p.id ? 'border-emerald-300 bg-emerald-50' : 'border-slate-100 hover:border-slate-200'}`}
                    >
                      <input
                        type="radio"
                        name="existing-payment"
                        checked={selectedPaymentId === p.id}
                        onChange={() => setSelectedPaymentId(p.id)}
                        className="shrink-0"
                      />
                      <div className="min-w-0 flex-1 text-right">
                        <p className="font-black text-emerald-700">{p.amount.toLocaleString('ar-YE')} ر.ي</p>
                        <p className="text-[11px] text-slate-500">{p.paymentDate} • {p.paymentMethod}</p>
                        {p.notes ? <p className="text-[11px] text-slate-600 truncate">{p.notes}</p> : null}
                      </div>
                    </label>
                  ))}
                  <button
                    type="button"
                    disabled={submitting || !canPrintReceipt || !selectedPaymentId}
                    onClick={() => void handleSubmitExistingPayment()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                    إنشاء سند قبض للدفعة المحددة
                  </button>
                </div>
              ) : null}

              {!canAddPayment && paymentsWithoutVoucher.length === 0 && selectedCaseId && !financialLoading ? (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  لا توجد دفعات مسجّلة بدون سند لهذه القضية. اطلب من مدير المكتب تسجيل دفعة أولاً.
                </div>
              ) : null}

              {error ? (
                <p className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="flex justify-end">
                <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  إلغاء
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
