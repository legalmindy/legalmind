import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Loader2, Printer, Wallet } from 'lucide-react';
import {
  fetchCaseExpenseTypes,
  fetchCaseExpensesReport,
  getCaseExpenseReceiptUrl
} from '../../lib/caseExpenses';
import { exportToCsv, printHtml } from '../../lib/reportsApi';
import { escapeHtml } from '../../lib/sanitize';
import { toArabicQueryError } from '../QueryErrorBanner';
import type { CaseExpenseReportRow, CaseRecord, Client, Lawyer } from '../../types/app';

interface CaseExpensesReportSectionProps {
  cases: CaseRecord[];
  clients: Client[];
  lawyers: Lawyer[];
  canExport: boolean;
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string) {
  const map = new Map<string, { key: string; total: number; count: number }>();
  for (const row of rows) {
    const key = keyFn(row) || '—';
    const amount = (row as { amount: number }).amount;
    const prev = map.get(key) ?? { key, total: 0, count: 0 };
    prev.total += amount;
    prev.count += 1;
    map.set(key, prev);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export function CaseExpensesReportSection({
  cases,
  clients,
  lawyers,
  canExport
}: CaseExpensesReportSectionProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [courtName, setCourtName] = useState('');
  const [lawyerId, setLawyerId] = useState('');
  const [expenseType, setExpenseType] = useState('');
  const [clientId, setClientId] = useState('');
  const [caseId, setCaseId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);
  const [error, setError] = useState('');

  const filters = useMemo(
    () => ({ from, to, courtName, lawyerId, expenseType, clientId, caseId, paymentStatus }),
    [from, to, courtName, lawyerId, expenseType, clientId, caseId, paymentStatus]
  );

  const { data: types = [] } = useQuery({
    queryKey: ['case-expense-types'],
    queryFn: fetchCaseExpenseTypes
  });

  const { data: rows = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['case-expenses-report', filters],
    queryFn: () => fetchCaseExpensesReport(filters)
  });

  const totals = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const paid = rows.filter((r) => r.paymentStatus === 'مدفوع').reduce((s, r) => s + r.amount, 0);
    return { total, paid, unpaid: total - paid, count: rows.length };
  }, [rows]);

  const byType = useMemo(() => groupBy(rows, (r) => r.expenseType), [rows]);
  const byCourt = useMemo(() => groupBy(rows, (r) => r.courtName || '—'), [rows]);
  const byLawyer = useMemo(() => groupBy(rows, (r) => r.lawyerName || 'غير معيّن'), [rows]);
  const byClient = useMemo(() => groupBy(rows, (r) => r.clientName || '—'), [rows]);
  const byCase = useMemo(() => groupBy(rows, (r) => r.caseTitle || '—'), [rows]);

  const exportExcel = () => {
    if (!canExport) return;
    setExporting('excel');
    try {
      exportToCsv(
        'case-expenses-report.csv',
        rows.map((r) => ({
          التاريخ: r.expenseDate,
          القضية: r.caseTitle,
          'رقم القضية': r.courtCaseNumber,
          الموكل: r.clientName,
          المحامي: r.lawyerName ?? '',
          النوع: r.expenseType,
          المبلغ: r.amount,
          'حالة السداد': r.paymentStatus,
          'دفع بواسطة': r.paidBy,
          المحكمة: r.courtName ?? '',
          'رقم الإيصال': r.receiptNumber ?? '',
          ملاحظات: r.notes ?? ''
        }))
      );
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = () => {
    if (!canExport) return;
    setExporting('pdf');
    try {
      const bodyRows = rows
        .map(
          (r) => `<tr>
            <td>${escapeHtml(r.expenseDate)}</td>
            <td>${escapeHtml(r.caseTitle)}</td>
            <td>${escapeHtml(r.clientName)}</td>
            <td>${escapeHtml(r.expenseType)}</td>
            <td>${r.amount.toLocaleString('ar-YE')}</td>
            <td>${escapeHtml(r.paymentStatus)}</td>
            <td>${escapeHtml(r.paidBy)}</td>
            <td>${escapeHtml(r.courtName ?? '')}</td>
          </tr>`
        )
        .join('');
      printHtml(
        'تقرير مصاريف القضايا',
        `<h1>تقرير مصاريف القضايا</h1>
         <p>الإجمالي: ${totals.total.toLocaleString('ar-YE')} ر.ي — المدفوع: ${totals.paid.toLocaleString('ar-YE')} — غير المدفوع: ${totals.unpaid.toLocaleString('ar-YE')} — العدد: ${totals.count}</p>
         <table>
           <thead><tr>
             <th>التاريخ</th><th>القضية</th><th>الموكل</th><th>النوع</th><th>المبلغ</th><th>السداد</th><th>دفع بواسطة</th><th>المحكمة</th>
           </tr></thead>
           <tbody>${bodyRows}</tbody>
         </table>`
      );
    } finally {
      setExporting(null);
    }
  };

  const openAttachment = async (row: CaseExpenseReportRow) => {
    if (!row.attachmentPath) return;
    setError('');
    try {
      const url = await getCaseExpenseReceiptUrl(row.attachmentPath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(toArabicQueryError(err, 'فتح المرفق'));
    }
  };

  const SummaryCards = ({ title, items }: { title: string; items: Array<{ key: string; total: number; count: number }> }) => (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <h4 className="mb-2 text-xs font-black text-slate-800">{title}</h4>
      {items.length === 0 ? (
        <p className="text-[11px] text-slate-400">لا بيانات</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 8).map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-slate-600">{item.key} ({item.count})</span>
              <span className="shrink-0 font-mono font-bold text-slate-900">{item.total.toLocaleString('ar-YE')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <section className="space-y-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-[#7A1F2B]" />
          <div>
            <h2 className="text-base font-black text-slate-900">تقارير مصاريف القضايا</h2>
            <p className="text-[11px] text-slate-500">تصفية حسب الفترة، المحكمة، المحامي، النوع، الموكل، والقضية</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!canExport || exporting === 'excel' || rows.length === 0}
            onClick={exportExcel}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50"
          >
            {exporting === 'excel' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
            Excel
          </button>
          <button
            type="button"
            disabled={!canExport || exporting === 'pdf' || rows.length === 0}
            onClick={exportPdf}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50"
          >
            {exporting === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
            PDF
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" placeholder="من" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" placeholder="إلى" />
        <input value={courtName} onChange={(e) => setCourtName(e.target.value)} placeholder="المحكمة" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
        <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
          <option value="">كل حالات السداد</option>
          <option value="مدفوع">مدفوع</option>
          <option value="غير مدفوع">غير مدفوع</option>
        </select>
        <select value={expenseType} onChange={(e) => setExpenseType(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
          <option value="">كل الأنواع</option>
          {types.map((t) => (
            <option key={t.id} value={t.name}>{t.name}</option>
          ))}
        </select>
        <select value={lawyerId} onChange={(e) => setLawyerId(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
          <option value="">كل المحامين</option>
          {lawyers.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
          <option value="">كل الموكلين</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
          <option value="">كل القضايا</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'الإجمالي', value: totals.total },
          { label: 'المدفوع', value: totals.paid },
          { label: 'غير المدفوع', value: totals.unpaid },
          { label: 'العدد', value: totals.count, raw: true }
        ].map((c) => (
          <div key={c.label} className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] text-slate-500">{c.label}</p>
            <p className="text-base font-black text-slate-900">
              {c.raw ? c.value : Number(c.value).toLocaleString('ar-YE')}
              {!c.raw ? ' ر.ي' : ''}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <SummaryCards title="حسب نوع المصروف" items={byType} />
        <SummaryCards title="حسب المحكمة" items={byCourt} />
        <SummaryCards title="حسب المحامي" items={byLawyer} />
        <SummaryCards title="حسب الموكل" items={byClient} />
        <SummaryCards title="حسب القضية" items={byCase} />
        <SummaryCards
          title="حسب الفترة (ملخص)"
          items={[{ key: from || to ? `${from || '…'} → ${to || '…'}` : 'كل الفترات', total: totals.total, count: totals.count }]}
        />
      </div>

      {error ? <p className="text-xs font-bold text-rose-600">{error}</p> : null}

      {isLoading || isFetching ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[#7A1F2B]" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="min-w-full text-right text-xs">
            <thead className="bg-slate-50 text-[10px] text-slate-500">
              <tr>
                <th className="px-3 py-2">التاريخ</th>
                <th className="px-3 py-2">القضية</th>
                <th className="px-3 py-2">الموكل</th>
                <th className="px-3 py-2">النوع</th>
                <th className="px-3 py-2">المبلغ</th>
                <th className="px-3 py-2">السداد</th>
                <th className="px-3 py-2">دفع بواسطة</th>
                <th className="px-3 py-2">مرفق</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-400">لا نتائج للفلاتر الحالية.</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.expenseId} className="border-t border-slate-50">
                    <td className="px-3 py-2 whitespace-nowrap">{r.expenseDate}</td>
                    <td className="px-3 py-2 font-bold">{r.caseTitle}</td>
                    <td className="px-3 py-2">{r.clientName}</td>
                    <td className="px-3 py-2">{r.expenseType}</td>
                    <td className="px-3 py-2 font-mono font-bold">{r.amount.toLocaleString('ar-YE')}</td>
                    <td className="px-3 py-2">{r.paymentStatus}</td>
                    <td className="px-3 py-2">{r.paidBy}</td>
                    <td className="px-3 py-2">
                      {r.attachmentPath ? (
                        <button type="button" onClick={() => void openAttachment(r)} className="text-[#7A1F2B] hover:underline">
                          عرض
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <button type="button" onClick={() => void refetch()} className="text-xs font-bold text-[#7A1F2B] hover:underline">
        تحديث التقرير
      </button>
    </section>
  );
}
