import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Banknote,
  Calendar,
  Download,
  FileText,
  History,
  Loader2,
  Plus,
  Printer,
  Receipt,
  Scale,
  StickyNote,
  User
} from 'lucide-react';
import type {
  CaseDetailTab,
  DocumentItem,
  SessionItem,
  User as AppUser
} from '../types/app';
import { fetchCaseById } from '../lib/api';
import {
  addCasePayment,
  fetchCaseFinancialSummary,
  fetchCasePayments,
  getPaymentReceiptUrl,
  updateCasePaymentReceipt,
  uploadPaymentReceipt
} from '../lib/caseFinancials';
import { appendCaseNote, fetchCaseTimeline } from '../lib/caseTimeline';
import { createReceiptVoucher, fetchCaseReceipts, reprintReceiptVoucher } from '../lib/receiptVoucher';
import { hasPermission, fetchMyPermissions } from '../lib/permissions';
import { isFirmManagerRole } from '../lib/roleAccess';
import { consumeCaseDetailTab } from '../lib/appRoutes';
import { printReceiptElement, ReceiptVoucherPrint } from '../components/case/ReceiptVoucherPrint';
import { CaseExportToolbar } from '../components/case/CaseExportToolbar';
import { RichTextContent } from '../components/ui/RichTextEditor';
import { toArabicQueryError } from '../components/QueryErrorBanner';
import {
  downloadCaseDocument,
  downloadCaseFullArchive,
  fetchCaseExportBundle,
  printCaseFullReport
} from '../lib/caseExport';

const TABS: Array<{ id: CaseDetailTab; label: string; icon: typeof Scale }> = [
  { id: 'overview', label: 'نظرة عامة', icon: Scale },
  { id: 'sessions', label: 'الجلسات', icon: Calendar },
  { id: 'documents', label: 'المستندات', icon: FileText },
  { id: 'financials', label: 'المالية', icon: Banknote },
  { id: 'payments', label: 'الدفعات', icon: Receipt },
  { id: 'receipts', label: 'السندات', icon: Printer },
  { id: 'timeline', label: 'السجل', icon: History },
  { id: 'notes', label: 'ملاحظات', icon: StickyNote },
  { id: 'lawyers', label: 'المحامون', icon: User }
];

interface CaseDetailPageProps {
  caseId: string;
  user: AppUser;
  firmName: string;
  sessions: SessionItem[];
  documents: DocumentItem[];
  onBack: () => void;
  onEditSession: (session: SessionItem) => void;
  onCreateSession: (caseId: string) => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function CaseDetailPage({
  caseId,
  user,
  firmName,
  sessions,
  documents,
  onBack,
  onEditSession,
  onCreateSession,
  onNotify
}: CaseDetailPageProps) {
  const [tab, setTab] = useState<CaseDetailTab>(() => consumeCaseDetailTab() ?? 'overview');
  const [noteText, setNoteText] = useState('');
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'نقداً',
    notes: ''
  });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [activeVoucherId, setActiveVoucherId] = useState<string | null>(null);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [exportingCase, setExportingCase] = useState(false);
  const [printingCase, setPrintingCase] = useState(false);
  const queryClient = useQueryClient();

  const { data: caseRecord, isLoading: caseLoading, isError: caseError, error: caseQueryError } = useQuery({
    queryKey: ['case-detail', caseId],
    queryFn: () => fetchCaseById(caseId)
  });

  const { data: permissions } = useQuery({
    queryKey: ['my-permissions'],
    queryFn: fetchMyPermissions
  });

  const needsFinancialData = tab === 'overview' || tab === 'financials' || tab === 'payments' || tab === 'receipts';

  const { data: summary, refetch: refetchSummary } = useQuery({
    queryKey: ['case-financial-summary', caseId],
    queryFn: () => fetchCaseFinancialSummary(caseId),
    enabled: needsFinancialData
  });

  const { data: payments = [], refetch: refetchPayments } = useQuery({
    queryKey: ['case-payments', caseId],
    queryFn: () => fetchCasePayments(caseId),
    enabled: tab === 'payments' || tab === 'financials'
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ['case-timeline', caseId],
    queryFn: () => fetchCaseTimeline(caseId),
    enabled: tab === 'timeline' || tab === 'notes'
  });

  const { data: receipts = [], refetch: refetchReceipts } = useQuery({
    queryKey: ['case-receipts', caseId],
    queryFn: () => fetchCaseReceipts(caseId),
    enabled: tab === 'receipts'
  });

  const caseSessions = useMemo(() => sessions.filter((s) => s.caseId === caseId), [sessions, caseId]);
  const caseDocuments = useMemo(() => documents.filter((d) => d.caseId === caseId), [documents, caseId]);

  const canAddPayment = hasPermission(permissions, 'financials.add_payments', user.role);
  const canPrintReceipt = hasPermission(permissions, 'financials.print_receipts', user.role);
  const canViewFinancials = hasPermission(permissions, 'financials.view', user.role);
  const canViewSessions = hasPermission(permissions, 'sessions.view', user.role);
  const canEditSessions = hasPermission(permissions, 'sessions.edit', user.role);
  const canViewDocuments = hasPermission(permissions, 'documents.download', user.role);
  const isManagerView = isFirmManagerRole(user.role);
  const isFinancialFocus =
    (canViewFinancials || canAddPayment || canPrintReceipt) &&
    !hasPermission(permissions, 'cases.edit', user.role);

  const visibleTabs = useMemo(() => {
    if (isFinancialFocus) {
      return TABS.filter((item) => ['overview', 'financials', 'payments', 'receipts'].includes(item.id));
    }
    return TABS.filter((item) => {
      if (item.id === 'sessions') return canViewSessions;
      if (item.id === 'documents') return canViewDocuments;
      if (['financials', 'payments', 'receipts'].includes(item.id)) {
        return canViewFinancials || canAddPayment || canPrintReceipt;
      }
      return true;
    });
  }, [canAddPayment, canPrintReceipt, canViewDocuments, canViewFinancials, canViewSessions, isFinancialFocus]);

  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!visibleTabs.some((item) => item.id === tab)) {
      setTab(isFinancialFocus ? 'payments' : visibleTabs[0]!.id);
    }
  }, [isFinancialFocus, tab, visibleTabs]);

  const refreshFinancials = useCallback(() => {
    void refetchSummary();
    void refetchPayments();
    void refetchReceipts();
    void queryClient.invalidateQueries({ queryKey: ['case-detail', caseId] });
    void queryClient.invalidateQueries({ queryKey: ['case-timeline', caseId] });
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
  }, [caseId, queryClient, refetchPayments, refetchReceipts, refetchSummary]);

  const handleAddPayment = async () => {
    const amount = parseFloat(paymentForm.amount);
    if (!amount || amount <= 0) {
      onNotify('أدخل مبلغاً صحيحاً.', 'error');
      return;
    }
    try {
      const { paymentId } = await addCasePayment({
        caseId,
        amount,
        paymentDate: paymentForm.paymentDate,
        paymentMethod: paymentForm.paymentMethod,
        notes: paymentForm.notes || undefined
      });
      if (receiptFile) {
        const uploaded = await uploadPaymentReceipt(caseId, paymentId, receiptFile);
        await updateCasePaymentReceipt(paymentId, uploaded.path, uploaded.fileName);
      }
      setPaymentForm({ amount: '', paymentDate: new Date().toISOString().slice(0, 10), paymentMethod: 'نقداً', notes: '' });
      setReceiptFile(null);
      refreshFinancials();
      onNotify('تم تسجيل الدفعة بنجاح.', 'success');
    } catch (err) {
      onNotify(toArabicQueryError(err, 'تسجيل الدفعة'), 'error');
    }
  };

  const handleCreateReceipt = async (paymentId: string) => {
    try {
      const voucher = await createReceiptVoucher(paymentId);
      setActiveVoucherId(voucher.id);
      refreshFinancials();
      onNotify(`تم إنشاء سند ${voucher.receiptNumber}`, 'success');
    } catch (err) {
      onNotify(toArabicQueryError(err, 'إنشاء السند'), 'error');
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    try {
      await appendCaseNote(caseId, noteText.trim());
      setNoteText('');
      void queryClient.invalidateQueries({ queryKey: ['case-timeline', caseId] });
      onNotify('تمت إضافة الملاحظة.', 'success');
    } catch (err) {
      onNotify(toArabicQueryError(err, 'إضافة الملاحظة'), 'error');
    }
  };

  const handleDownloadDocument = async (doc: DocumentItem) => {
    setDownloadingDocId(doc.id);
    try {
      await downloadCaseDocument(doc);
      onNotify(`تم تنزيل "${doc.title}".`, 'success');
    } catch (err) {
      onNotify(toArabicQueryError(err, 'تنزيل المستند'), 'error');
    } finally {
      setDownloadingDocId(null);
    }
  };

  const handleDownloadFullCase = async () => {
    if (!caseRecord) return;
    setExportingCase(true);
    try {
      const bundle = await fetchCaseExportBundle(caseId, caseRecord, firmName, sessions, documents);
      const { documentsIncluded, documentsTotal } = await downloadCaseFullArchive(bundle);
      const docsMsg =
        documentsTotal > 0
          ? ` (${documentsIncluded}/${documentsTotal} مستند)`
          : '';
      onNotify(`تم تنزيل ملف القضية الكامل${docsMsg}.`, 'success');
    } catch (err) {
      onNotify(toArabicQueryError(err, 'تصدير بيانات القضية'), 'error');
    } finally {
      setExportingCase(false);
    }
  };

  const handlePrintFullCase = async () => {
    if (!caseRecord) return;
    setPrintingCase(true);
    try {
      const bundle = await fetchCaseExportBundle(caseId, caseRecord, firmName, sessions, documents);
      printCaseFullReport(bundle);
    } catch (err) {
      onNotify(toArabicQueryError(err, 'طباعة بيانات القضية'), 'error');
    } finally {
      setPrintingCase(false);
    }
  };

  if (caseLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" dir="rtl">
        <Loader2 className="h-8 w-8 animate-spin text-[#7A1F2B]" />
      </div>
    );
  }

  if (caseError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center" dir="rtl">
        <p className="text-sm font-bold text-rose-600">{toArabicQueryError(caseQueryError, 'تحميل القضية')}</p>
        <button type="button" onClick={onBack} className="mt-4 text-sm font-bold text-[#7A1F2B]">
          العودة للقضايا
        </button>
      </div>
    );
  }

  if (!caseRecord) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center" dir="rtl">
        <p className="text-sm text-slate-500">القضية غير موجودة أو لا يمكن الوصول إليها.</p>
        <button type="button" onClick={onBack} className="mt-4 text-sm font-bold text-[#7A1F2B]">
          العودة للقضايا
        </button>
      </div>
    );
  }

  const activeVoucher = receipts.find((r) => r.id === activeVoucherId) ?? receipts[0];

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-3 py-4 sm:px-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-bold text-[#7A1F2B]">
          <ArrowRight className="h-4 w-4" />
          العودة للقضايا
        </button>
        <div className="text-left">
          <p className="text-[10px] font-bold text-slate-400">بيانات القضية</p>
          <h1 className="text-xl font-black text-slate-900">{caseRecord.title}</h1>
          <p className="text-xs text-slate-500">{caseRecord.court_case_number} • {caseRecord.clientName}</p>
        </div>
      </div>

      {/* Financial summary strip */}
      {summary ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'قيمة العقد', value: summary.contractTotal, color: 'text-slate-900' },
            { label: 'المدفوع', value: summary.totalPaid, color: 'text-emerald-700' },
            { label: 'المتبقي', value: summary.remaining, color: 'text-rose-700' },
            { label: 'نسبة السداد', value: `${summary.paymentPercentage}%`, color: 'text-indigo-700', raw: true }
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
              <p className="text-[10px] text-slate-500">{item.label}</p>
              <p className={`text-lg font-black ${item.color}`}>
                {item.raw ? item.value : Number(item.value).toLocaleString()} {!item.raw ? 'ر.ي' : ''}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-100 bg-white p-1 scrollbar-none">
        {visibleTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-2 text-[11px] font-bold transition-colors sm:px-3 sm:text-xs ${
              tab === id ? 'bg-[#7A1F2B] text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-6">
        {tab === 'overview' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Section title="بيانات القضية">
              <InfoRow label="المحكمة" value={caseRecord.court} />
              <InfoRow label="النوع" value={caseRecord.case_type} />
              <InfoRow label="المرحلة" value={caseRecord.case_stage} />
              <InfoRow label="الحالة" value={caseRecord.status} />
              <InfoRow label="تاريخ العقد" value={caseRecord.contract_date ?? '—'} />
            </Section>
            <Section title="الموكل">
              <InfoRow label="الاسم" value={caseRecord.clientName} />
              <InfoRow label="المحامي" value={caseRecord.lawyerName ?? '—'} />
              <InfoRow label="تاريخ الفتح" value={caseRecord.dateStarted} />
            </Section>
            {caseRecord.description ? (
              <div className="sm:col-span-2">
                <Section title="الوصف">
                  <p className="text-sm leading-relaxed text-slate-600">{caseRecord.description}</p>
                </Section>
              </div>
            ) : null}
          </div>
        )}

        {tab === 'sessions' && (
          <div className="space-y-3">
            {canEditSessions ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onCreateSession(caseId)}
                  className="rounded-lg bg-[#7A1F2B] px-3 py-1.5 text-xs font-bold text-white"
                >
                  + جلسة
                </button>
              </div>
            ) : null}
            {caseSessions.length === 0 ? (
              <EmptyState text="لا توجد جلسات." />
            ) : (
              caseSessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onEditSession(s)}
                  className="w-full rounded-xl border border-slate-100 p-3 text-right hover:bg-slate-50"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-bold text-slate-800">{s.date} — {s.time}</span>
                    <span className="text-xs text-slate-500">{s.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{s.court}{s.judgeName ? ` • ${s.judgeName}` : ''}</p>
                  {s.sessionOutcome ? (
                    <RichTextContent html={s.sessionOutcome} className="mt-2 line-clamp-3 text-[11px]" />
                  ) : null}
                </button>
              ))
            )}
          </div>
        )}

        {tab === 'documents' && (
          <div className="space-y-4">
            {isManagerView ? (
              <CaseExportToolbar
                exporting={exportingCase}
                printing={printingCase}
                onDownload={() => void handleDownloadFullCase()}
                onPrint={() => void handlePrintFullCase()}
              />
            ) : null}

            {caseDocuments.length === 0 ? (
              <EmptyState text="لا توجد مستندات." />
            ) : (
              caseDocuments.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-800">{d.title}</p>
                    <p className="text-xs text-slate-500">{d.category} • {d.dateUploaded}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={downloadingDocId === d.id}
                      onClick={() => void handleDownloadDocument(d)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#7A1F2B] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#6a1a25] disabled:opacity-50"
                    >
                      {downloadingDocId === d.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      تنزيل
                    </button>
                    <FileText className="h-4 w-4 text-slate-400" />
                  </div>
                </div>
              ))
            )}

            {isManagerView ? (
              <CaseExportToolbar
                variant="bottom"
                exporting={exportingCase}
                printing={printingCase}
                onDownload={() => void handleDownloadFullCase()}
                onPrint={() => void handlePrintFullCase()}
              />
            ) : null}
          </div>
        )}

        {tab === 'financials' && summary && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoRow label="عملة العقد" value={summary.currency} />
              <InfoRow label="تاريخ العقد" value={summary.contractDate ?? '—'} />
              <InfoRow label="آخر دفعة" value={summary.lastPaymentDate ?? '—'} />
              <InfoRow label="مبلغ آخر دفعة" value={summary.lastPaymentAmount?.toLocaleString() ?? '—'} />
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(summary.paymentPercentage, 100)}%` }}
              />
            </div>
          </div>
        )}

        {tab === 'payments' && (
          <div className="space-y-4">
            {canPrintReceipt ? (
              <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                بعد تسجيل الدفعة، اضغط «سند قبض» بجانبها لإنشاء وطباعة السند الرسمي.
              </p>
            ) : null}
            {canAddPayment ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 space-y-3">
                <p className="text-sm font-black text-slate-800">إضافة دفعة</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input type="number" placeholder="المبلغ" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  <input type="date" value={paymentForm.paymentDate} onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  <select value={paymentForm.paymentMethod} onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    {['نقداً', 'تحويل بنكي', 'شيك', 'محفظة إلكترونية', 'أخرى'].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <input type="file" accept="image/*,application/pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} className="text-xs" />
                  <textarea placeholder="ملاحظات" value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={2} />
                </div>
                <button type="button" onClick={() => void handleAddPayment()} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white">
                  <Plus className="inline h-3.5 w-3.5 ml-1" />
                  حفظ الدفعة
                </button>
              </div>
            ) : null}

            {payments.length === 0 ? (
              <EmptyState text="لا توجد دفعات." />
            ) : (
              payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="font-black text-emerald-700">{p.amount.toLocaleString()} ر.ي</p>
                    <p className="text-xs text-slate-500">{p.paymentDate} • {p.paymentMethod}</p>
                    {p.notes ? <p className="text-[11px] text-slate-600">{p.notes}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    {p.receiptStoragePath ? (
                      <button type="button" onClick={() => void getPaymentReceiptUrl(p.receiptStoragePath!).then((url) => window.open(url, '_blank'))} className="text-xs font-bold text-indigo-700 underline">
                        إيصال
                      </button>
                    ) : null}
                    {canPrintReceipt ? (
                      <button type="button" onClick={() => void handleCreateReceipt(p.id)} className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold">
                        سند قبض
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'receipts' && (
          <div className="space-y-4">
            {receipts.length === 0 ? (
              <EmptyState text="لا توجد سندات — أنشئ سنداً من تبويب الدفعات." />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {receipts.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setActiveVoucherId(r.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold ${activeVoucherId === r.id ? 'bg-[#7A1F2B] text-white' : 'border border-slate-200'}`}
                    >
                      {r.receiptNumber}
                    </button>
                  ))}
                </div>
                {activeVoucher ? (
                  <ReceiptVoucherPrint
                    voucher={activeVoucher}
                    firmName={firmName}
                    onPrint={() => {
                      printReceiptElement();
                      void reprintReceiptVoucher(activeVoucher.id);
                    }}
                  />
                ) : null}
              </>
            )}
          </div>
        )}

        {tab === 'timeline' && (
          <div className="space-y-3">
            {timeline.length === 0 ? (
              <EmptyState text="لا توجد أحداث." />
            ) : (
              timeline.map((ev) => (
                <div key={ev.id} className="relative border-r-2 border-[#7A1F2B]/30 pr-4">
                  <div className="absolute -right-[5px] top-1 h-2 w-2 rounded-full bg-[#7A1F2B]" />
                  <p className="text-[10px] text-slate-400">{new Date(ev.createdAt).toLocaleString('ar-YE')}</p>
                  <p className="font-bold text-slate-800">{ev.title}</p>
                  {ev.details ? <p className="text-xs text-slate-600">{ev.details}</p> : null}
                  {ev.actorName ? <p className="text-[10px] text-slate-400">بواسطة: {ev.actorName}</p> : null}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'notes' && (
          <div className="space-y-3">
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={4} placeholder="أضف ملاحظة على القضية..." className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <button type="button" onClick={() => void handleAddNote()} className="rounded-lg bg-[#7A1F2B] px-4 py-2 text-xs font-bold text-white">
              حفظ الملاحظة
            </button>
          </div>
        )}

        {tab === 'lawyers' && (
          <Section title="المحامي المعيّن">
            <InfoRow label="الاسم" value={caseRecord.lawyerName ?? 'غير معيّن'} />
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 p-4">
      <h3 className="mb-3 text-sm font-black text-slate-800">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-bold text-slate-800 text-left">{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-slate-400">{text}</p>;
}
