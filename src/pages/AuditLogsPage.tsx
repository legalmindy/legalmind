import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Loader2, Printer, Search, Shield, User, Download } from 'lucide-react';
import { fetchFirmActivityLogs, exportToCsv, printHtml } from '../lib/reportsApi';
import { escapeHtml } from '../lib/sanitize';
import {
  ACTIVITY_FILTER_OPTIONS,
  formatActivityDateTime,
  formatActivityOperation,
  formatActivityTable
} from '../lib/auditLogLabels';
import { toArabicQueryError } from '../components/QueryErrorBanner';

export function AuditLogsPage({ embedded = false }: { embedded?: boolean }) {
  const [tableFilter, setTableFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const { data: logs = [], isLoading, isError, error } = useQuery({
    queryKey: ['firm-activity-logs', tableFilter, dateFrom, dateTo, search],
    queryFn: () => fetchFirmActivityLogs(500, tableFilter || undefined, dateFrom || undefined, dateTo || undefined, search || undefined)
  });

  const stats = useMemo(() => {
    const byTable: Record<string, number> = {};
    for (const log of logs) {
      byTable[log.tableName] = (byTable[log.tableName] ?? 0) + 1;
    }
    return byTable;
  }, [logs]);

  const exportLogs = () => {
    exportToCsv(
      `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
      logs.map((log) => ({
        created_at: log.createdAt,
        employee: log.employeeName ?? '',
        table: formatActivityTable(log.tableName),
        operation: formatActivityOperation(log.operation),
        summary: log.entitySummary ?? '',
        ip: log.ipAddress ?? ''
      }))
    );
  };

  const printLogs = () => {
    const rows = logs
      .map(
        (log) =>
          `<tr><td>${escapeHtml(formatActivityDateTime(log.createdAt))}</td><td>${escapeHtml(log.employeeName ?? '—')}</td><td>${escapeHtml(formatActivityTable(log.tableName))}</td><td>${escapeHtml(formatActivityOperation(log.operation))}</td><td>${escapeHtml(log.ipAddress ?? '—')}</td><td>${escapeHtml(log.entitySummary ?? '')}</td></tr>`
      )
      .join('');
    printHtml(
      'سجل نشاط المكتب',
      `<div class="header"><h1>سجل نشاط المكتب</h1></div><table><thead><tr><th>التاريخ</th><th>الموظف</th><th>النوع</th><th>الإجراء</th><th>IP</th><th>التفاصيل</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  };

  const filterBar = (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث في السجل..."
          className="w-full rounded-xl border border-slate-200 py-2 pr-10 pl-3 text-xs outline-none focus:border-[#7A1F2B]"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
        >
          {ACTIVITY_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
        <button type="button" onClick={exportLogs} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
        <button type="button" onClick={printLogs} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
          <Printer className="h-3.5 w-3.5" /> طباعة
        </button>
      </div>
    </div>
  );

  return (
    <div className={embedded ? 'space-y-4' : 'mx-auto max-w-6xl space-y-4 px-3 py-4 sm:px-6'} dir="rtl">
      {!embedded ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[#7A1F2B]/10 p-3">
              <Shield className="h-6 w-6 text-[#7A1F2B]" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">سجل نشاط المكتب</h1>
              <p className="text-xs text-slate-500">
                تتبع كل ما يُضاف أو يُعدّل في المكتب — عملاء، قضايا، مستندات، دفعات، سندات، وموظفين.
              </p>
            </div>
          </div>
          {filterBar}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">{filterBar}</div>
      )}

      {!isLoading && logs.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats).slice(0, 8).map(([table, count]) => (
            <span
              key={table}
              className="rounded-full border border-slate-100 bg-slate-50 px-3 py-1 text-[10px] font-bold text-slate-600"
            >
              {formatActivityTable(table)}: {count}
            </span>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-[#7A1F2B]" />
        </div>
      ) : isError ? (
        <p className="text-center text-sm text-rose-600">{toArabicQueryError(error, 'تحميل السجل')}</p>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white py-16 text-slate-400">
          <History className="h-10 w-10 opacity-30" />
          <p className="text-sm font-bold">لا نشاط مسجّل بعد</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-bold">التاريخ والوقت</th>
                  <th className="px-4 py-3 font-bold">الموظف</th>
                  <th className="px-4 py-3 font-bold">النوع</th>
                  <th className="px-4 py-3 font-bold">الإجراء</th>
                  <th className="px-4 py-3 font-bold">IP</th>
                  <th className="px-4 py-3 font-bold">التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-slate-50 hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-slate-500">
                      {formatActivityDateTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="font-bold text-slate-800">{log.employeeName ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-lg bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                        {formatActivityTable(log.tableName)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                          log.operation === 'INSERT'
                            ? 'bg-emerald-50 text-emerald-800'
                            : log.operation === 'DELETE'
                              ? 'bg-rose-50 text-rose-800'
                              : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {formatActivityOperation(log.operation)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-slate-400">{log.ipAddress ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700 font-medium max-w-md">
                      {log.entitySummary ?? `${formatActivityTable(log.tableName)} — ${formatActivityOperation(log.operation)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
