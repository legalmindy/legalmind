import { useQuery } from '@tanstack/react-query';
import { Loader2, Shield } from 'lucide-react';
import { fetchAuditLogs } from '../lib/reportsApi';
import { toArabicQueryError } from '../components/QueryErrorBanner';

export function AuditLogsPage() {
  const { data: logs = [], isLoading, isError, error } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => fetchAuditLogs(200)
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-6" dir="rtl">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="rounded-xl bg-[#7A1F2B]/10 p-3">
          <Shield className="h-6 w-6 text-[#7A1F2B]" />
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-900">سجل التدقيق</h1>
          <p className="text-xs text-slate-500">تتبع التعديلات والدفعات والسندات والصلاحيات</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-[#7A1F2B]" />
        </div>
      ) : isError ? (
        <p className="text-center text-sm text-rose-600">{toArabicQueryError(error, 'تحميل السجل')}</p>
      ) : logs.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">لا توجد سجلات.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-bold">التاريخ</th>
                  <th className="px-4 py-3 font-bold">الإجراء</th>
                  <th className="px-4 py-3 font-bold">الجدول</th>
                  <th className="px-4 py-3 font-bold">IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-slate-50">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                      {new Date(log.createdAt).toLocaleString('ar-YE')}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-800">{log.actionType ?? log.operation}</td>
                    <td className="px-4 py-3 text-slate-600">{log.tableName}</td>
                    <td className="px-4 py-3 font-mono text-[10px] text-slate-400">{log.ipAddress ?? '—'}</td>
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
