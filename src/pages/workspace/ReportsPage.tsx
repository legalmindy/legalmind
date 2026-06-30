import { useMemo, useState } from 'react';
import { Briefcase, Lock, Plus, Printer, Trash2, TrendingUp, TrendingDown, Wallet, ChevronDown, ChevronUp, FileSpreadsheet, Loader2, Receipt } from 'lucide-react';
import { buildFinancialReport, formatPercent, formatYer } from '../../lib/dashboardAnalytics';
import { exportToCsv, printHtml } from '../../lib/reportsApi';
import { escapeHtml } from '../../lib/sanitize';
import { hasPermission } from '../../lib/permissions';
import { isFirmManagerRole } from '../../lib/roleAccess';
import { useArchivedCases, useExpenses, useExpenseMutations, useReceiptVouchers } from '../../hooks/useSupabaseQueries';
import { ReceiptVoucherModal } from '../../components/ReceiptVoucherModal';
import type { ReportsPageProps } from './types';

const EXPENSE_CATS = [
  'إيجار', 'رواتب', 'قرطاسية ومستلزمات مكتبية', 'اتصالات وإنترنت',
  'رسوم قضائية', 'تسويق وإعلان', 'صيانة وتجهيزات', 'مواصلات', 'أخرى'
] as const;

interface AddExpenseFormState {
  title: string;
  amount: string;
  category: string;
  expense_date: string;
  notes: string;
}

const EMPTY_EXPENSE_FORM: AddExpenseFormState = {
  title: '', amount: '', category: 'أخرى', expense_date: (new Date().toISOString().split('T')[0]) ?? '', notes: ''
};

function formatVoucherDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ar-YE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function ReportsPage({ role, permissions, performance, cases, year: propYear, firmName = 'المكتب' }: ReportsPageProps) {
  const canViewFinancials = hasPermission(permissions, 'financials.view', role);
  const canAddPayments = hasPermission(permissions, 'financials.add_payments', role);
  const canPrintReports = hasPermission(permissions, 'financials.print_receipts', role) || canViewFinancials;
  const canIssueReceipt = canAddPayments || canPrintReports;
  const canDeleteExpenses = isFirmManagerRole(role);
  const accessDenied = !canViewFinancials;
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const currentYear = propYear ?? new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState<AddExpenseFormState>(EMPTY_EXPENSE_FORM);
  const [expenseError, setExpenseError] = useState('');

  const [deleteError, setDeleteError] = useState('');
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);
  const [printError, setPrintError] = useState('');

  const { data: archivedCases = [] } = useArchivedCases(true);
  const { data: expenses = [], isLoading: expLoading } = useExpenses(true);
  const { data: receiptVouchers = [], isLoading: vouchersLoading } = useReceiptVouchers(selectedYear, true);
  const expMutations = useExpenseMutations();

  const handleDeleteExpense = async (id: string) => {
    if (!window.confirm('حذف هذا المصروف؟')) return;
    setDeleteError('');
    try {
      await expMutations.removeExpense.mutateAsync(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل حذف المصروف';
      setDeleteError(msg);
    }
  };

  const report = useMemo(
    () => buildFinancialReport(cases, archivedCases, expenses, selectedYear),
    [cases, archivedCases, expenses, selectedYear]
  );

  const yearOptions = useMemo(() => {
    const years = new Set<number>([currentYear]);
    for (const c of [...cases, ...archivedCases]) {
      const y = parseInt(c.dateStarted?.split('-')[0] ?? '');
      if (y > 2015 && y <= currentYear + 1) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [cases, archivedCases, currentYear]);

  const maxMonthly = useMemo(
    () => Math.max(1, ...report.monthlyData.map((m) => Math.max(m.collected, m.expenses))),
    [report]
  );

  const vouchersTotal = useMemo(
    () => receiptVouchers.reduce((sum, v) => sum + v.amount, 0),
    [receiptVouchers]
  );

  const handleAddExpense = async () => {
    if (!expenseForm.title.trim()) { setExpenseError('أدخل وصف المصروف'); return; }
    const amount = parseFloat(expenseForm.amount);
    if (!amount || amount <= 0) { setExpenseError('أدخل مبلغاً صحيحاً أكبر من صفر'); return; }
    setExpenseError('');
    try {
      await expMutations.addExpense.mutateAsync({
        title: expenseForm.title.trim(),
        amount,
        category: expenseForm.category,
        expense_date: expenseForm.expense_date,
        notes: expenseForm.notes.trim() || undefined
      });
      setExpenseForm(EMPTY_EXPENSE_FORM);
      setShowAddExpense(false);
    } catch (err) {
      setExpenseError(err instanceof Error ? err.message : 'فشل حفظ المصروف.');
    }
  };

  const monthLabels = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  const handleExportExcel = () => {
    setExporting('excel');
    try {
      const summaryRows = [
        { البند: 'إجمالي العقود', القيمة: report.totalContracted },
        { البند: 'المحصّل', القيمة: report.totalCollected },
        { البند: 'المتبقي', القيمة: report.totalPending },
        { البند: 'المصروفات', القيمة: report.totalExpenses },
        { البند: 'صافي الربح', القيمة: report.netProfit },
        { البند: 'نسبة التحصيل', القيمة: `${report.collectionRate}%` }
      ];
      exportToCsv(`تقرير-مالي-${selectedYear}-ملخص.csv`, summaryRows);

      exportToCsv(
        `تقرير-مالي-${selectedYear}-شهري.csv`,
        report.monthlyData.map((m) => ({
          الشهر: monthLabels[m.monthIndex] ?? m.monthIndex + 1,
          المحصل: m.collected,
          المصروفات: m.expenses,
          الربح: m.collected - m.expenses
        }))
      );

      if (report.clientBreakdown.length) {
        exportToCsv(
          `تقرير-مالي-${selectedYear}-عملاء.csv`,
          report.clientBreakdown.map((c) => ({
            العميل: c.clientName,
            'عدد القضايا': c.caseCount,
            المتعاقد: c.totalContract,
            المتبقي: c.totalPending
          }))
        );
      }

      if (expenses.length) {
        exportToCsv(
          `تقرير-مالي-${selectedYear}-مصروفات.csv`,
          expenses
            .filter((e) => e.expense_date.startsWith(String(selectedYear)))
            .map((e) => ({
              الوصف: e.title,
              المبلغ: e.amount,
              التصنيف: e.category,
              التاريخ: e.expense_date,
              ملاحظات: e.notes ?? ''
            }))
        );
      }
    } finally {
      setExporting(null);
    }
  };

  const handleExportPdf = () => {
    setExporting('pdf');
    setPrintError('');
    try {
      const monthlyRows = report.monthlyData
        .map(
          (m) =>
            `<tr><td>${monthLabels[m.monthIndex] ?? m.monthIndex + 1}</td><td>${formatYer(m.collected)}</td><td>${formatYer(m.expenses)}</td><td>${formatYer(m.collected - m.expenses)}</td></tr>`
        )
        .join('');

      const clientRows = report.clientBreakdown
        .map(
          (c) =>
            `<tr><td>${escapeHtml(c.clientName)}</td><td>${c.caseCount}</td><td>${formatYer(c.totalContract)}</td><td>${formatYer(c.totalContract - c.totalPending)}</td><td>${formatYer(c.totalPending)}</td></tr>`
        )
        .join('');

      const html = `
        <div class="header"><h1>التقرير المالي — ${selectedYear}</h1></div>
        <table>
          <tr><th>إجمالي العقود</th><td>${formatYer(report.totalContracted)}</td></tr>
          <tr><th>المحصّل</th><td>${formatYer(report.totalCollected)}</td></tr>
          <tr><th>المتبقي</th><td>${formatYer(report.totalPending)}</td></tr>
          <tr><th>المصروفات</th><td>${formatYer(report.totalExpenses)}</td></tr>
          <tr><th>صافي الربح</th><td>${formatYer(report.netProfit)}</td></tr>
          <tr><th>نسبة التحصيل</th><td>${report.collectionRate}%</td></tr>
        </table>
        <h2>الأداء الشهري</h2>
        <table><thead><tr><th>الشهر</th><th>المحصّل</th><th>المصروفات</th><th>الربح</th></tr></thead><tbody>${monthlyRows}</tbody></table>
        <h2>مديونية العملاء</h2>
        <table><thead><tr><th>العميل</th><th>القضايا</th><th>المتعاقد</th><th>المحصّل</th><th>المتبقي</th></tr></thead><tbody>${clientRows || '<tr><td colspan="5">—</td></tr>'}</tbody></table>
      `;
      printHtml(`التقرير المالي ${selectedYear}`, html);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر فتح نافذة الطباعة';
      setPrintError(msg);
    } finally {
      setExporting(null);
    }
  };

  if (accessDenied) {
    return (
      <div className="max-w-7xl mx-auto px-4 mt-6">
        <div className="bg-white p-12 rounded-2xl border border-red-100 text-center space-y-4">
          <Lock className="w-12 h-12 text-rose-500 mx-auto" />
          <h3 className="font-extrabold text-slate-800 text-base">عذراً، الوصول غير مصرح به</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">التقارير المالية متاحة للمستخدمين الذين لديهم صلاحية «عرض المالية».</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6 text-right" dir="rtl">

      {/* Header */}
      <div className="bg-gradient-to-l from-slate-950 via-indigo-950 to-indigo-900 text-white p-6 rounded-2xl shadow-xl flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-black">التقارير المالية والأداء القانوني</h1>
          <p className="text-xs text-indigo-200 mt-1">تحليل شامل للإيرادات، المصروفات، الأرباح الشهرية ومديونية العملاء.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canIssueReceipt && cases.some((c) => c.status === 'active') ? (
            <button
              type="button"
              onClick={() => setShowReceiptModal(true)}
              className="flex items-center gap-2 rounded-xl border border-emerald-300/40 bg-emerald-500/90 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" />
              سند قبض
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={exporting !== null || !canPrintReports}
            className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/20 disabled:opacity-60"
          >
            {exporting === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            طباعة
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={exporting !== null}
            className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/20 disabled:opacity-60"
          >
            {exporting === 'excel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Excel
          </button>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="bg-white/10 border border-white/20 text-white rounded-xl px-3 py-2 text-sm font-bold outline-none hover:bg-white/20 transition-colors"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y} className="text-slate-900">{y}</option>
            ))}
          </select>
        </div>
      </div>

      {printError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-right">
          <p className="text-xs font-bold text-amber-800">{printError}</p>
          <button type="button" onClick={() => setPrintError('')} className="text-[11px] text-amber-600 underline mt-1">
            إغلاق
          </button>
        </div>
      ) : null}

      <ReceiptVoucherModal
        open={showReceiptModal}
        onClose={() => setShowReceiptModal(false)}
        cases={cases}
        firmName={firmName}
        canAddPayment={canAddPayments}
        canPrintReceipt={canPrintReports}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold">
            <div className="bg-indigo-50 p-1.5 rounded-lg"><Briefcase className="w-3.5 h-3.5 text-indigo-500" /></div>
            إجمالي العقود
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">{formatYer(report.totalContracted)}</div>
          <p className="text-[11px] text-slate-400">مجموع أتعاب جميع القضايا</p>
        </div>
        <div className="bg-white rounded-2xl border border-emerald-100 p-5 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold">
            <div className="bg-emerald-50 p-1.5 rounded-lg"><TrendingUp className="w-3.5 h-3.5 text-emerald-500" /></div>
            المحصّل
          </div>
          <div className="text-2xl font-black text-emerald-700 font-mono">{formatYer(report.totalCollected)}</div>
          <p className="text-[11px] text-slate-400">نسبة التحصيل: <strong className="text-emerald-600">{report.collectionRate}%</strong></p>
        </div>
        <div className="bg-white rounded-2xl border border-amber-100 p-5 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold">
            <div className="bg-amber-50 p-1.5 rounded-lg"><Wallet className="w-3.5 h-3.5 text-amber-500" /></div>
            المتبقي المستحق
          </div>
          <div className="text-2xl font-black text-amber-700 font-mono">{formatYer(report.totalPending)}</div>
          <p className="text-[11px] text-slate-400">موزّع على {report.clientBreakdown.length} عميل</p>
        </div>
        <div className={`bg-white rounded-2xl border p-5 shadow-sm space-y-2 ${report.netProfit >= 0 ? 'border-emerald-100' : 'border-rose-100'}`}>
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold">
            <div className={`p-1.5 rounded-lg ${report.netProfit >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}>
              {report.netProfit >= 0
                ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                : <TrendingDown className="w-3.5 h-3.5 text-rose-500" />}
            </div>
            صافي الربح
          </div>
          <div className={`text-2xl font-black font-mono ${report.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{formatYer(report.netProfit)}</div>
          <p className="text-[11px] text-slate-400">المحصّل − المصروفات ({formatYer(report.totalExpenses)})</p>
        </div>
      </div>

      {/* Receipt vouchers ledger */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-right">
            <h3 className="font-black text-slate-900 text-sm flex items-center gap-2 justify-end">
              <Receipt className="w-4 h-4 text-emerald-600" />
              سندات القبض — {selectedYear}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {receiptVouchers.length > 0
                ? `${receiptVouchers.length} سند • إجمالي ${formatYer(vouchersTotal)}`
                : 'سجل السندات الصادرة مع الموظف المُصدِر والتاريخ'}
            </p>
          </div>
          {canIssueReceipt ? (
            <button
              type="button"
              onClick={() => setShowReceiptModal(true)}
              className="flex items-center justify-center gap-2 self-end sm:self-auto rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 text-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              سند قبض جديد
            </button>
          ) : null}
        </div>

        {vouchersLoading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-slate-400 text-xs">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري تحميل سندات القبض...
          </div>
        ) : receiptVouchers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
            <Receipt className="w-10 h-10 opacity-30" />
            <p className="text-sm font-bold">لا سندات قبض في {selectedYear}</p>
            <p className="text-xs">عند إنشاء سند جديد سيظهر هنا مع اسم الموظف والوقت</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-right">رقم السند</th>
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-right">القضية / الموكل</th>
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-right">الموظف</th>
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-right">التاريخ والوقت</th>
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-right">طريقة الدفع</th>
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-left font-mono">المبلغ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {receiptVouchers.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono font-black text-indigo-800">{v.receiptNumber}</span>
                      {v.reprintCount > 0 ? (
                        <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          إعادة طباعة ×{v.reprintCount}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-800">{v.caseTitle ?? v.caseNumber ?? '—'}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{v.clientName ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700">{v.printedByName ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">{formatVoucherDateTime(v.printedAt)}</td>
                    <td className="px-4 py-3">
                      <span className="bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-lg">{v.paymentMethod ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-left font-mono font-black text-emerald-700">{formatYer(v.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-emerald-50 border-t-2 border-emerald-100">
                  <td colSpan={5} className="px-4 py-3 font-extrabold text-emerald-800 text-sm">إجمالي السندات ({receiptVouchers.length})</td>
                  <td className="px-4 py-3 text-left font-mono font-black text-emerald-800 text-sm">{formatYer(vouchersTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Monthly Chart + Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <div>
            <h3 className="font-black text-slate-900 text-sm">الأرباح الشهرية — {selectedYear}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">المحصّل (أخضر) مقابل المصروفات (أحمر) لكل شهر</p>
          </div>
          <div className="flex items-end justify-between gap-1 h-48 pt-2">
            {report.monthlyData.map((m) => (
              <div key={m.monthIndex} className="flex-1 flex flex-col items-center gap-0.5 group">
                <div className="w-full flex items-end justify-center gap-0.5" style={{ height: '152px' }}>
                  <div
                    title={`محصّل: ${formatYer(m.collected)}`}
                    className="w-[45%] bg-emerald-500 rounded-t-md hover:bg-emerald-400 transition-colors cursor-help"
                    style={{ height: `${(m.collected / maxMonthly) * 100}%`, minHeight: m.collected > 0 ? '4px' : '0' }}
                  />
                  <div
                    title={`مصروفات: ${formatYer(m.expenses)}`}
                    className="w-[45%] bg-rose-400 rounded-t-md hover:bg-rose-300 transition-colors cursor-help"
                    style={{ height: `${(m.expenses / maxMonthly) * 100}%`, minHeight: m.expenses > 0 ? '4px' : '0' }}
                  />
                </div>
                <div className={`text-[9px] font-bold mt-1 ${m.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {m.netProfit !== 0 ? (m.netProfit > 0 ? '+' : '') + Math.round(m.netProfit / 1000) + 'K' : '—'}
                </div>
                <span className="text-[9px] font-bold text-slate-400">{m.month.slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 text-[11px] font-bold text-slate-500 pt-2 border-t border-slate-100">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />محصّل</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-rose-400 inline-block" />مصروفات</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h3 className="font-black text-slate-900 text-sm">مؤشرات الأداء القانوني</h3>
          <div className="space-y-4">
            {[
              { label: 'معدل كسب الأحكام', value: performance.winRate, color: 'bg-indigo-500', desc: 'قضايا صدر لها حكم' },
              { label: 'معدل التسوية الودية', value: performance.settlementRate, color: 'bg-amber-500', desc: 'أُغلقت بتسوية' },
              { label: 'الالتزام بالجلسات', value: performance.sessionCompliance, color: 'bg-emerald-500', desc: 'جلسات مجدولة/قضية' }
            ].map((kpi) => (
              <div key={kpi.label} className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-black text-slate-700">{formatPercent(kpi.value)}</span>
                  <span className="text-xs text-slate-500 font-medium">{kpi.label}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div className={`${kpi.color} h-2 rounded-full transition-all duration-700`} style={{ width: `${Math.min(100, kpi.value)}%` }} />
                </div>
                <p className="text-[10px] text-slate-400">{kpi.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Per-Client Pending Fees */}
      {report.clientBreakdown.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h3 className="font-black text-slate-900 text-sm">المتبقي عند كل عميل</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">مبالغ الأتعاب غير المسدّدة مرتبة تنازلياً</p>
          </div>
          <div className="divide-y divide-slate-50">
            {report.clientBreakdown.map((client) => {
              const pct = client.totalContract > 0 ? Math.round((client.totalPending / client.totalContract) * 100) : 100;
              const isExpanded = expandedClient === client.clientId;
              return (
                <div key={client.clientId}>
                  <button
                    type="button"
                    onClick={() => setExpandedClient(isExpanded ? null : client.clientId)}
                    className="w-full flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors text-right"
                  >
                    <div className="shrink-0">
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex justify-between items-center gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-400">{client.caseCount} {client.caseCount === 1 ? 'قضية' : 'قضايا'}</span>
                          <span className="text-xs font-extrabold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-2 py-0.5 font-mono">{formatYer(client.totalPending)}</span>
                        </div>
                        <span className="font-bold text-slate-800 text-sm truncate">{client.clientName}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className="bg-rose-400 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="bg-slate-50 border-t border-slate-100 px-6 py-3 space-y-2">
                      {client.cases.map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-4 text-xs bg-white rounded-xl px-4 py-2.5 border border-slate-100">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-rose-600 font-black shrink-0">{formatYer(c.remaining)}</span>
                            <span className="text-slate-400 shrink-0">المحصّل: {formatYer(c.paid)}</span>
                          </div>
                          <div className="text-right min-w-0">
                            <p className="font-bold text-slate-700 truncate">{c.title}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{c.caseNo}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Office Expenses */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between gap-4">
          {canAddPayments ? (
            <button
              type="button"
              onClick={() => { setShowAddExpense((v) => !v); setExpenseError(''); setExpenseForm(EMPTY_EXPENSE_FORM); }}
              className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-xl text-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              {showAddExpense ? 'إلغاء' : 'إضافة مصروف'}
            </button>
          ) : (
            <div />
          )}
          <div className="text-right">
            <h3 className="font-black text-slate-900 text-sm">المصروفات المكتبية</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">الإيجار، الرواتب، المستلزمات — إجمالي: <strong className="text-rose-600 font-mono">{formatYer(report.totalExpenses)}</strong></p>
          </div>
        </div>

        {deleteError && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-right">
            <p className="text-xs font-bold text-rose-700">{deleteError}</p>
            <button type="button" onClick={() => setDeleteError('')} className="text-[11px] text-rose-500 underline mt-1">إغلاق</button>
          </div>
        )}

        {showAddExpense && (
          <div className="p-6 border-b border-slate-100 bg-slate-50 space-y-3">
            <h4 className="font-bold text-slate-700 text-xs">بيانات المصروف الجديد</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">وصف المصروف *</label>
                <input
                  type="text"
                  value={expenseForm.title}
                  onChange={(e) => setExpenseForm((s) => ({ ...s, title: e.target.value }))}
                  placeholder="مثال: إيجار المكتب — يونيو"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">المبلغ (ر.ي) *</label>
                <input
                  type="number"
                  min={0}
                  value={expenseForm.amount}
                  onChange={(e) => setExpenseForm((s) => ({ ...s, amount: e.target.value }))}
                  placeholder="0"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">التصنيف</label>
                <select
                  value={expenseForm.category}
                  onChange={(e) => setExpenseForm((s) => ({ ...s, category: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none bg-white focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                >
                  {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">التاريخ</label>
                <input
                  type="date"
                  value={expenseForm.expense_date}
                  onChange={(e) => setExpenseForm((s) => ({ ...s, expense_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">ملاحظات (اختياري)</label>
              <input
                type="text"
                value={expenseForm.notes}
                onChange={(e) => setExpenseForm((s) => ({ ...s, notes: e.target.value }))}
                placeholder="أي تفاصيل إضافية..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              />
            </div>
            {expenseError && <p className="text-[11px] text-rose-600 font-bold">{expenseError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={expMutations.addExpense.isPending}
                onClick={() => void handleAddExpense()}
                className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-xl text-xs"
              >
                {expMutations.addExpense.isPending ? 'جاري الحفظ...' : 'حفظ المصروف'}
              </button>
              <button type="button" onClick={() => setShowAddExpense(false)} className="text-slate-500 hover:bg-slate-100 font-bold px-4 py-2 rounded-xl text-xs">
                إلغاء
              </button>
            </div>
          </div>
        )}

        {expLoading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-slate-400 text-xs">
            <Loader2 className="w-4 h-4 animate-spin" /> جاري تحميل المصروفات...
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
            <Wallet className="w-10 h-10 opacity-30" />
            <p className="text-sm font-bold">لا مصروفات مسجّلة بعد</p>
            <p className="text-xs">أضف مصروفات المكتب لحساب صافي الأرباح بدقة</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-right">التاريخ</th>
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-right">البيان</th>
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-right">التصنيف</th>
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-left font-mono">المبلغ</th>
                  {canDeleteExpenses ? <th className="px-4 py-3 w-10" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50/60 transition-colors group">
                    <td className="px-4 py-3 font-mono text-slate-500">{exp.expense_date}</td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-800">{exp.title}</p>
                      {exp.notes && <p className="text-slate-400 mt-0.5">{exp.notes}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-lg">{exp.category}</span>
                    </td>
                    <td className="px-4 py-3 text-left font-mono font-black text-rose-600">{formatYer(exp.amount)}</td>
                    {canDeleteExpenses ? (
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => void handleDeleteExpense(exp.id)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-rose-50 text-rose-400 hover:text-rose-600 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-rose-50 border-t-2 border-rose-100">
                  <td colSpan={3} className="px-4 py-3 font-extrabold text-rose-700 text-sm">الإجمالي</td>
                  <td className="px-4 py-3 text-left font-mono font-black text-rose-700 text-sm">{formatYer(report.totalExpenses)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
